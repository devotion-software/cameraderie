import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { auth } from './auth.js';
import { loadEnv } from './env.js';
import { AppError } from './errors.js';
import { captureError } from './observability.js';
import { toWebHeaders } from './guards.js';
import groupsRoutes from './routes/groups.js';
import invitesRoutes from './routes/invites.js';
import uploadRoutes from './routes/uploads.js';
import mediaRoutes from './routes/media.js';
import favouritesRoutes from './routes/favourites.js';
import accountRoutes from './routes/account.js';
import billingRoutes from './routes/billing.js';
import moderationRoutes from './routes/moderation.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    // Bytes never pass through the API; keep the JSON body limit modest.
    bodyLimit: 1024 * 1024,
  });

  // Parse JSON but also retain the raw buffer on `request.rawBody` — Stripe
  // webhook signature verification needs the exact bytes that were signed.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      if (body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: [env.WEB_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Global IP rate limit; individual routes (uploads, invites) tighten this
  // further via their own `config.rateLimit`.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  // Consistent error shape.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ error: err.code, message: err.message });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) captureError(err);
    reply
      .code(status)
      .send({ error: 'internal_error', message: status >= 500 ? 'Internal server error' : err.message });
  });

  app.get('/health', async () => ({ ok: true }));

  // ── Better Auth catch-all ──────────────────────────────────────────────
  // @fastify/cors owns CORS headers, so we skip copying access-control-* from
  // the auth Response to avoid duplicating them.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(req, reply) {
      const url = new URL(req.url, env.API_URL);
      const headers = toWebHeaders(req);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body != null;
      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });
      const response = await auth.handler(request);
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith('access-control-')) return;
        reply.header(key, value);
      });
      const text = await response.text();
      reply.send(text.length ? text : null);
    },
  });

  // ── Domain routes ──────────────────────────────────────────────────────
  await app.register(groupsRoutes);
  await app.register(invitesRoutes);
  await app.register(uploadRoutes);
  await app.register(mediaRoutes);
  await app.register(favouritesRoutes);
  await app.register(accountRoutes);
  await app.register(billingRoutes);
  await app.register(moderationRoutes);

  return app;
}
