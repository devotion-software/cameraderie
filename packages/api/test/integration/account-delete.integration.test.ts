import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('../../src/r2.js', () => ({
  deleteObjects: vi.fn(async () => {}),
  deleteObject: vi.fn(async () => {}),
}));

import { user, groups, memberships, media } from '@cameraderie/db';
import { deleteAccountData } from '../../src/routes/account.js';
import {
  getDb,
  makeUser,
  makeGroup,
  makeMembership,
  makeMedia,
  resetDb,
  closeDb,
} from './_helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('deleteAccountData (GDPR erasure + ownership transfer)', () => {
  it('transfers a shared group to the longest-standing remaining member', async () => {
    const db = getDb();
    const owner = await makeUser();
    const early = await makeUser();
    const late = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, owner, { role: 'owner', createdAt: new Date('2026-01-01') });
    await makeMembership(g, early, { role: 'member', createdAt: new Date('2026-02-01') });
    await makeMembership(g, late, { role: 'member', createdAt: new Date('2026-03-01') });

    await deleteAccountData(owner);

    const [grp] = await db.select().from(groups).where(eq(groups.id, g));
    expect(grp.ownerId).toBe(early); // joined before `late`

    const [heirM] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, g), eq(memberships.userId, early)));
    expect(heirM.role).toBe('owner');

    expect(await db.select().from(user).where(eq(user.id, owner))).toHaveLength(0);
  });

  it('deletes a solely-owned group with no other members', async () => {
    const db = getDb();
    const owner = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, owner, { role: 'owner' });

    await deleteAccountData(owner);

    expect(await db.select().from(groups).where(eq(groups.id, g))).toHaveLength(0);
  });

  it("purges the departing user's media but never other members' content", async () => {
    const db = getDb();
    const owner = await makeUser();
    const other = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, owner, { role: 'owner', createdAt: new Date('2026-01-01') });
    await makeMembership(g, other, { role: 'member', createdAt: new Date('2026-02-01') });
    const mine = await makeMedia(g, owner, {});
    const theirs = await makeMedia(g, other, {});

    await deleteAccountData(owner);

    expect(await db.select().from(media).where(eq(media.id, mine))).toHaveLength(0);
    // The group transferred to `other`, so their upload is untouched.
    expect(await db.select().from(media).where(eq(media.id, theirs))).toHaveLength(1);
  });
});
