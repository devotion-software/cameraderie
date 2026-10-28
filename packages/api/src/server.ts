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
import adminUsersRoutes from './routes/admin-users.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
    },
    // Bytes never pass through the API; keep the JSON body limit modest.
    bodyLimit: 1024 * 1024,
  });

  // Parse JSON but also retain the raw buffer on `request.rawBody` — Stripe
  // webhook signature verification needs the exact bytes that were signed.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
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
  });

  await app.register(cors, {
    origin: [env.WEB_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
    reply.code(status).send({
      error: 'internal_error',
      message: status >= 500 ? 'Internal server error' : err.message,
    });
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

  // Sign-up no longer collects 18+/Terms+Privacy consent up front (email OTP
  // and social sign-in can't carry that form field through to account
  // creation), so it's captured right after first sign-in instead: every
  // domain route is blocked with 403 until `POST /me/accept-terms` is called.
  // The Stripe/RevenueCat webhooks are unauthenticated service-to-service
  // calls, not user sessions, so they're exempt alongside auth/health.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/auth/')) return;
    if (req.url === '/health') return;
    if (req.url === '/billing/webhook') return;
    if (req.method === 'GET' && req.url === '/me') return;
    if (req.url === '/me/accept-terms') return;
    const result = await auth.api.getSession({ headers: toWebHeaders(req) }).catch(() => null);
    const acceptedTermsAt = (result?.user as { acceptedTermsAt?: unknown } | undefined)
      ?.acceptedTermsAt;
    if (result?.user && !acceptedTermsAt) {
      reply.code(403).send({
        error: 'terms_required',
        message: 'Please confirm you are 18+ and accept the Terms and Privacy Policy to continue.',
      });
    }
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
  await app.register(adminUsersRoutes);

  return app;
}
