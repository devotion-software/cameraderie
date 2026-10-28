import type { BeginAvatarUploadResponse, CompleteAvatarUploadResponse } from '@cameraderie/shared';
import { api } from './api';

const AVATAR_EDGE = 512;

/** Crop to a centered square and downscale, so avatars are small and uniform. */
async function resizeToSquare(file: File, edge = AVATAR_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const srcEdge = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - srcEdge) / 2;
  const sy = (bitmap.height - srcEdge) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported in this browser');
  ctx.drawImage(bitmap, sx, sy, srcEdge, srcEdge, 0, 0, edge, edge);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image'))),
      'image/webp',
      0.9,
    );
  });
}

/**
 * Resize on-device, then a single-shot direct-to-R2 upload: begin → PUT the
 * blob straight to R2 → complete. Bytes never pass through the API.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const blob = await resizeToSquare(file);

  const begin = await api.post<BeginAvatarUploadResponse>('/me/avatar/begin', {
    contentType: blob.type,
  });

  const res = await fetch(begin.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'content-type': blob.type },
  });
  if (!res.ok) throw new Error(`Avatar upload failed (${res.status})`);

  const done = await api.post<CompleteAvatarUploadResponse>('/me/avatar/complete', {
    contentType: blob.type,
  });
  return done.avatarUrl;
}
