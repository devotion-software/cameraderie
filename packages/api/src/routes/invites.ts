import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { groups, invites, memberships } from '@cameraderie/db';
import { createInviteBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId, newInviteCode } from '../ids.js';
import { requireMembership, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { conflict, notFound } from '../errors.js';

export default async function invitesRoutes(app: FastifyInstance) {
  const db = getDb();

  // Create an invite for a group (admin or owner).
  app.post<{ Params: { id: string } }>(
    '/groups/:id/invites',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id, 'admin');
    const body = parse(createInviteBody, req.body ?? {});
    const id = newId();
    const code = newInviteCode();
    await db.insert(invites).values({
      id,
      groupId: req.params.id,
      code,
      createdBy: me.id,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    return { invite: { id, code, groupId: req.params.id } };
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
