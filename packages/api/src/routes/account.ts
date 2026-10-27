import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ne } from 'drizzle-orm';
import { favourites, groups, media, memberships, subscriptions, user } from '@cameraderie/db';
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

  // Export all of my data as a JSON download (GDPR right of access /
  // portability). Includes the account record, group memberships, groups I own,
  // my uploaded media metadata, my favourites, and my subscription. Internal
  // storage details (R2 keys, upload ids) are omitted as they're not user data.
  app.get('/me/export', async (req, reply) => {
    const me = await requireUser(req);

    const [profile] = await db.select().from(user).where(eq(user.id, me.id)).limit(1);
    const myMemberships = await db
      .select({
        groupId: memberships.groupId,
        groupName: groups.name,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(groups, eq(memberships.groupId, groups.id))
      .where(eq(memberships.userId, me.id));
    const ownedGroups = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .where(eq(groups.ownerId, me.id));
    const myMedia = await db
      .select({
        id: media.id,
        groupId: media.groupId,
        kind: media.kind,
        state: media.state,
        filename: media.filename,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
        durationMs: media.durationMs,
        capturedAt: media.capturedAt,
        createdAt: media.createdAt,
      })
      .from(media)
      .where(eq(media.uploaderId, me.id));
    const myFavourites = await db
      .select({ mediaId: favourites.mediaId, favouritedAt: favourites.createdAt })
      .from(favourites)
      .where(eq(favourites.userId, me.id));
    const [sub] = await db
      .select({
        provider: subscriptions.provider,
        entitlement: subscriptions.entitlement,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, me.id))
      .limit(1);

    reply.header('content-disposition', `attachment; filename="cameraderie-export-${me.id}.json"`);
    return {
      exportFormatVersion: 1,
      account: profile
        ? {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            emailVerified: profile.emailVerified,
            plan: profile.plan,
            role: profile.role,
            acceptedTermsAt: profile.acceptedTermsAt,
            usedBytes: profile.usedBytes,
            createdAt: profile.createdAt,
          }
        : null,
      memberships: myMemberships,
      ownedGroups,
      media: myMedia,
      favourites: myFavourites,
      subscription: sub ?? null,
    };
  });

  // Delete my account and all my data (GDPR).
  app.delete('/me', async (req, reply) => {
    const me = await requireUser(req);
    await deleteAccountData(me.id, (err) =>
      req.log.error({ err }, 'account-delete R2 cleanup failed'),
    );
    reply.code(204);
  });
}

/**
 * Erase a user and all their data (GDPR right to erasure). Extracted from the
 * route so the ownership-transfer rules can be tested directly. Honest default:
 * the user's own uploads are deleted everywhere; groups they solely own are
 * deleted, and owned groups with other members have ownership transferred to the
 * longest-standing remaining member — we never delete other people's content.
 */
export async function deleteAccountData(
  userId: string,
  onR2Error?: (err: unknown) => void,
): Promise<void> {
  const db = getDb();

  // 1. Purge the user's own media across all groups (R2 + rows + quota).
  const ownMedia = await db.select().from(media).where(eq(media.uploaderId, userId));
  for (const row of ownMedia) {
    await purgeMedia(row, onR2Error);
  }

  // 2. Hand off or dissolve groups this user owns.
  const owned = await db.select().from(groups).where(eq(groups.ownerId, userId));
  for (const group of owned) {
    const [heir] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), ne(memberships.userId, userId)))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    if (heir) {
      await db.transaction(async (tx) => {
        await tx.update(groups).set({ ownerId: heir.userId }).where(eq(groups.id, group.id));
        await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, heir.id));
      });
    } else {
      // No one else in the group — delete it (cascades its now-empty media).
      await db.delete(groups).where(eq(groups.id, group.id));
    }
  }

  // 3. Delete the user. Cascades memberships, favourites, subscriptions,
  //    sessions, and accounts — which also signs them out everywhere.
  await db.delete(user).where(eq(user.id, userId));
}
