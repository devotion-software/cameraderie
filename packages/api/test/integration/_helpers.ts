import { sql } from 'drizzle-orm';
import { user, groups, memberships, media, derivatives, reports } from '@cameraderie/db';
import type { Media } from '@cameraderie/db';
import type { GroupRole, MediaKind, DerivativeKind } from '@cameraderie/shared';
import { getDb, closeDb } from '../../src/db.js';
import { newId } from '../../src/ids.js';

export { getDb, closeDb };

// Child tables first so plain DELETEs respect FKs; we also disable FK checks to
// be safe against future ordering changes.
const TABLES = [
  'favourites',
  'derivatives',
  'reports',
  'media',
  'invites',
  'memberships',
  'groups',
  'subscriptions',
  'webhook_events',
  'verification',
  'account',
  'session',
  'user',
];

/** Wipe all rows between tests for isolation. */
export async function resetDb(): Promise<void> {
  const db = getDb();
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const t of TABLES) await db.execute(sql.raw(`DELETE FROM \`${t}\``));
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

export async function makeUser(
  opts: { id?: string; email?: string; name?: string; usedBytes?: number; plan?: string; role?: string } = {},
): Promise<string> {
  const id = opts.id ?? newId();
  await getDb().insert(user).values({
    id,
    name: opts.name ?? `User ${id.slice(0, 4)}`,
    email: opts.email ?? `${id}@test.local`,
    emailVerified: false,
    usedBytes: opts.usedBytes ?? 0,
    plan: opts.plan ?? 'free',
    role: opts.role ?? 'user',
  });
  return id;
}

export async function makeGroup(ownerId: string, opts: { name?: string } = {}): Promise<string> {
  const id = newId();
  await getDb().insert(groups).values({ id, name: opts.name ?? `Group ${id.slice(0, 4)}`, ownerId });
  return id;
}

export async function makeMembership(
  groupId: string,
  userId: string,
  opts: { role?: GroupRole; createdAt?: Date } = {},
): Promise<string> {
  const id = newId();
  await getDb()
    .insert(memberships)
    .values({
      id,
      groupId,
      userId,
      role: opts.role ?? 'member',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
  return id;
}

export async function makeMedia(
  groupId: string,
  uploaderId: string,
  opts: { state?: Media['state']; sizeBytes?: number; kind?: MediaKind } = {},
): Promise<string> {
  const id = newId();
  await getDb().insert(media).values({
    id,
    groupId,
    uploaderId,
    kind: opts.kind ?? 'image',
    state: opts.state ?? 'ready',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: opts.sizeBytes ?? 1000,
    checksumSha256: 'a'.repeat(64),
    objectKey: `originals/${id}/original.jpg`,
  });
  return id;
}

export async function makeDerivative(mediaId: string, kind: DerivativeKind = 'thumbnail'): Promise<string> {
  const id = newId();
  await getDb()
    .insert(derivatives)
    .values({ id, mediaId, kind, state: 'ready', objectKey: `derivatives/${mediaId}/${kind}.webp` });
  return id;
}

export async function makeReport(mediaId: string, reporterId: string, reason = 'inappropriate'): Promise<string> {
  const id = newId();
  await getDb().insert(reports).values({ id, mediaId, reporterId, reason });
  return id;
}
