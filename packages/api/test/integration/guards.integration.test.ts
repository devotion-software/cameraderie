import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { requireMembership } from '../../src/guards.js';
import { makeUser, makeGroup, makeMembership, resetDb, closeDb } from './_helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('requireMembership (authorization / IDOR)', () => {
  it('returns the membership row for a member', async () => {
    const owner = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, owner, { role: 'owner' });

    const m = await requireMembership(g, owner);
    expect(m.groupId).toBe(g);
    expect(m.userId).toBe(owner);
  });

  it('throws 403 for a non-member — blocks cross-group (IDOR) access', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, owner, { role: 'owner' });

    await expect(requireMembership(g, outsider)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('enforces the minimum role', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const g = await makeGroup(owner);
    await makeMembership(g, member, { role: 'member' });

    // A plain member cannot pass an owner-level requirement.
    await expect(requireMembership(g, member, 'owner')).rejects.toMatchObject({ statusCode: 403 });
    // But can pass a member-level one.
    await expect(requireMembership(g, member, 'member')).resolves.toMatchObject({ role: 'member' });
  });
});
