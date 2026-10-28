import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { eq, sql } from 'drizzle-orm';
import { derivatives, groups, media, user, type Media } from '@cameraderie/db';
import {
  extensionOf,
  thumbnailKey,
  previewKey,
  THUMBNAIL_MAX_EDGE,
  PREVIEW_MAX_EDGE,
  VIDEO_PREVIEW_MAX_EDGE,
  VIDEO_PREVIEW_CRF,
  type DerivativeKind,
  type MediaKind,
} from '@cameraderie/shared';
import { getDb } from './db.js';
import { downloadToFile, putObject } from './r2.js';
import { probe, extractFrame, transcodePreview } from './ffmpeg.js';
import { decodeRawToTiff } from './libraw.js';
import { checkContentSafety } from './safety.js';
import { captureAlert } from './observability.js';
import { newId } from './ids.js';

// Allow very large images (RAW/panoramas) through libvips.
sharp.cache(false);

export class PermanentError extends Error {}

/**
 * Generate derivatives for one media row. The original in R2 is never touched —
 * everything here reads the original and writes new derivative objects.
 *
 * Throwing signals a (possibly transient) failure, so BullMQ retries.
 * A PermanentError (bad checksum) is handled in-place and not retried.
 */
export async function processMedia(mediaId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row) {
    console.warn(`[worker] media ${mediaId} not found, skipping`);
    return;
  }
  if (row.state === 'ready') {
    // Already processed (duplicate delivery). Idempotent no-op.
    return;
  }
  if (row.state !== 'processing') {
    console.warn(`[worker] media ${mediaId} in state ${row.state}, skipping`);
    return;
  }

  const workdir = await mkdtemp(join(tmpdir(), `cam-${mediaId}-`));
  try {
    const ext = extensionOf(row.filename);
    const originalPath = join(workdir, ext ? `original.${ext}` : 'original');
    await downloadToFile(row.objectKey, originalPath);

    // Prove integrity: re-verify the on-device SHA-256 after the upload landed.
    const actual = await sha256File(originalPath);
    if (actual !== row.checksumSha256) {
      await setState(mediaId, 'failed');
      throw new PermanentError(
        `checksum mismatch for ${mediaId}: expected ${row.checksumSha256}, got ${actual}`,
      );
    }

    // Content-safety: reject known-bad hashes before generating derivatives.
    // On a match we QUARANTINE rather than delete: the original + row are
    // preserved as evidence, the item is never published or served, and an
    // operator is alerted so they can report it to the relevant authority
    // (in the UK: the IWF, and the police/CEOP for a crime) and then remove it
    // once preserved. We deliberately do NOT throw here — a thrown error would
    // be caught upstream and flip the state to 'failed', undoing the
    // quarantine. We return normally with the row left in 'quarantined'.
    const verdict = await checkContentSafety(actual);
    if (verdict.blocked) {
      console.error(`[worker] media ${mediaId} QUARANTINED: ${verdict.reason}`);
      await db.update(media).set({ state: 'quarantined' }).where(eq(media.id, mediaId));
      // Refund the quota charged at upload-complete (bytes are 0-floored); the
      // preserved original is storage we absorb as the operator, not the user.
      await db
        .update(user)
        .set({ usedBytes: sql`GREATEST(0, ${user.usedBytes} - ${row.sizeBytes})` })
        .where(eq(user.id, row.uploaderId));
      captureAlert(`content-safety quarantine: media ${mediaId}`, {
        mediaId,
        groupId: row.groupId,
        uploaderId: row.uploaderId,
        reason: verdict.reason,
        objectKey: row.objectKey,
        sha256: actual,
      });
      return;
    }

    // Derivatives strip EXIF/GPS by default (sharp drops metadata unless told
    // to keep it). A group can opt to retain metadata in previews; originals
    // always keep everything.
    const [group] = await db
      .select({ stripExif: groups.stripExifFromPreviews })
      .from(groups)
      .where(eq(groups.id, row.groupId))
      .limit(1);
    const keepMetadata = group ? !group.stripExif : false;

    const dims =
      row.kind === 'video'
        ? await processVideo(row, originalPath, workdir)
        : await processImageOrRaw(row, originalPath, workdir, keepMetadata);

    const exif =
      row.kind === 'video' || !row.keepCameraExif ? emptyExif() : await extractExif(originalPath);

    await db
      .update(media)
      .set({
        state: 'ready',
        width: dims.width,
        height: dims.height,
        durationMs: dims.durationMs,
        ...exif,
      })
      .where(eq(media.id, mediaId));
    console.log(`[worker] media ${mediaId} ready`);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

interface Dims {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

interface ExifFields {
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  apertureF: number | null;
  shutterSpeedSec: number | null;
  iso: number | null;
  focalLengthMm: number | null;
  flash: string | null;
  orientation: string | null;
  exposureProgram: string | null;
  whiteBalance: string | null;
}

function emptyExif(): ExifFields {
  return {
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    apertureF: null,
    shutterSpeedSec: null,
    iso: null,
    focalLengthMm: null,
    flash: null,
    orientation: null,
    exposureProgram: null,
    whiteBalance: null,
  };
}

/** Clamp a string to a max length so it never overflows its DB column. */
function truncate(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Best-effort EXIF extraction from the original file (images/RAW only —
 * videos don't carry these tags). exifr's defaults already translate enum
 * tags (Flash, Orientation, ExposureProgram, WhiteBalance) into readable
 * strings and revive rationals (FNumber, ExposureTime, FocalLength) into
 * plain numbers, so there's little left to do beyond picking fields out and
 * clamping them to their column widths. Never throws — a photo with no/odd
 * EXIF just gets an all-null row.
 */
async function extractExif(originalPath: string): Promise<ExifFields> {
  try {
    const tags = await exifr.parse(originalPath);
    if (!tags) return emptyExif();
    return {
      cameraMake: truncate(tags.Make, 128),
      cameraModel: truncate(tags.Model, 128),
      lensModel: truncate(tags.LensModel, 191),
      apertureF: toNumber(tags.FNumber),
      shutterSpeedSec: toNumber(tags.ExposureTime),
      iso: toNumber(tags.ISO),
      focalLengthMm: toNumber(tags.FocalLength),
      flash: truncate(tags.Flash, 191),
      orientation: truncate(tags.Orientation, 64),
      exposureProgram: truncate(tags.ExposureProgram, 64),
      whiteBalance: truncate(tags.WhiteBalance, 64),
    };
  } catch (err) {
    console.warn(`[worker] EXIF extraction failed for ${originalPath}`, err);
    return emptyExif();
  }
}

async function processImageOrRaw(
  row: Media,
  originalPath: string,
  workdir: string,
  keepMetadata: boolean,
): Promise<Dims> {
  if (row.kind === 'raw') return processRaw(row, originalPath, workdir, keepMetadata);
  return processImage(row, originalPath, workdir, keepMetadata);
}

// sharp's bundled libheif can read a HEIC/HEIF container's metadata but has
// no HEVC decoding plugin (unlicensed codec, omitted from the prebuilt
// binary), so a pixel decode always fails on the actual iPhone-shot photos
// that use that codec. Skip straight to ffmpeg for these instead of paying
// for a sharp decode attempt that's guaranteed to fail.
const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

/**
 * Image derivative generation, best source first:
 *   1. sharp/libvips directly (skipped for HEIC/HEIF — see above).
 *   2. ffmpeg — decodes the frame itself.
 * The original is never modified; if both fail the media still becomes
 * 'ready' (sans derivatives) so it appears in the feed.
 */
async function processImage(
  row: Media,
  originalPath: string,
  workdir: string,
  keepMetadata: boolean,
): Promise<Dims> {
  if (!HEIC_EXTENSIONS.has(extensionOf(row.filename))) {
    try {
      const { width, height } = await makeImageDerivatives(
        originalPath,
        row.id,
        row.kind,
        keepMetadata,
      );
      return { width, height, durationMs: null };
    } catch (err) {
      console.warn(`[worker] sharp failed on image ${row.id}, trying ffmpeg frame extraction`, err);
    }
  }

  try {
    const framePath = join(workdir, 'frame.png');
    await extractFrame(originalPath, framePath, 0);
    const { width, height } = await makeImageDerivatives(framePath, row.id, row.kind, keepMetadata);
    return { width, height, durationMs: null };
  } catch (err) {
    console.error(`[worker] could not derive any preview for image ${row.id}`, err);
    await markDerivativeFailed(row.id, 'thumbnail', thumbnailKey(row.id));
    await markDerivativeFailed(row.id, 'preview', previewKey(row.id, row.kind));
    return { width: null, height: null, durationMs: null };
  }
}

/**
 * RAW preview generation, best source first:
 *   1. libraw (`dcraw_emu`) — a true demosaiced render of the sensor data.
 *   2. sharp/libvips directly — works for DNG and some formats.
 *   3. ffmpeg — pulls the embedded JPEG preview.
 * The original RAW is never modified; if all three fail the media still becomes
 * 'ready' (sans derivatives) so it appears in the feed.
 */
async function processRaw(
  row: Media,
  originalPath: string,
  workdir: string,
  keepMetadata: boolean,
): Promise<Dims> {
  // 1. libraw.
  try {
    const tiff = await decodeRawToTiff(originalPath);
    const { width, height } = await makeImageDerivatives(tiff, row.id, row.kind, keepMetadata);
    return { width, height, durationMs: null };
  } catch (err) {
    console.warn(`[worker] libraw decode failed for RAW ${row.id}, trying sharp directly`, err);
  }

  // 2. sharp/libvips directly on the original.
  try {
    const { width, height } = await makeImageDerivatives(
      originalPath,
      row.id,
      row.kind,
      keepMetadata,
    );
    return { width, height, durationMs: null };
  } catch (err) {
    console.warn(`[worker] sharp failed on RAW ${row.id}, trying ffmpeg embedded preview`, err);
  }

  // 3. ffmpeg embedded preview.
  try {
    const framePath = join(workdir, 'frame.png');
    await extractFrame(originalPath, framePath, 0);
    const { width, height } = await makeImageDerivatives(framePath, row.id, row.kind, keepMetadata);
    return { width, height, durationMs: null };
  } catch (err) {
    console.error(`[worker] could not derive any preview for RAW ${row.id}`, err);
    await markDerivativeFailed(row.id, 'thumbnail', thumbnailKey(row.id));
    await markDerivativeFailed(row.id, 'preview', previewKey(row.id, row.kind));
    return { width: null, height: null, durationMs: null };
  }
}

async function processVideo(row: Media, originalPath: string, workdir: string): Promise<Dims> {
  const meta = await probe(originalPath);

  // Thumbnail: a representative frame, downsized to a WebP.
  const framePath = join(workdir, 'frame.png');
  await extractFrame(originalPath, framePath);
  const thumb = await sharp(framePath, { failOn: 'none' })
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await putObject(thumbnailKey(row.id), thumb, 'image/webp');
  await upsertDerivative(
    row.id,
    'thumbnail',
    thumbnailKey(row.id),
    'image/webp',
    thumb.length,
    null,
    null,
  );

  // Streamable preview: scaled H.264 MP4 with faststart.
  const previewPath = join(workdir, 'preview.mp4');
  await transcodePreview(originalPath, previewPath, VIDEO_PREVIEW_MAX_EDGE, VIDEO_PREVIEW_CRF);
  const previewBuf = await readFile(previewPath);
  const pKey = previewKey(row.id, 'video');
  await putObject(pKey, previewBuf, 'video/mp4');
  await upsertDerivative(row.id, 'preview', pKey, 'video/mp4', previewBuf.length, null, null);

  return { width: meta.width, height: meta.height, durationMs: meta.durationMs };
}

async function makeImageDerivatives(
  imagePath: string,
  mediaId: string,
  mediaKind: MediaKind,
  keepMetadata: boolean,
): Promise<{ width: number | null; height: number | null }> {
  const meta = await sharp(imagePath, { failOn: 'none' }).metadata();

  // Thumbnails are always metadata-free (tiny, pure UI).
  const thumb = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await putObject(thumbnailKey(mediaId), thumb, 'image/webp');
  await upsertDerivative(
    mediaId,
    'thumbnail',
    thumbnailKey(mediaId),
    'image/webp',
    thumb.length,
    null,
    null,
  );

  let previewPipeline = sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
  if (keepMetadata) previewPipeline = previewPipeline.withMetadata();
  const preview = await previewPipeline.webp({ quality: 82 }).toBuffer();
  const pKey = previewKey(mediaId, mediaKind);
  await putObject(pKey, preview, 'image/webp');
  await upsertDerivative(mediaId, 'preview', pKey, 'image/webp', preview.length, null, null);

  return { width: meta.width ?? null, height: meta.height ?? null };
}

async function upsertDerivative(
  mediaId: string,
  kind: DerivativeKind,
  objectKey: string,
  mimeType: string,
  sizeBytes: number,
  width: number | null,
  height: number | null,
): Promise<void> {
  await getDb()
    .insert(derivatives)
    .values({
      id: newId(),
      mediaId,
      kind,
      state: 'ready',
      objectKey,
      mimeType,
      sizeBytes,
      width,
      height,
    })
    .onDuplicateKeyUpdate({
      set: { state: 'ready', objectKey, mimeType, sizeBytes, width, height },
    });
}

async function markDerivativeFailed(
  mediaId: string,
  kind: DerivativeKind,
  objectKey: string,
): Promise<void> {
  await getDb()
    .insert(derivatives)
    .values({ id: newId(), mediaId, kind, state: 'failed', objectKey })
    .onDuplicateKeyUpdate({ set: { state: 'failed' } });
}

export async function setState(mediaId: string, state: Media['state']): Promise<void> {
  await getDb().update(media).set({ state }).where(eq(media.id, mediaId));
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
