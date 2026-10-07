import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { media } from '@cameraderie/db';
import {
  beginUploadBody,
  completeUploadBody,
  classifyMedia,
  originalKey,
  type BeginUploadResponse,
} from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { requireMembership, requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { assertCanUpload, adjustUsedBytes } from '../quota.js';
import { createMultipartUpload, completeMultipartUpload, abortMultipartUpload, headObject } from '../r2.js';
import { enqueueDerivatives } from '../queue.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';

export default async function uploadRoutes(app: FastifyInstance) {
  const db = getDb();

  // Step 1 — begin. Checks membership + quota, reserves a media row, and
  // returns presigned multipart URLs. No bytes have moved yet.
  app.post('/media/uploads', async (req) => {
    const me = await requireUser(req);
    const body = parse(beginUploadBody, req.body);
    await requireMembership(body.groupId, me.id);

    // Enforce quota before any bytes are sent.
    await assertCanUpload(me.id, body.sizeBytes);

    const mediaId = newId();
    const kind = classifyMedia(body.filename, body.mimeType);
    const key = originalKey(mediaId, body.filename);

    const multipart = await createMultipartUpload(key, body.sizeBytes, body.mimeType ?? undefined);

    await db.insert(media).values({
      id: mediaId,
      groupId: body.groupId,
      uploaderId: me.id,
      kind,
      state: 'uploading',
      filename: body.filename,
      mimeType: body.mimeType ?? null,
      sizeBytes: body.sizeBytes,
      checksumSha256: body.checksumSha256,
      objectKey: key,
      r2UploadId: multipart.uploadId,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
    });

    const response: BeginUploadResponse = {
      mediaId,
      r2UploadId: multipart.uploadId,
      key,
      partSizeBytes: multipart.partSizeBytes,
      parts: multipart.parts,
    };
    return response;
  });

  // Step 2 — complete. Finalizes the multipart upload, verifies the stored
  // size, charges quota, and enqueues derivative generation. The deep SHA-256
  // re-verification happens in the worker, which downloads the original anyway.
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/media/uploads/:id/complete',
    async (req) => {
      const me = await requireUser(req);
      const body = parse(completeUploadBody, req.body);
      const row = await loadOwnPendingUpload(db, req.params.id, me.id);

      if (!row.r2UploadId) throw conflict('Upload is not in progress');

      await completeMultipartUpload(
        row.objectKey,
        row.r2UploadId,
        body.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );

      // Verify the object landed and matches the declared size.
      const head = await headObject(row.objectKey);
      if (!head.exists) {
        await db.update(media).set({ state: 'failed', r2UploadId: null }).where(eq(media.id, row.id));
        throw badRequest('Upload did not land in storage', 'upload_missing');
      }
      if (typeof head.sizeBytes === 'number' && head.sizeBytes !== row.sizeBytes) {
        await db.update(media).set({ state: 'failed', r2UploadId: null }).where(eq(media.id, row.id));
        throw badRequest(
          `Stored size ${head.sizeBytes} does not match declared ${row.sizeBytes}`,
          'size_mismatch',
        );
      }

      await db
        .update(media)
        .set({ state: 'processing', r2UploadId: null })
        .where(eq(media.id, row.id));
      await adjustUsedBytes(me.id, row.sizeBytes);
      await enqueueDerivatives(row.id);

      return { mediaId: row.id, state: 'processing' };
    },
  );

  // Step 3 — abort. Releases a cancelled/failed upload and removes the reserved
  // row. No quota was charged, so nothing to refund.
  app.post<{ Params: { id: string } }>('/media/uploads/:id/abort', async (req, reply) => {
    const me = await requireUser(req);
    const row = await loadOwnPendingUpload(db, req.params.id, me.id);
    if (row.r2UploadId) {
      await abortMultipartUpload(row.objectKey, row.r2UploadId).catch(() => {});
    }
    await db.delete(media).where(eq(media.id, row.id));
    reply.code(204);
  });
}

async function loadOwnPendingUpload(
  db: ReturnType<typeof getDb>,
  id: string,
  userId: string,
) {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw notFound('Upload not found');
  if (row.uploaderId !== userId) throw forbidden('Not your upload');
  if (row.state !== 'uploading' && row.state !== 'pending') {
    throw conflict(`Upload is already ${row.state}`);
  }
  return row;
}
