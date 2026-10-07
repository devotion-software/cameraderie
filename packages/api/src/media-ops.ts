import { eq } from 'drizzle-orm';
import { derivatives, media, type Media } from '@cameraderie/db';
import { getDb } from './db.js';
import { deleteObjects } from './r2.js';
import { adjustUsedBytes } from './quota.js';

/** States whose bytes have been charged to the uploader's quota. */
const CHARGED_STATES = new Set<Media['state']>(['processing', 'ready', 'failed']);

/**
 * Permanently remove a media item: its R2 objects (original + derivatives), its
 * DB rows (derivatives/favourites/reports cascade), and the uploader's quota
 * charge. Used by the owner/uploader delete, admin takedown, and account
 * deletion so the cleanup rule lives in one place.
 */
export async function purgeMedia(row: Media, onError?: (err: unknown) => void): Promise<void> {
  const db = getDb();
  const derivs = await db.select().from(derivatives).where(eq(derivatives.mediaId, row.id));
  const keys = [row.objectKey, ...derivs.map((d) => d.objectKey)];
  try {
    await deleteObjects(keys);
  } catch (err) {
    onError?.(err);
  }
  await db.delete(media).where(eq(media.id, row.id));
  if (CHARGED_STATES.has(row.state)) {
    await adjustUsedBytes(row.uploaderId, -row.sizeBytes);
  }
}
