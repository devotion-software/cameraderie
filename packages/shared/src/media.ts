/**
 * Media classification, lifecycle states, and R2 object-key conventions.
 *
 * Principle: the uploaded original is the source of truth and is never
 * re-encoded. Thumbnails and previews are separate *derivative* objects —
 * the only files the server (worker) ever transcodes.
 */

/** Lifecycle of a media row. */
export const MEDIA_STATES = ['pending', 'uploading', 'processing', 'ready', 'failed'] as const;
export type MediaState = (typeof MEDIA_STATES)[number];

/** High-level kind, derived from the declared mime/extension. */
export const MEDIA_KINDS = ['image', 'raw', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Generated artifacts owned by a media row. */
export const DERIVATIVE_KINDS = ['thumbnail', 'preview'] as const;
export type DerivativeKind = (typeof DERIVATIVE_KINDS)[number];

export const DERIVATIVE_STATES = ['pending', 'ready', 'failed'] as const;
export type DerivativeState = (typeof DERIVATIVE_STATES)[number];

/** Member role within a group. */
export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

// ── Classification ───────────────────────────────────────────────────────────

const RAW_EXTENSIONS = new Set([
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'sr2',
  'srf',
  'raf',
  'rw2',
  'orf',
  'pef',
  'raw',
  '3fr',
  'erf',
  'kdc',
  'mos',
  'mrw',
  'x3f',
]);

const RAW_MIMES = new Set([
  'image/x-adobe-dng',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-nikon-nrw',
  'image/x-sony-arw',
  'image/x-fuji-raf',
  'image/x-panasonic-rw2',
  'image/x-olympus-orf',
  'image/x-pentax-pef',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'heic',
  'heif',
  'tif',
  'tiff',
  'bmp',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'hevc',
  '3gp',
  'mpg',
  'mpeg',
]);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Classify by extension first (most reliable off a phone), falling back to the
 * declared mime type. RAW must be checked before generic image.
 */
export function classifyMedia(filename: string, mime?: string | null): MediaKind {
  const ext = extensionOf(filename);
  const m = (mime ?? '').toLowerCase();

  if (RAW_EXTENSIONS.has(ext) || RAW_MIMES.has(m)) return 'raw';
  if (VIDEO_EXTENSIONS.has(ext) || m.startsWith('video/')) return 'video';
  if (IMAGE_EXTENSIONS.has(ext) || m.startsWith('image/')) return 'image';

  // Unknown: treat as image so it still gets a (best-effort) thumbnail attempt.
  return 'image';
}

// ── R2 key conventions ───────────────────────────────────────────────────────
//
// Keys are deterministic from the media id so the worker can find an original
// without extra lookups, and derivatives live under a predictable prefix.

export function originalKey(mediaId: string, filename: string): string {
  // Preserve the extension; the original bytes are kept exactly as uploaded.
  const ext = extensionOf(filename);
  return ext ? `originals/${mediaId}/original.${ext}` : `originals/${mediaId}/original`;
}

export function thumbnailKey(mediaId: string): string {
  return `derivatives/${mediaId}/thumb.webp`;
}

export function previewKey(mediaId: string, kind: MediaKind): string {
  // Images/raw get a large WebP preview; video gets a streamable MP4.
  return kind === 'video'
    ? `derivatives/${mediaId}/preview.mp4`
    : `derivatives/${mediaId}/preview.webp`;
}

export function derivativeKey(mediaId: string, kind: DerivativeKind, mediaKind: MediaKind): string {
  return kind === 'thumbnail' ? thumbnailKey(mediaId) : previewKey(mediaId, mediaKind);
}

/** Derivative output tuning. */
export const THUMBNAIL_MAX_EDGE = 512;
export const PREVIEW_MAX_EDGE = 2048;
/** Longest edge (px) of the video preview, and its target bitrate. */
export const VIDEO_PREVIEW_MAX_EDGE = 1280;
export const VIDEO_PREVIEW_CRF = 28;
