import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GiB } from '@cameraderie/shared';
import { assertCanUpload, getUsage, adjustUsedBytes } from '../../src/quota.js';
import { makeUser, resetDb, closeDb } from './_helpers.js';

const FREE_QUOTA = 5 * GiB;

beforeEach(resetDb);
afterAll(closeDb);

describe('quota enforcement (413 before any bytes move)', () => {
  it('rejects an upload that would exceed the remaining quota', async () => {
    const u = await makeUser({ usedBytes: FREE_QUOTA - 100 });
    await expect(assertCanUpload(u, 200)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('allows an upload that fits within the quota', async () => {
    const u = await makeUser({ usedBytes: 0 });
    await expect(assertCanUpload(u, 1000)).resolves.toBeUndefined();
  });

  it('allows an upload that exactly reaches the quota, but not one byte more', async () => {
    const u = await makeUser({ usedBytes: FREE_QUOTA - 1000 });
    await expect(assertCanUpload(u, 1000)).resolves.toBeUndefined();
    await expect(assertCanUpload(u, 1001)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('flags readOnly once usage is at or over quota', async () => {
    const u = await makeUser({ usedBytes: FREE_QUOTA });
    const usage = await getUsage(u);
    expect(usage.readOnly).toBe(true);
    expect(usage.quotaBytes).toBe(FREE_QUOTA);
  });

  it('adjustUsedBytes floors the counter at zero (never negative on over-refund)', async () => {
    const u = await makeUser({ usedBytes: 500 });
    await adjustUsedBytes(u, -9999);
    const usage = await getUsage(u);
    expect(usage.usedBytes).toBe(0);
  });
});
