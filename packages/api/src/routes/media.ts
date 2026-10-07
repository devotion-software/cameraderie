import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { derivatives, favourites, media } from '@cameraderie/db';
import { getDb } from '../db.js';
import { requireMembership, requireUser } from '../guards.js';
import { serializeMedia, type MediaDto } from '../serialize.js';
import { presignGet, deleteObjects } from '../r2.js';
import { adjustUsedBytes } from '../quota.js';
import { forbidden, notFound } from '../errors.js';

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

export default async function mediaRoutes(app: FastifyInstance) {
  const db = getDb();

  // Paginated feed for a group (members only). Cursor by createdAt (ISO string).
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    '/groups/:id/media',
    async (req) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id);

      const limit = clampLimit(req.query.limit);
      const before = req.query.before ? new Date(req.query.before) : null;

      const where =
        before && !Number.isNaN(before.getTime())
          ? and(eq(media.groupId, req.params.id), lt(media.createdAt, before))
          : eq(media.groupId, req.params.id);

      const rows = await db
        .select()
        .from(media)
        .where(where)
        .orderBy(desc(media.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const items = await decorate(db, page, me.id);
      const nextCursor = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;
      return { media: items, nextCursor };
    },
  );

  // Media detail (members only).
  app.get<{ Params: { id: string } }>('/media/:id', async (req) => {
    const me = await requireUser(req);
    const row = await loadVisibleMedia(db, req.params.id, me.id);
    const [item] = await decorate(db, [row], me.id);
    return { media: item };
  });

  // Presigned URL for the untouched original (explicit download only).
  app.get<{ Params: { id: string } }>('/media/:id/download', async (req) => {
    const me = await requireUser(req);
    const row = await loadVisibleMedia(db, req.params.id, me.id);
    const url = await presignGet(row.objectKey, { downloadName: row.filename });
    return { url, filename: row.filename, sizeBytes: row.sizeBytes };
  });

  // Presigned URL for the streamable/preview derivative.
  app.get<{ Params: { id: string } }>('/media/:id/preview', async (req) => {
    const me = await requireUser(req);
    const row = await loadVisibleMedia(db, req.params.id, me.id);
    const [preview] = await db
      .select()
      .from(derivatives)
      .where(and(eq(derivatives.mediaId, row.id), eq(derivatives.kind, 'preview')))
      .limit(1);
    if (!preview || preview.state !== 'ready') throw notFound('Preview not ready');
    const url = await presignGet(preview.objectKey);
    return { url };
  });

  // Delete a photo (uploader or group owner). Removes DB rows + R2 objects and
  // refunds the uploader's quota.
  app.delete<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
    const me = await requireUser(req);
    const [row] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);
    if (!row) throw notFound('Media not found');

    const membership = await requireMembership(row.groupId, me.id);
    const isUploader = row.uploaderId === me.id;
    const isOwner = membership.role === 'owner';
    if (!isUploader && !isOwner) throw forbidden('Only the uploader or group owner can delete');

    const derivs = await db
      .select()
      .from(derivatives)
      .where(eq(derivatives.mediaId, row.id));

    const keys = [row.objectKey, ...derivs.map((d) => d.objectKey)];
    await deleteObjects(keys).catch((err) => req.log.error({ err }, 'R2 delete failed'));

    await db.delete(media).where(eq(media.id, row.id)); // cascades derivatives + favourites
    // Only refund quota if the bytes were charged (counted once it was stored).
    if (row.state === 'processing' || row.state === 'ready' || row.state === 'failed') {
      await adjustUsedBytes(row.uploaderId, -row.sizeBytes);
    }
    reply.code(204);
  });
}

function clampLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PAGE;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE;
  return Math.min(n, MAX_PAGE);
}

async function loadVisibleMedia(db: ReturnType<typeof getDb>, id: string, userId: string) {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw notFound('Media not found');
  await requireMembership(row.groupId, userId);
  return row;
}

/** Attach derivatives, favourite counts, and the viewer's favourite flag. */
async function decorate(
  db: ReturnType<typeof getDb>,
  rows: (typeof media.$inferSelect)[],
  userId: string,
): Promise<MediaDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [derivs, favCounts, myFavs] = await Promise.all([
    db.select().from(derivatives).where(inArray(derivatives.mediaId, ids)),
    db
      .select({ mediaId: favourites.mediaId, count: sql<number>`count(*)` })
      .from(favourites)
      .where(inArray(favourites.mediaId, ids))
      .groupBy(favourites.mediaId),
    db
      .select({ mediaId: favourites.mediaId })
      .from(favourites)
      .where(and(inArray(favourites.mediaId, ids), eq(favourites.userId, userId))),
  ]);

  const derivsByMedia = new Map<string, (typeof derivatives.$inferSelect)[]>();
  for (const d of derivs) {
    const list = derivsByMedia.get(d.mediaId) ?? [];
    list.push(d);
    derivsByMedia.set(d.mediaId, list);
  }
  const countByMedia = new Map(favCounts.map((c) => [c.mediaId, Number(c.count)]));
  const favouritedSet = new Set(myFavs.map((f) => f.mediaId));

  return Promise.all(
    rows.map((row) =>
      serializeMedia(
        row,
        derivsByMedia.get(row.id) ?? [],
        countByMedia.get(row.id) ?? 0,
        favouritedSet.has(row.id),
      ),
    ),
  );
}
