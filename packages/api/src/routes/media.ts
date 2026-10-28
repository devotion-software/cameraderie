import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import archiver from 'archiver';
import sharp from 'sharp';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { derivatives, favourites, media, user } from '@cameraderie/db';
import {
  downloadZipBody,
  IMAGE_DOWNLOAD_QUALITY_SPECS,
  type DownloadQuality,
} from '@cameraderie/shared';
import { getDb } from '../db.js';
import { requireMembership, requireUser } from '../guards.js';
import { serializeMedia, type MediaDto } from '../serialize.js';
import { avatarUrlsFor } from '../avatars.js';
import { getObjectStream, presignGet } from '../r2.js';
import { purgeMedia } from '../media-ops.js';
import { parse } from '../validate.js';
import { badRequest, forbidden, notFound } from '../errors.js';

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

export default async function mediaRoutes(app: FastifyInstance) {
  const db = getDb();

  // Paginated feed for a group (members only). Cursor by createdAt (ISO string).
  app.get<{
    Params: { id: string };
    Querystring: {
      limit?: string;
      before?: string;
      sort?: string;
      liked?: string;
      uploaderIds?: string;
    };
  }>('/groups/:id/media', async (req) => {
    const me = await requireUser(req);
    await requireMembership(req.params.id, me.id);

    const limit = clampLimit(req.query.limit);
    const before = req.query.before ? new Date(req.query.before) : null;
    const oldest = req.query.sort === 'oldest';
    const likedOnly = req.query.liked === 'true';
    const uploaderIds = req.query.uploaderIds?.split(',').filter(Boolean) ?? [];

    // Quarantined items are never listed — they exist only as preserved
    // evidence (see the worker's content-safety path).
    const conditions = [eq(media.groupId, req.params.id), ne(media.state, 'quarantined')];

    if (before && !Number.isNaN(before.getTime())) {
      conditions.push(oldest ? gt(media.createdAt, before) : lt(media.createdAt, before));
    }

    if (likedOnly) {
      const likedRows = await db
        .select({ id: favourites.mediaId })
        .from(favourites)
        .where(eq(favourites.userId, me.id));
      const likedIds = likedRows.map((r) => r.id);
      if (likedIds.length === 0) return { media: [], nextCursor: null };
      conditions.push(inArray(media.id, likedIds));
    }

    if (uploaderIds.length > 0) {
      conditions.push(inArray(media.uploaderId, uploaderIds));
    }

    const rows = await db
      .select()
      .from(media)
      .where(and(...conditions))
      .orderBy(oldest ? asc(media.createdAt) : desc(media.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = await decorate(db, page, me.id);
    const nextCursor = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;
    return { media: items, nextCursor };
  });

  // All geotagged media in a group, for the map view (members only). Not
  // paginated — a lightweight projection (no presigned URLs) so plotting a
  // few thousand pins stays cheap.
  app.get<{ Params: { id: string }; Querystring: { liked?: string; uploaderIds?: string } }>(
    '/groups/:id/media/locations',
    async (req) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id);
      const likedOnly = req.query.liked === 'true';
      const uploaderIds = req.query.uploaderIds?.split(',').filter(Boolean) ?? [];

      const conditions = [
        eq(media.groupId, req.params.id),
        ne(media.state, 'quarantined'),
        isNotNull(media.latitude),
        isNotNull(media.longitude),
      ];

      if (likedOnly) {
        const likedRows = await db
          .select({ id: favourites.mediaId })
          .from(favourites)
          .where(eq(favourites.userId, me.id));
        const likedIds = likedRows.map((r) => r.id);
        if (likedIds.length === 0) return { media: [] };
        conditions.push(inArray(media.id, likedIds));
      }

      if (uploaderIds.length > 0) {
        conditions.push(inArray(media.uploaderId, uploaderIds));
      }

      const rows = await db
        .select({
          id: media.id,
          kind: media.kind,
          filename: media.filename,
          latitude: media.latitude,
          longitude: media.longitude,
        })
        .from(media)
        .where(and(...conditions));
      return { media: rows };
    },
  );

  // Duplicate check (members only) — does this group already have a photo/video
  // with this exact checksum? Used by the web upload flow to warn before
  // re-uploading something someone (anyone in the group) already added.
  // Byte-identical only: a re-encoded or EXIF-stripped copy won't match.
  app.get<{ Params: { id: string }; Querystring: { checksum?: string } }>(
    '/groups/:id/media/duplicate',
    async (req) => {
      const me = await requireUser(req);
      await requireMembership(req.params.id, me.id);
      const checksum = req.query.checksum;
      if (!checksum || !/^[0-9a-f]{64}$/i.test(checksum)) {
        return { duplicate: null };
      }
      const [row] = await db
        .select()
        .from(media)
        .where(
          and(
            eq(media.groupId, req.params.id),
            eq(media.checksumSha256, checksum.toLowerCase()),
            eq(media.state, 'ready'),
          ),
        )
        .limit(1);
      if (!row) return { duplicate: null };
      const [item] = await decorate(db, [row], me.id);
      return { duplicate: item ?? null };
    },
  );

  // Media detail (members only).
  app.get<{ Params: { id: string } }>('/media/:id', async (req) => {
    const me = await requireUser(req);
    const row = await loadVisibleMedia(db, req.params.id, me.id);
    const [item] = await decorate(db, [row], me.id);
    return { media: item };
  });

  // Presigned URL for the untouched original, or — for anything but the
  // 'original' quality — a resized/compressed version streamed through the API.
  app.get<{ Params: { id: string }; Querystring: { quality?: string } }>(
    '/media/:id/download',
    async (req, reply) => {
      const me = await requireUser(req);
      const row = await loadVisibleMedia(db, req.params.id, me.id);
      const quality = parseQuality(req.query.quality);

      if (quality === 'original') {
        const url = await presignGet(row.objectKey, { downloadName: row.filename });
        return { url, filename: row.filename, sizeBytes: row.sizeBytes };
      }

      const { stream, filename, contentType } = await resolveDownloadSource(db, row, quality);
      reply.header('content-type', contentType);
      reply.header('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return reply.send(stream);
    },
  );

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

  // Stream a zip of several originals at once (all must share one group).
  app.post(
    '/media/zip',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = await requireUser(req);
      const body = parse(downloadZipBody, req.body ?? {});

      const rows = await db.select().from(media).where(inArray(media.id, body.mediaIds));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const found = body.mediaIds.map((id) => byId.get(id));
      if (found.some((r) => !r || r.state === 'quarantined')) throw notFound('Media not found');
      const ordered = found as (typeof media.$inferSelect)[];

      const groupId = ordered[0]!.groupId;
      if (ordered.some((r) => r.groupId !== groupId)) {
        throw badRequest('All media must belong to the same group');
      }
      await requireMembership(groupId, me.id);

      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', 'attachment; filename="photos.zip"');

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('warning', (err: Error) => req.log.warn({ err }, 'zip warning'));
      archive.on('error', (err: Error) => req.log.error({ err }, 'zip stream error'));

      void appendMediaToArchive(db, archive, ordered, body.quality).catch((err) => {
        req.log.error({ err }, 'zip build failed');
        archive.abort();
      });

      return reply.send(archive);
    },
  );

  // Delete a photo (uploader or group owner). Removes DB rows + R2 objects and
  // refunds the uploader's quota.
  app.delete<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
    const me = await requireUser(req);
    const [row] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);
    if (!row) throw notFound('Media not found');
    // Quarantined evidence must be preserved — it can't be deleted through the
    // app; an operator removes it out-of-band once it's been reported/preserved.
    if (row.state === 'quarantined') throw notFound('Media not found');

    const membership = await requireMembership(row.groupId, me.id);
    const isUploader = row.uploaderId === me.id;
    const isOwner = membership.role === 'owner';
    if (!isUploader && !isOwner) throw forbidden('Only the uploader or group owner can delete');

    await purgeMedia(row, (err) => req.log.error({ err }, 'R2 delete failed'));
    reply.code(204);
  });
}

/** Append each item's bytes (at the requested quality) under a collision-free name. */
async function appendMediaToArchive(
  db: ReturnType<typeof getDb>,
  archive: archiver.Archiver,
  rows: (typeof media.$inferSelect)[],
  quality: DownloadQuality,
): Promise<void> {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const { stream, filename } =
      quality === 'original'
        ? { stream: await getObjectStream(row.objectKey), filename: row.filename }
        : await resolveDownloadSource(db, row, quality);
    archive.append(stream, { name: uniqueFilename(filename, seen) });
  }
  await archive.finalize();
}

function parseQuality(raw: string | undefined): DownloadQuality {
  return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : 'original';
}

/** Swap a filename's extension, keeping the base name. */
function withExtension(filename: string, ext: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename) + ext;
}

async function loadReadyDerivative(
  db: ReturnType<typeof getDb>,
  mediaId: string,
  kind: 'thumbnail' | 'preview',
) {
  const [row] = await db
    .select()
    .from(derivatives)
    .where(and(eq(derivatives.mediaId, mediaId), eq(derivatives.kind, kind)))
    .limit(1);
  if (!row || row.state !== 'ready') throw notFound(`${kind} not ready`);
  return row;
}

/**
 * Resolve the bytes to serve for a given quality: the original download
 * (handled separately by the caller), the video preview transcode, or an
 * on-the-fly resize for images. RAW has no original-quality decode available
 * outside the worker, so non-original RAW downloads resize from its preview
 * instead of the untouched sensor data.
 */
async function resolveDownloadSource(
  db: ReturnType<typeof getDb>,
  row: typeof media.$inferSelect,
  quality: Exclude<DownloadQuality, 'original'>,
): Promise<{ stream: Readable; filename: string; contentType: string }> {
  if (row.kind === 'video') {
    const preview = await loadReadyDerivative(db, row.id, 'preview');
    return {
      stream: await getObjectStream(preview.objectKey),
      filename: withExtension(row.filename, '.mp4'),
      contentType: 'video/mp4',
    };
  }

  const sourceKey =
    row.kind === 'raw'
      ? (await loadReadyDerivative(db, row.id, 'preview')).objectKey
      : row.objectKey;
  const source = await getObjectStream(sourceKey);
  const spec = IMAGE_DOWNLOAD_QUALITY_SPECS[quality];
  const resized = source.pipe(
    sharp()
      .rotate()
      .resize({
        width: spec.maxEdge,
        height: spec.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: spec.quality }),
  );
  return {
    stream: resized,
    filename: withExtension(row.filename, '.jpg'),
    contentType: 'image/jpeg',
  };
}

/** Disambiguate repeated filenames ("IMG_0001.jpg" -> "IMG_0001 (1).jpg"). */
function uniqueFilename(filename: string, seen: Map<string, number>): string {
  const count = seen.get(filename) ?? 0;
  seen.set(filename, count + 1);
  if (count === 0) return filename;
  const dot = filename.lastIndexOf('.');
  return dot > 0
    ? `${filename.slice(0, dot)} (${count})${filename.slice(dot)}`
    : `${filename} (${count})`;
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
  // Quarantined originals/derivatives are never served to anyone — this guards
  // media detail, download, and preview in one place.
  if (row.state === 'quarantined') throw notFound('Media not found');
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
  const uploaderIds = [...new Set(rows.map((r) => r.uploaderId))];

  const [derivs, favCounts, myFavs, uploaderRows] = await Promise.all([
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
    db
      .select({
        userId: user.id,
        name: user.name,
        image: user.image,
        avatarObjectKey: user.avatarObjectKey,
      })
      .from(user)
      .where(inArray(user.id, uploaderIds)),
  ]);

  const derivsByMedia = new Map<string, (typeof derivatives.$inferSelect)[]>();
  for (const d of derivs) {
    const list = derivsByMedia.get(d.mediaId) ?? [];
    list.push(d);
    derivsByMedia.set(d.mediaId, list);
  }
  const countByMedia = new Map(favCounts.map((c) => [c.mediaId, Number(c.count)]));
  const favouritedSet = new Set(myFavs.map((f) => f.mediaId));
  const uploaderAvatars = await avatarUrlsFor(uploaderRows);
  const uploaderNames = new Map(uploaderRows.map((u) => [u.userId, u.name]));

  return Promise.all(
    rows.map((row) =>
      serializeMedia(
        row,
        derivsByMedia.get(row.id) ?? [],
        countByMedia.get(row.id) ?? 0,
        favouritedSet.has(row.id),
        {
          name: uploaderNames.get(row.uploaderId) ?? null,
          avatarUrl: uploaderAvatars[row.uploaderId] ?? null,
        },
      ),
    ),
  );
}
