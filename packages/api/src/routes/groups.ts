import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { derivatives, groups, media, memberships, user } from '@cameraderie/db';
import { createGroupBody, setGroupCoverBody, updateGroupBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { presignGet } from '../r2.js';
import { avatarUrlsFor } from '../avatars.js';
import { requireMembership, requirePermission, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { badRequest, forbidden, notFound } from '../errors.js';

/** Batch-presign the ready thumbnail for each of the given media ids, if any. */
async function coverThumbnailUrls(mediaIds: string[]): Promise<Record<string, string>> {
  const ids = mediaIds.filter(Boolean);
  if (ids.length === 0) return {};
  const rows = await getDb()
    .select({ mediaId: derivatives.mediaId, objectKey: derivatives.objectKey })
    .from(derivatives)
    .where(
      and(
        inArray(derivatives.mediaId, ids),
        eq(derivatives.kind, 'thumbnail'),
        eq(derivatives.state, 'ready'),
      ),
    );
  const entries = await Promise.all(
    rows.map(async (r) => [r.mediaId, await presignGet(r.objectKey)] as const),
  );
  return Object.fromEntries(entries);
}

/** Photo/video counts and total storage used by a group's media (excludes quarantined). */
async function groupStats(groupId: string, userId: string) {
  const db = getDb();
  const [rows, [mine]] = await Promise.all([
    db
      .select({
        kind: media.kind,
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(${media.sizeBytes}), 0)`,
      })
      .from(media)
      .where(and(eq(media.groupId, groupId), ne(media.state, 'quarantined')))
      .groupBy(media.kind),
    db
      .select({ bytes: sql<number>`coalesce(sum(${media.sizeBytes}), 0)` })
      .from(media)
      .where(
        and(
          eq(media.groupId, groupId),
          eq(media.uploaderId, userId),
          ne(media.state, 'quarantined'),
        ),
      ),
  ]);

  let photoCount = 0;
  let videoCount = 0;
  let totalBytes = 0;
  for (const r of rows) {
    totalBytes += Number(r.bytes);
    if (r.kind === 'video') videoCount += Number(r.count);
    else photoCount += Number(r.count);
  }
  return {
    mediaCount: photoCount + videoCount,
    photoCount,
    videoCount,
    totalBytes,
    myBytes: Number(mine?.bytes ?? 0),
  };
}

export default async function groupsRoutes(app: FastifyInstance) {
  const db = getDb();

  // Create a group; the creator becomes its owner.
  app.post('/groups', async (req) => {
    const me = await requireUser(req);
    requirePermission(me, 'canCreateGroups');
    const body = parse(createGroupBody, req.body);
    const groupId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId,
        name: body.name,
        description: body.description ?? null,
        ownerId: me.id,
      });
      await tx.insert(memberships).values({
        id: newId(),
        groupId,
        userId: me.id,
        role: 'owner',
      });
    });
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    return { group };
  });

  // List the groups I belong to, with member counts.
  app.get('/groups', async (req) => {
    const me = await requireUser(req);
    const rows = await db
      .select({ group: groups, role: memberships.role })
      .from(memberships)
      .innerJoin(groups, eq(groups.id, memberships.groupId))
      .where(eq(memberships.userId, me.id))
      .orderBy(desc(groups.createdAt));
    const covers = await coverThumbnailUrls(rows.map((r) => r.group.coverMediaId ?? ''));
    return {
      groups: rows.map((r) => ({
        ...r.group,
        myRole: r.role,
        coverThumbnailUrl: r.group.coverMediaId ? (covers[r.group.coverMediaId] ?? null) : null,
      })),
    };
  });

  // Group detail (members only).
  app.get<{ Params: { id: string } }>('/groups/:id', async (req) => {
    const me = await requireUser(req);
    const membership = await requireMembership(req.params.id, me.id);
    const [group] = await db.select().from(groups).where(eq(groups.id, req.params.id)).limit(1);
    if (!group) throw notFound('Group not found');
    const [covers, stats] = await Promise.all([
      coverThumbnailUrls([group.coverMediaId ?? '']),
      groupStats(req.params.id, me.id),
    ]);
    return {
      group: {
        ...group,
        myRole: membership.role,
        coverThumbnailUrl: group.coverMediaId ? (covers[group.coverMediaId] ?? null) : null,
        ...stats,
      },
    };
  });

  // Rename a group (admin/owner only).
  app.patch<{ Params: { id: string } }>('/groups/:id', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'admin');
    const body = parse(updateGroupBody, req.body);
    await db.update(groups).set({ name: body.name }).where(eq(groups.id, req.params.id));
    const [group] = await db.select().from(groups).where(eq(groups.id, req.params.id)).limit(1);
    if (!group) throw notFound('Group not found');
    return { group };
  });

  // Set the group's cover photo to one of its own media items (admin/owner only).
  app.put<{ Params: { id: string } }>('/groups/:id/cover', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'admin');
    const body = parse(setGroupCoverBody, req.body);
    const [item] = await db
      .select({ id: media.id, groupId: media.groupId, state: media.state })
      .from(media)
      .where(eq(media.id, body.mediaId))
      .limit(1);
    if (!item || item.groupId !== req.params.id) throw notFound('Media not found in this group');
    if (item.state !== 'ready') throw badRequest('Media is not ready to use as a cover');
    await db.update(groups).set({ coverMediaId: item.id }).where(eq(groups.id, req.params.id));
    const covers = await coverThumbnailUrls([item.id]);
    return { coverMediaId: item.id, coverThumbnailUrl: covers[item.id] ?? null };
  });

  // Clear the group's cover photo (admin/owner only).
  app.delete<{ Params: { id: string } }>('/groups/:id/cover', async (req, reply) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'admin');
    await db.update(groups).set({ coverMediaId: null }).where(eq(groups.id, req.params.id));
    reply.code(204);
  });

  // List members (members only).
  app.get<{ Params: { id: string } }>('/groups/:id/members', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id);
    const rows = await db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        joinedAt: memberships.createdAt,
        name: user.name,
        email: user.email,
        image: user.image,
        avatarObjectKey: user.avatarObjectKey,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.groupId, req.params.id));
    const [avatars, counts, totalCounts] = await Promise.all([
      avatarUrlsFor(rows),
      db
        .select({ uploaderId: media.uploaderId, count: sql<number>`count(*)` })
        .from(media)
        .where(
          and(
            eq(media.groupId, req.params.id),
            ne(media.state, 'quarantined'),
            ne(media.kind, 'video'),
          ),
        )
        .groupBy(media.uploaderId),
      // Photos + videos combined, for the "filter by uploader" picker.
      db
        .select({ uploaderId: media.uploaderId, count: sql<number>`count(*)` })
        .from(media)
        .where(and(eq(media.groupId, req.params.id), ne(media.state, 'quarantined')))
        .groupBy(media.uploaderId),
    ]);
    const photoCounts = Object.fromEntries(counts.map((c) => [c.uploaderId, Number(c.count)]));
    const mediaCounts = Object.fromEntries(
      totalCounts.map((c) => [c.uploaderId, Number(c.count)]),
    );
    return {
      members: rows.map(({ avatarObjectKey, ...m }) => ({
        ...m,
        avatarUrl: avatars[m.userId] ?? null,
        photoCount: photoCounts[m.userId] ?? 0,
        mediaCount: mediaCounts[m.userId] ?? 0,
      })),
    };
  });

  // Remove a member (owner only; cannot remove the owner).
  app.delete<{ Params: { id: string; userId: string } }>(
    '/groups/:id/members/:userId',
    async (req, reply) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id, 'owner');
      const [target] = await db
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.groupId, req.params.id), eq(memberships.userId, req.params.userId)),
        )
        .limit(1);
      if (!target) throw notFound('Member not found');
      if (target.role === 'owner') throw forbidden('Cannot remove the group owner');
      await db
        .delete(memberships)
        .where(
          and(eq(memberships.groupId, req.params.id), eq(memberships.userId, req.params.userId)),
        );
      reply.code(204);
    },
  );

  // Leave a group (owner must transfer or delete instead).
  app.post<{ Params: { id: string } }>('/groups/:id/leave', async (req, reply) => {
    const me = await requireUser(req);
    const m = await requireMembership(req.params.id, me.id);
    if (m.role === 'owner') {
      throw forbidden('Owners cannot leave; transfer ownership or delete the group');
    }
    await db
      .delete(memberships)
      .where(and(eq(memberships.groupId, req.params.id), eq(memberships.userId, me.id)));
    reply.code(204);
  });

  // Delete a group (owner only). Cascades to media/derivatives rows; R2 cleanup
  // is handled by a reconciliation job (see worker).
  app.delete<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'owner');
    await db.delete(groups).where(eq(groups.id, req.params.id));
    reply.code(204);
  });
}
