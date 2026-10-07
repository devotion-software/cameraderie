import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { memberships, type Membership } from '@cameraderie/db';
import type { GroupRole } from '@cameraderie/shared';
import { auth } from './auth.js';
import { getDb } from './db.js';
import { forbidden, unauthorized } from './errors.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  usedBytes: number;
  plan: string;
  role: string;
}

/** Convert Fastify's incoming headers into a web `Headers` for Better Auth. */
export function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.append(key, value);
  }
  return headers;
}

/** Resolve the authenticated user or throw 401. Reads cookie or bearer token. */
export async function requireUser(req: FastifyRequest): Promise<SessionUser> {
  const res = await auth.api.getSession({ headers: toWebHeaders(req) });
  if (!res?.user) throw unauthorized();
  const u = res.user as unknown as SessionUser & Record<string, unknown>;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    usedBytes: typeof u.usedBytes === 'number' ? u.usedBytes : 0,
    plan: typeof u.plan === 'string' ? u.plan : 'free',
    role: typeof u.role === 'string' ? u.role : 'user',
  };
}

/** Require an authenticated site admin, or throw 403. */
export async function requireAdmin(req: FastifyRequest): Promise<SessionUser> {
  const me = await requireUser(req);
  if (me.role !== 'admin') throw forbidden('Admin access required');
  return me;
}

const ROLE_RANK: Record<GroupRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Require that `userId` is a member of `groupId`, optionally at least `minRole`.
 * Returns the membership row. Throws 403 otherwise — authorization is checked
 * on every request, not just at group entry.
 */
export async function requireMembership(
  groupId: string,
  userId: string,
  minRole: GroupRole = 'member',
): Promise<Membership> {
  const [m] = await getDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  if (!m) throw forbidden('You are not a member of this group');
  if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) {
    throw forbidden(`Requires ${minRole} role`);
  }
  return m;
}
