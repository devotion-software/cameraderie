import type { Derivative, Media } from '@cameraderie/db';
import { presignGet } from './r2.js';

export interface MediaDto {
  id: string;
  groupId: string;
  uploaderId: string;
  uploaderName: string | null;
  uploaderAvatarUrl: string | null;
  kind: Media['kind'];
  state: Media['state'];
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  /** Short-lived presigned URLs; null until the derivative is ready. */
  thumbnailUrl: string | null;
  previewUrl: string | null;
  favouriteCount: number;
  favourited: boolean;
}

/** Shape a media row (+ its derivatives) into the wire DTO with presigned URLs. */
export async function serializeMedia(
  row: Media,
  derivatives: Derivative[],
  favouriteCount: number,
  favourited: boolean,
  uploader?: { name: string | null; avatarUrl: string | null },
): Promise<MediaDto> {
  const thumb = derivatives.find((d) => d.kind === 'thumbnail' && d.state === 'ready');
  const preview = derivatives.find((d) => d.kind === 'preview' && d.state === 'ready');
  const [thumbnailUrl, previewUrl] = await Promise.all([
    thumb ? presignGet(thumb.objectKey) : Promise.resolve(null),
    preview ? presignGet(preview.objectKey) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    groupId: row.groupId,
    uploaderId: row.uploaderId,
    uploaderName: uploader?.name ?? null,
    uploaderAvatarUrl: uploader?.avatarUrl ?? null,
    kind: row.kind,
    state: row.state,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.createdAt.toISOString(),
    thumbnailUrl,
    previewUrl,
    favouriteCount,
    favourited,
  };
}
