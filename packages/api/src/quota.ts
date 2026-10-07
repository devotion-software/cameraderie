import { eq, sql } from 'drizzle-orm';
import { user } from '@cameraderie/db';
import { planFromEntitlement, quotaForPlan, type UsageResponse } from '@cameraderie/shared';
import { getDb } from './db.js';
import { payloadTooLarge } from './errors.js';

export function quotaBytesForPlan(plan: string): number {
  return quotaForPlan(planFromEntitlement(plan).id);
}

export async function getUsage(userId: string): Promise<UsageResponse> {
  const [row] = await getDb()
    .select({ usedBytes: user.usedBytes, plan: user.plan })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const usedBytes = row?.usedBytes ?? 0;
  const plan = planFromEntitlement(row?.plan).id;
  const quotaBytes = quotaForPlan(plan);
  return { usedBytes, quotaBytes, plan, readOnly: usedBytes >= quotaBytes };
}

/**
 * Enforce quota before any bytes are sent: reject at upload-begin if the new
 * file would push the user over their limit.
 */
export async function assertCanUpload(userId: string, additionalBytes: number): Promise<void> {
  const usage = await getUsage(userId);
  if (usage.usedBytes + additionalBytes > usage.quotaBytes) {
    const remaining = Math.max(0, usage.quotaBytes - usage.usedBytes);
    throw payloadTooLarge(
      `Upload of ${additionalBytes} bytes exceeds your remaining quota of ${remaining} bytes`,
    );
  }
}

/** Adjust the running used_bytes counter (positive on upload, negative on delete). */
export async function adjustUsedBytes(userId: string, deltaBytes: number): Promise<void> {
  await getDb()
    .update(user)
    .set({ usedBytes: sql`GREATEST(0, ${user.usedBytes} + ${deltaBytes})` })
    .where(eq(user.id, userId));
}
