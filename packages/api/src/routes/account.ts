import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ne } from 'drizzle-orm';
import { favourites, groups, media, memberships, subscriptions, user } from '@cameraderie/db';
import {
  AVATAR_MAX_BYTES,
  avatarKey,
  beginAvatarUploadBody,
  planFromEntitlement,
  updateDownloadQualityBody,
  updateUploadDefaultsBody,
} from '@cameraderie/shared';
import { getDb } from '../db.js';
import { requireUser } from '../guards.js';
import { getUsage } from '../quota.js';
import { purgeMedia } from '../media-ops.js';
import { deleteObject, headObject, presignGet, presignPut } from '../r2.js';
import { parse } from '../validate.js';
import { badRequest } from '../errors.js';

export default async function accountRoutes(app: FastifyInstance) {
  const db = getDb();

  // Profile.
  app.get('/me', async (req) => {
    const me = await requireUser(req);
    const [row] = await db
      .select({
        avatarObjectKey: user.avatarObjectKey,
        image: user.image,
        defaultKeepGps: user.defaultKeepGps,
        defaultKeepCameraExif: user.defaultKeepCameraExif,
        defaultDownloadQuality: user.defaultDownloadQuality,
      })
      .from(user)
      .where(eq(user.id, me.id))
      .limit(1);
    const avatarUrl = row?.avatarObjectKey
      ? await presignGet(row.avatarObjectKey)
      : (row?.image ?? null);
    return {
      user: {
        id: me.id,
        email: me.email,
        name: me.name,
        plan: me.plan,
        acceptedTermsAt: me.acceptedTermsAt,
        avatarUrl,
        defaultKeepGps: row?.defaultKeepGps ?? true,
        defaultKeepCameraExif: row?.defaultKeepCameraExif ?? true,
        defaultDownloadQuality: row?.defaultDownloadQuality ?? 'original',
      },
    };
  });

  // Remembers the uploader's preferred download quality, so it's preselected
  // in quality dropdowns and used for the media page's 'd' shortcut.
  app.patch('/me/download-quality', async (req) => {
    const me = await requireUser(req);
    const body = parse(updateDownloadQualityBody, req.body);
    await db
      .update(user)
      .set({ defaultDownloadQuality: body.defaultDownloadQuality })
      .where(eq(user.id, me.id));
    return { ok: true };
  });

  // Remembers the uploader's last choice for what EXIF to keep, so the
  // upload flow can preselect it next time instead of defaulting cold.
  app.patch('/me/upload-defaults', async (req) => {
    const me = await requireUser(req);
    const body = parse(updateUploadDefaultsBody, req.body);
    await db
      .update(user)
      .set({
        ...(body.defaultKeepGps !== undefined && { defaultKeepGps: body.defaultKeepGps }),
        ...(body.defaultKeepCameraExif !== undefined && {
          defaultKeepCameraExif: body.defaultKeepCameraExif,
        }),
      })
      .where(eq(user.id, me.id));
    return { ok: true };
  });

  // Begin a direct-to-R2 avatar upload: presign a single PUT to a key
  // deterministic from the user id, so re-uploading overwrites the old image
  // instead of leaving orphans.
  app.post('/me/avatar/begin', async (req) => {
    const me = await requireUser(req);
    const body = parse(beginAvatarUploadBody, req.body);
    const key = avatarKey(me.id, body.contentType);
    const uploadUrl = await presignPut(key, body.contentType);
    return { key, uploadUrl };
  });

  // Confirm the avatar PUT landed, then adopt it as the user's avatar. The
  // key is recomputed server-side from the (trusted) session user id and the
  // declared content-type — never taken from the client.
  app.post('/me/avatar/complete', async (req) => {
    const me = await requireUser(req);
    const body = parse(beginAvatarUploadBody, req.body);
    const key = avatarKey(me.id, body.contentType);
    const head = await headObject(key);
    if (!head.exists) throw badRequest('Avatar upload not found');
    if ((head.sizeBytes ?? 0) > AVATAR_MAX_BYTES) {
      await deleteObject(key).catch(() => {});
      throw badRequest('Avatar image too large');
    }
    const [prev] = await db
      .select({ avatarObjectKey: user.avatarObjectKey })
      .from(user)
      .where(eq(user.id, me.id))
      .limit(1);
    if (prev?.avatarObjectKey && prev.avatarObjectKey !== key) {
      await deleteObject(prev.avatarObjectKey).catch(() => {});
    }
    await db.update(user).set({ avatarObjectKey: key }).where(eq(user.id, me.id));
    return { avatarUrl: await presignGet(key) };
  });

  // Remove my avatar.
  app.delete('/me/avatar', async (req, reply) => {
    const me = await requireUser(req);
    const [row] = await db
      .select({ avatarObjectKey: user.avatarObjectKey })
      .from(user)
      .where(eq(user.id, me.id))
      .limit(1);
    if (row?.avatarObjectKey) await deleteObject(row.avatarObjectKey).catch(() => {});
    await db.update(user).set({ avatarObjectKey: null }).where(eq(user.id, me.id));
    reply.code(204);
  });

  // Record 18+/Terms+Privacy consent. Called once, right after first sign-in,
  // from the web app's consent interstitial (see requireAcceptedTerms in
  // server.ts, which blocks every other route until this is set). This is a
  // self-attestation record, not identity-grade age verification.
  app.post('/me/accept-terms', async (req) => {
    const me = await requireUser(req);
    if (!me.acceptedTermsAt) {
      await db.update(user).set({ acceptedTermsAt: new Date() }).where(eq(user.id, me.id));
    }
    return { acceptedTermsAt: true };
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

  // 1b. Delete their avatar image, if any.
  const [profileRow] = await db
    .select({ avatarObjectKey: user.avatarObjectKey })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (profileRow?.avatarObjectKey) {
    await deleteObject(profileRow.avatarObjectKey).catch((err) => onR2Error?.(err));
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
