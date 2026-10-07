import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { subscriptions } from '@cameraderie/db';
import { planFromEntitlement } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { requireUser } from '../guards.js';
import { getUsage } from '../quota.js';

export default async function accountRoutes(app: FastifyInstance) {
  const db = getDb();

  // Profile.
  app.get('/me', async (req) => {
    const me = await requireUser(req);
    return { user: { id: me.id, email: me.email, name: me.name, plan: me.plan } };
  });

  // Bytes used vs quota, and the read-only-over-quota flag.
  app.get('/me/usage', async (req) => {
    const me = await requireUser(req);
    return getUsage(me.id);
  });

  // Current plan / entitlement (source of truth is the subscriptions table,
  // kept in sync by the billing webhook).
  app.get('/me/entitlements', async (req) => {
    const me = await requireUser(req);
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, me.id))
      .limit(1);
    const plan = planFromEntitlement(sub?.entitlement ?? me.plan);
    return {
      plan: plan.id,
      quotaBytes: plan.quotaBytes,
      status: sub?.status ?? 'inactive',
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    };
  });
}
