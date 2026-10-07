import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { groups, memberships, user } from '@cameraderie/db';
import { createGroupBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { requireMembership, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { forbidden, notFound } from '../errors.js';

export default async function groupsRoutes(app: FastifyInstance) {
  const db = getDb();

  // Create a group; the creator becomes its owner.
  app.post('/groups', async (req) => {
    const me = await requireUser(req);
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
    return { groups: rows.map((r) => ({ ...r.group, myRole: r.role })) };
  });

  // Group detail (members only).
  app.get<{ Params: { id: string } }>('/groups/:id', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id);
    const [group] = await db.select().from(groups).where(eq(groups.id, req.params.id)).limit(1);
    if (!group) throw notFound('Group not found');
    return { group };
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
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.groupId, req.params.id));
    return { members: rows };
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
