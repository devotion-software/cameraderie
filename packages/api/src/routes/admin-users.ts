import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { user } from '@cameraderie/db';
import { updateUserPermissionsBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { requireAdmin } from '../guards.js';
import { parse } from '../validate.js';
import { badRequest, notFound } from '../errors.js';

/**
 * Admin-only user management: site role and the canCreateGroups /
 * canInviteMembers permission flags. No web UI exposes account deletion or
 * password resets here — just the access-control knobs for the invite-only
 * model.
 */
export default async function adminUsersRoutes(app: FastifyInstance) {
  const db = getDb();

  const adminUserColumns = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    canCreateGroups: user.canCreateGroups,
    canInviteMembers: user.canInviteMembers,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
  };

  app.get('/admin/users', async (req) => {
    await requireAdmin(req);
    const rows = await db.select(adminUserColumns).from(user).orderBy(desc(user.createdAt));
    return { users: rows };
  });

  app.patch<{ Params: { id: string } }>('/admin/users/:id', async (req) => {
    const admin = await requireAdmin(req);
    const { disabled, ...body } = parse(updateUserPermissionsBody, req.body ?? {});
    const [target] = await db.select().from(user).where(eq(user.id, req.params.id)).limit(1);
    if (!target) throw notFound('User not found');
    if (target.id === admin.id && body.role === 'user') {
      // An admin can always restore their own permission flags, but can't demote
      // themselves out of the admin role — that could leave the app with no admin.
      throw badRequest('You cannot remove your own admin role');
    }
    if (target.id === admin.id && disabled) {
      throw badRequest('You cannot disable your own account');
    }
    const patch: Partial<typeof user.$inferInsert> = { ...body };
    if (disabled !== undefined) patch.disabledAt = disabled ? new Date() : null;
    await db.update(user).set(patch).where(eq(user.id, req.params.id));
    const [updated] = await db
      .select(adminUserColumns)
      .from(user)
      .where(eq(user.id, req.params.id))
      .limit(1);
    return { user: updated };
  });
}
