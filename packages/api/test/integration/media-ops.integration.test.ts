import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// R2 is external; stub the object-delete calls so purge logic runs without network.
vi.mock('../../src/r2.js', () => ({
  deleteObjects: vi.fn(async () => {}),
  deleteObject: vi.fn(async () => {}),
}));

import { media, derivatives, reports, user } from '@cameraderie/db';
import { purgeMedia } from '../../src/media-ops.js';
import {
  getDb,
  makeUser,
  makeGroup,
  makeMedia,
  makeDerivative,
  makeReport,
  resetDb,
  closeDb,
} from './_helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('purgeMedia (delete / admin takedown)', () => {
  it('removes media + derivatives, refunds quota, and preserves the report as an audit record', async () => {
    const db = getDb();
    const owner = await makeUser({ usedBytes: 5000 });
    const g = await makeGroup(owner);
    const m = await makeMedia(g, owner, { state: 'ready', sizeBytes: 5000 });
    await makeDerivative(m, 'thumbnail');
    await makeReport(m, owner, 'bad');

    const [row] = await db.select().from(media).where(eq(media.id, m));
    await purgeMedia(row);

    // Media and its derivatives are gone.
    expect(await db.select().from(media).where(eq(media.id, m))).toHaveLength(0);
    expect(await db.select().from(derivatives).where(eq(derivatives.mediaId, m))).toHaveLength(0);

    // The report survives as an audit trail, with mediaId set to null (not cascaded).
    const reps = await db.select().from(reports);
    expect(reps).toHaveLength(1);
    expect(reps[0].mediaId).toBeNull();

    // Quota charge refunded.
    const [u] = await db.select().from(user).where(eq(user.id, owner));
    expect(u.usedBytes).toBe(0);
  });

  it('does NOT refund quota for a non-charged state (e.g. still uploading)', async () => {
    const db = getDb();
    const owner = await makeUser({ usedBytes: 5000 });
    const g = await makeGroup(owner);
    const m = await makeMedia(g, owner, { state: 'uploading', sizeBytes: 5000 });

    const [row] = await db.select().from(media).where(eq(media.id, m));
    await purgeMedia(row);

    const [u] = await db.select().from(user).where(eq(user.id, owner));
    expect(u.usedBytes).toBe(5000); // unchanged — bytes were never charged
  });
});
