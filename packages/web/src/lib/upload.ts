import type { BeginUploadResponse } from '@cameraderie/shared';
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

/**
 * Three-step direct-to-R2 upload: begin → PUT each part straight to R2 →
 * complete. The bytes never pass through the API.
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

  const completed: { partNumber: number; etag: string }[] = [];
  let uploaded = 0;
  try {
    for (const part of begin.parts) {
      const start = (part.partNumber - 1) * begin.partSizeBytes;
      const end = Math.min(start + begin.partSizeBytes, file.size);
      const chunk = file.slice(start, end);

      const res = await fetch(part.url, { method: 'PUT', body: chunk });
      if (!res.ok) throw new Error(`Part ${part.partNumber} failed: ${res.status}`);
      // R2 returns the part ETag; CompleteMultipartUpload needs it verbatim.
      const etag = res.headers.get('etag') ?? res.headers.get('ETag');
      if (!etag) throw new Error('R2 did not return an ETag (check bucket CORS ExposeHeaders)');
      completed.push({ partNumber: part.partNumber, etag });

      uploaded += end - start;
      onProgress?.(uploaded / Math.max(1, file.size));
    }
  } catch (err) {
    // Release the reserved upload so it doesn't linger.
    await api.post(`/media/uploads/${begin.mediaId}/abort`).catch(() => {});
    throw err;
  }

  await api.post(`/media/uploads/${begin.mediaId}/complete`, { parts: completed });
  onProgress?.(1);
  return { mediaId: begin.mediaId };
}

export { ApiError };
