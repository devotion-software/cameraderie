import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { favourites, media, user } from '@cameraderie/db';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { requireMembership, requireUser } from '../guards.js';
import { notFound } from '../errors.js';

export default async function favouritesRoutes(app: FastifyInstance) {
  const db = getDb();

  // Favourite a photo (idempotent).
  app.put<{ Params: { id: string } }>('/media/:id/favourite', async (req) => {
    const me = await requireUser(req);
    await assertVisible(db, req.params.id, me.id);
    // Insert-or-ignore via the unique (media_id, user_id) index.
    await db
      .insert(favourites)
      .values({ id: newId(), mediaId: req.params.id, userId: me.id })
      .onDuplicateKeyUpdate({ set: { mediaId: req.params.id } });
    return { favourited: true };
  });

  // Un-favourite a photo (idempotent).
  app.delete<{ Params: { id: string } }>('/media/:id/favourite', async (req) => {
    const me = await requireUser(req);
    await db
      .delete(favourites)
      .where(and(eq(favourites.mediaId, req.params.id), eq(favourites.userId, me.id)));
    return { favourited: false };
  });

  // Favourite count + who favourited (members only).
  app.get<{ Params: { id: string } }>('/media/:id/favourites', async (req) => {
    const me = await requireUser(req);
    await assertVisible(db, req.params.id, me.id);
    const rows = await db
      .select({ userId: favourites.userId, name: user.name, image: user.image })
      .from(favourites)
      .innerJoin(user, eq(user.id, favourites.userId))
      .where(eq(favourites.mediaId, req.params.id));
    return { count: rows.length, users: rows };
  });
}

async function assertVisible(db: ReturnType<typeof getDb>, mediaId: string, userId: string) {
  const [row] = await db
    .select({ groupId: media.groupId })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!row) throw notFound('Media not found');
  await requireMembership(row.groupId, userId);
}
