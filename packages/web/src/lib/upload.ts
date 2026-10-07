import type {
  BeginUploadResponse,
  PresignedPart,
  UploadStatusResponse,
} from '@cameraderie/shared';
import { api, ApiError } from './api';

/**
 * Compute the SHA-256 of a file on-device so the server can prove end-to-end
 * integrity after the multipart upload completes.
 *
 * Note: this reads the whole file into memory. Fine for photos and short
 * clips in the browser; the native apps compute the hash while streaming.
 */
export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadHandle {
  mediaId: string;
}

const MAX_ATTEMPTS = 3;

/**
 * Three-step direct-to-R2 upload with resume: begin → PUT each part straight to
 * R2 → complete. On a transient failure the whole transfer is retried, but we
 * first ask the server which parts R2 already has and skip those — so a dropped
 * connection resumes from the last part instead of restarting. Bytes never pass
 * through the API.
 */
export async function uploadFile(
  groupId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadHandle> {
  const checksumSha256 = await sha256Hex(file);

  const begin = await api.post<BeginUploadResponse>('/media/uploads', {
    groupId,
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    checksumSha256,
  });

  const partSize = begin.partSizeBytes;
  const totalParts = begin.parts.length;
  // Parts still to send this round (starts as all of them).
  let pending: PresignedPart[] = begin.parts;
  let doneParts = 0;

  const reportProgress = () => onProgress?.(Math.min(1, (doneParts * partSize) / Math.max(1, file.size)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await putParts(pending, file, partSize, () => {
        doneParts++;
        reportProgress();
      });
      await api.post(`/media/uploads/${begin.mediaId}/complete`, { parts: [] });
      onProgress?.(1);
      return { mediaId: begin.mediaId };
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      // Ask the server what R2 already has, and retry only the missing parts.
      try {
        const status = await api.get<UploadStatusResponse>(`/media/uploads/${begin.mediaId}`);
        pending = status.remainingParts;
        doneParts = status.uploadedParts.length;
        reportProgress();
      } catch {
        // If even the status call fails, retry the full set next loop.
        pending = begin.parts;
      }
    }
  }

  // All attempts exhausted — release the reserved upload so it doesn't linger.
  await api.post(`/media/uploads/${begin.mediaId}/abort`).catch(() => {});
  throw lastErr instanceof Error ? lastErr : new Error('Upload failed');
}

async function putParts(
  parts: PresignedPart[],
  file: File,
  partSize: number,
  onPartDone: () => void,
): Promise<void> {
  for (const part of parts) {
    const start = (part.partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);

    const res = await fetch(part.url, { method: 'PUT', body: chunk });
    if (!res.ok) throw new Error(`Part ${part.partNumber} failed: ${res.status}`);
    // R2 returns the part ETag; the server re-reads it from R2 on complete, so
    // we don't need to retain it client-side — just confirm the PUT succeeded.
    onPartDone();
  }
}

export { ApiError };
