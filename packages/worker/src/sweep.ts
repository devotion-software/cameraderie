import { and, eq, lt } from 'drizzle-orm';
import { media } from '@cameraderie/db';
import { getDb } from './db.js';
import { abortMultipartUpload } from './r2.js';

/**
 * Reap uploads abandoned mid-flight: media rows still in 'uploading' whose last
 * update is older than the TTL. Their R2 multipart is aborted (freeing the parts
 * R2 is holding) and the reserved row removed. No quota was charged for an
 * incomplete upload, so there is nothing to refund.
 */
export async function sweepStaleUploads(olderThanMinutes: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  const stale = await db
    .select()
    .from(media)
    .where(and(eq(media.state, 'uploading'), lt(media.updatedAt, cutoff)));

  let reaped = 0;
  for (const row of stale) {
    if (row.r2UploadId) {
      // Already-gone multiparts throw NoSuchUpload — ignore, we still drop the row.
      await abortMultipartUpload(row.objectKey, row.r2UploadId).catch(() => {});
    }
    await db.delete(media).where(eq(media.id, row.id));
    reaped++;
  }
  if (reaped > 0) console.log(`[worker] swept ${reaped} stale upload(s)`);
  return reaped;
}
