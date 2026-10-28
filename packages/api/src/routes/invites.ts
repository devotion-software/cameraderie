import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { groups, invites, memberships } from '@cameraderie/db';
import { createInviteBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId, newInviteCode } from '../ids.js';
import { requireMembership, requirePermission, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { conflict, forbidden, notFound } from '../errors.js';

export default async function invitesRoutes(app: FastifyInstance) {
  const db = getDb();

  // Create an invite for a group (admin or owner, with the invite permission).
  app.post<{ Params: { id: string } }>(
    '/groups/:id/invites',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id, 'admin');
      requirePermission(me, 'canInviteMembers');
      const body = parse(createInviteBody, req.body ?? {});
      const id = newId();
      const code = newInviteCode();
      const maxUses = body.maxUses ?? null;
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      const createdAt = new Date();
      await db.insert(invites).values({
        id,
        groupId: req.params.id,
        code,
        createdBy: me.id,
        inviteeEmail: body.email ? body.email.toLowerCase() : null,
        maxUses,
        expiresAt,
        createdAt,
      });
      return {
        invite: {
          id,
          code,
          groupId: req.params.id,
          inviteeEmail: body.email ?? null,
          maxUses,
          uses: 0,
          expiresAt,
          createdAt,
        },
      };
    },
  );

  // List pending (not expired, not exhausted) invites for a group.
  app.get<{ Params: { id: string } }>('/groups/:id/invites', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'admin');
    const rows = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.groupId, req.params.id),
          or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
          or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses)),
        ),
      );
    return {
      invites: rows.map((r) => ({
        id: r.id,
        code: r.code,
        inviteeEmail: r.inviteeEmail,
        maxUses: r.maxUses,
        uses: r.uses,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    };
  });

  // Revoke a pending invite before it's used.
  app.delete<{ Params: { id: string; inviteId: string } }>(
    '/groups/:id/invites/:inviteId',
    async (req, reply) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id, 'admin');
      const [invite] = await db
        .select()
        .from(invites)
        .where(and(eq(invites.id, req.params.inviteId), eq(invites.groupId, req.params.id)))
        .limit(1);
      if (!invite) throw notFound('Invite not found');
      await db.delete(invites).where(eq(invites.id, req.params.inviteId));
      reply.code(204);
    },
  );

  // Preview an invite (public-ish: any authenticated user can look it up).
  app.get<{ Params: { code: string } }>('/invites/:code', async (req) => {
    await requireUser(req);
    const [row] = await db
      .select({ invite: invites, group: groups })
      .from(invites)
      .innerJoin(groups, eq(groups.id, invites.groupId))
      .where(eq(invites.code, req.params.code))
      .limit(1);
    if (!row) throw notFound('Invite not found');
    return {
      group: { id: row.group.id, name: row.group.name, description: row.group.description },
      expired: isExpired(row.invite.expiresAt),
    };
  });

  // List my pending invitations (invites addressed to my email, for groups
  // I haven't already joined).
  app.get('/me/invites', async (req) => {
    const me = await requireUser(req);
    const email = me.email.toLowerCase();
    const rows = await db
      .select({ invite: invites, group: groups })
      .from(invites)
      .innerJoin(groups, eq(groups.id, invites.groupId))
      .leftJoin(
        memberships,
        and(eq(memberships.groupId, invites.groupId), eq(memberships.userId, me.id)),
      )
      .where(
        and(
          eq(invites.inviteeEmail, email),
          isNull(memberships.id),
          or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
          or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses)),
        ),
      );
    return {
      invites: rows.map((r) => ({
        id: r.invite.id,
        code: r.invite.code,
        groupId: r.group.id,
        groupName: r.group.name,
        expiresAt: r.invite.expiresAt,
        createdAt: r.invite.createdAt,
      })),
    };
  });

  // Decline one of my pending invitations.
  app.post<{ Params: { code: string } }>('/invites/:code/decline', async (req, reply) => {
    const me = await requireUser(req);
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.code, req.params.code))
      .limit(1);
    if (!invite) throw notFound('Invite not found');
    if (invite.inviteeEmail !== me.email.toLowerCase()) {
      throw forbidden('This invite was addressed to a different email address');
    }
    await db.delete(invites).where(eq(invites.id, invite.id));
    reply.code(204);
  });

  // Accept an invite and join the group.
  app.post<{ Params: { code: string } }>('/invites/:code/accept', async (req) => {
    const me = await requireUser(req);
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.code, req.params.code))
      .limit(1);
    if (!invite) throw notFound('Invite not found');
    if (isExpired(invite.expiresAt)) throw conflict('Invite has expired', 'invite_expired');
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw conflict('Invite has been used up', 'invite_exhausted');
    }
    if (invite.inviteeEmail && invite.inviteeEmail !== me.email.toLowerCase()) {
      throw forbidden('This invite was addressed to a different email address');
    }

    const [existing] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, invite.groupId), eq(memberships.userId, me.id)))
      .limit(1);
    if (existing) return { groupId: invite.groupId, alreadyMember: true };

    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({
        id: newId(),
        groupId: invite.groupId,
        userId: me.id,
        role: 'member',
      });
      await tx
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(eq(invites.id, invite.id));
    });
    return { groupId: invite.groupId, alreadyMember: false };
  });
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}
