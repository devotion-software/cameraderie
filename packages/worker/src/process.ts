import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { derivatives, media, type Media } from '@cameraderie/db';
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

    const dims =
      row.kind === 'video'
        ? await processVideo(row, originalPath, workdir)
        : await processImageOrRaw(row, originalPath, workdir);

    await db
      .update(media)
      .set({ state: 'ready', width: dims.width, height: dims.height, durationMs: dims.durationMs })
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

async function processImageOrRaw(row: Media, originalPath: string, workdir: string): Promise<Dims> {
  try {
    const { width, height } = await makeImageDerivatives(originalPath, row.id, row.kind);
    return { width, height, durationMs: null };
  } catch (err) {
    if (row.kind === 'raw') {
      // RAW that libvips can't decode: try to pull an embedded preview via ffmpeg.
      console.warn(`[worker] sharp failed on RAW ${row.id}, trying ffmpeg fallback`, err);
      const framePath = join(workdir, 'frame.png');
      try {
        await extractFrame(originalPath, framePath);
        const { width, height } = await makeImageDerivatives(framePath, row.id, row.kind);
        return { width, height, durationMs: null };
      } catch (err2) {
        // Can't derive a preview — the original is still safe. Mark derivatives
        // failed but let the media be 'ready' so it appears (sans thumbnail).
        console.error(`[worker] could not derive preview for RAW ${row.id}`, err2);
        await markDerivativeFailed(row.id, 'thumbnail', thumbnailKey(row.id));
        await markDerivativeFailed(row.id, 'preview', previewKey(row.id, row.kind));
        return { width: null, height: null, durationMs: null };
      }
    }
    throw err;
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
  await upsertDerivative(row.id, 'thumbnail', thumbnailKey(row.id), 'image/webp', thumb.length, null, null);

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
): Promise<{ width: number | null; height: number | null }> {
  const meta = await sharp(imagePath, { failOn: 'none' }).metadata();

  const thumb = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await putObject(thumbnailKey(mediaId), thumb, 'image/webp');
  await upsertDerivative(mediaId, 'thumbnail', thumbnailKey(mediaId), 'image/webp', thumb.length, null, null);

  const preview = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
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
    .values({ id: newId(), mediaId, kind, state: 'ready', objectKey, mimeType, sizeBytes, width, height })
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
