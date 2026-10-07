import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ne } from 'drizzle-orm';
import { groups, media, memberships, subscriptions, user } from '@cameraderie/db';
import { planFromEntitlement } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { requireUser } from '../guards.js';
import { getUsage } from '../quota.js';
import { purgeMedia } from '../media-ops.js';

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

  // Delete my account and all my data (GDPR). Honest default: the user's own
  // uploads are deleted everywhere; groups they solely own are deleted, and
  // owned groups with other members have ownership transferred to the longest-
  // standing remaining member — we never delete other people's content.
  app.delete('/me', async (req, reply) => {
    const me = await requireUser(req);

    // 1. Purge the user's own media across all groups (R2 + rows + quota).
    const ownMedia = await db.select().from(media).where(eq(media.uploaderId, me.id));
    for (const row of ownMedia) {
      await purgeMedia(row, (err) => req.log.error({ err }, 'account-delete R2 cleanup failed'));
    }

    // 2. Hand off or dissolve groups this user owns.
    const owned = await db.select().from(groups).where(eq(groups.ownerId, me.id));
    for (const group of owned) {
      const [heir] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.groupId, group.id), ne(memberships.userId, me.id)))
        .orderBy(asc(memberships.createdAt))
        .limit(1);
      if (heir) {
        await db.transaction(async (tx) => {
          await tx.update(groups).set({ ownerId: heir.userId }).where(eq(groups.id, group.id));
          await tx
            .update(memberships)
            .set({ role: 'owner' })
            .where(eq(memberships.id, heir.id));
        });
      } else {
        // No one else in the group — delete it (cascades its now-empty media).
        await db.delete(groups).where(eq(groups.id, group.id));
      }
    }

    // 3. Delete the user. Cascades memberships, favourites, subscriptions,
    //    sessions, and accounts — which also signs them out everywhere.
    await db.delete(user).where(eq(user.id, me.id));
    reply.code(204);
  });
}
