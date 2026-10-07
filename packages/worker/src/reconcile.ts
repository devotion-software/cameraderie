import { sql, inArray } from 'drizzle-orm';
import { media } from '@cameraderie/db';
import { getDb } from './db.js';
import { listObjectKeys, deleteObjects } from './r2.js';

/**
 * Reconcile the database and R2 against each other, treating R2 as the source of
 * truth for what bytes actually exist, then recompute every user's used_bytes.
 *
 * Two kinds of drift are repaired:
 *  1. DB rows whose original is missing from R2 (a 'ready'/'processing' row with
 *     no object) are marked 'failed' — the UI shows them as broken rather than
 *     silently serving a dead presigned URL.
 *  2. Orphaned R2 originals with no owning media row (e.g. a crash between the
 *     R2 write and the DB commit) are deleted so they stop costing storage.
 *
 * Finally used_bytes is summed from the surviving charged rows.
 */
export async function reconcile(): Promise<void> {
  const db = getDb();

  // R2 originals live under originals/<mediaId>/original[.ext]. The media id is
  // the second path segment, so we can map an object back to its row.
  const objects = await listObjectKeys('originals/');
  const r2MediaIds = new Set<string>();
  for (const key of objects.keys()) {
    const id = key.split('/')[1];
    if (id) r2MediaIds.add(id);
  }

  // 1. DB rows (that should have bytes) whose original is absent from R2.
  const chargedRows = await db
    .select({ id: media.id, state: media.state })
    .from(media)
    .where(inArray(media.state, ['processing', 'ready']));
  const missing = chargedRows.filter((r) => !r2MediaIds.has(r.id)).map((r) => r.id);
  if (missing.length > 0) {
    await db.update(media).set({ state: 'failed' }).where(inArray(media.id, missing));
    console.log(`[worker] reconcile: marked ${missing.length} row(s) failed (original missing in R2)`);
  }

  // 2. Orphaned R2 originals with no owning media row.
  const allIds = await db.select({ id: media.id }).from(media);
  const dbIds = new Set(allIds.map((r) => r.id));
  const orphanKeys = [...objects.keys()].filter((key) => {
    const id = key.split('/')[1];
    return id ? !dbIds.has(id) : false;
  });
  if (orphanKeys.length > 0) {
    await deleteObjects(orphanKeys);
    console.log(`[worker] reconcile: deleted ${orphanKeys.length} orphaned R2 object(s)`);
  }

  // 3. Recompute used_bytes from the surviving charged rows.
  await db.execute(sql`
    UPDATE user u
    SET u.used_bytes = COALESCE((
      SELECT SUM(m.size_bytes)
      FROM media m
      WHERE m.uploader_id = u.id
        AND m.state IN ('processing', 'ready', 'failed')
    ), 0)
  `);
  console.log('[worker] reconcile: used_bytes recomputed');
}
