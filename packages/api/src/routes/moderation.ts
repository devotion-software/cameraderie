import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { groups, media, reports, user } from '@cameraderie/db';
import { reportMediaBody, resolveReportBody } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { requireAdmin, requireMembership, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { purgeMedia } from '../media-ops.js';
import { notFound } from '../errors.js';

export default async function moderationRoutes(app: FastifyInstance) {
  const db = getDb();

  // Report a media item (any group member). Idempotent per (media, reporter).
  app.post<{ Params: { id: string } }>('/media/:id/report', async (req) => {
    const me = await requireUser(req);
    const body = parse(reportMediaBody, req.body);
    const [row] = await db
      .select({ groupId: media.groupId })
      .from(media)
      .where(eq(media.id, req.params.id))
      .limit(1);
    if (!row) throw notFound('Media not found');
    await requireMembership(row.groupId, me.id);

    await db
      .insert(reports)
      .values({ id: newId(), mediaId: req.params.id, reporterId: me.id, reason: body.reason })
      .onDuplicateKeyUpdate({ set: { reason: body.reason, status: 'open' } });
    return { reported: true };
  });

  // ── Admin review ─────────────────────────────────────────────────────────────

  // List reports (default: open), newest first, with media + context.
  app.get<{ Querystring: { status?: 'open' | 'actioned' | 'dismissed' } }>(
    '/admin/reports',
    async (req) => {
      await requireAdmin(req);
      const status = req.query.status ?? 'open';
      const rows = await db
        .select({
          report: reports,
          mediaFilename: media.filename,
          mediaKind: media.kind,
          mediaState: media.state,
          groupId: media.groupId,
          groupName: groups.name,
          reporterName: user.name,
          reporterEmail: user.email,
        })
        .from(reports)
        .leftJoin(media, eq(media.id, reports.mediaId))
        .leftJoin(groups, eq(groups.id, media.groupId))
        .innerJoin(user, eq(user.id, reports.reporterId))
        .where(eq(reports.status, status))
        .orderBy(desc(reports.createdAt));
      return { reports: rows };
    },
  );

  // Resolve a report: 'actioned' takes the media down, 'dismissed' keeps it.
  app.post<{ Params: { id: string } }>('/admin/reports/:id/resolve', async (req) => {
    const admin = await requireAdmin(req);
    const body = parse(resolveReportBody, req.body);
    const [report] = await db.select().from(reports).where(eq(reports.id, req.params.id)).limit(1);
    if (!report) throw notFound('Report not found');

    if (body.action === 'actioned') {
      if (report.mediaId) {
        // Mark this + sibling open reports actioned FIRST, so the audit record
        // survives (reports.media_id is set null, not cascaded, on purge).
        await db
          .update(reports)
          .set({ status: 'actioned', reviewedBy: admin.id, reviewedAt: new Date() })
          .where(and(eq(reports.mediaId, report.mediaId), eq(reports.status, 'open')));
        const [row] = await db.select().from(media).where(eq(media.id, report.mediaId)).limit(1);
        if (row) await purgeMedia(row, (err) => req.log.error({ err }, 'takedown R2 delete failed'));
      } else {
        // Media already gone; just mark this report actioned.
        await db
          .update(reports)
          .set({ status: 'actioned', reviewedBy: admin.id, reviewedAt: new Date() })
          .where(eq(reports.id, report.id));
      }
    } else {
      await db
        .update(reports)
        .set({ status: 'dismissed', reviewedBy: admin.id, reviewedAt: new Date() })
        .where(eq(reports.id, report.id));
    }
    return { status: body.action };
  });
}
