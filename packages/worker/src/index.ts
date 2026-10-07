import { writeFile } from 'node:fs/promises';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  DERIVATIVES_QUEUE,
  RECONCILE_QUEUE,
  SWEEP_QUEUE,
  STALE_UPLOAD_TTL_MINUTES,
  type DerivativeJob,
  type SweepJob,
} from '@cameraderie/shared';
import { loadEnv } from './env.js';
import { processMedia, PermanentError, setState } from './process.js';
import { reconcile } from './reconcile.js';
import { sweepStaleUploads } from './sweep.js';
import { initObservability, captureError } from './observability.js';
import { closeDb } from './db.js';

const env = loadEnv();
initObservability();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<DerivativeJob>(
  DERIVATIVES_QUEUE,
  async (job) => {
    console.log(`[worker] processing media ${job.data.mediaId} (attempt ${job.attemptsMade + 1})`);
    await processMedia(job.data.mediaId);
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

// ── Reconciliation: hourly repeatable job (DB ↔ R2 + used_bytes) ────────────────
const reconcileQueue = new Queue(RECONCILE_QUEUE, { connection });
const reconcileWorker = new Worker(
  RECONCILE_QUEUE,
  async () => {
    await reconcile();
  },
  { connection, concurrency: 1 },
);
await reconcileQueue.add(
  'reconcile-all',
  {},
  { repeat: { every: 60 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true },
);

// ── Sweep: hourly repeatable job reaping abandoned uploads ───────────────────────
const sweepQueue = new Queue<SweepJob>(SWEEP_QUEUE, { connection });
const sweepWorker = new Worker<SweepJob>(
  SWEEP_QUEUE,
  async (job) => {
    await sweepStaleUploads(job.data.olderThanMinutes ?? STALE_UPLOAD_TTL_MINUTES);
  },
  { connection, concurrency: 1 },
);
await sweepQueue.add(
  'sweep-stale',
  { olderThanMinutes: STALE_UPLOAD_TTL_MINUTES },
  { repeat: { every: 60 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true },
);

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  const permanent = err instanceof PermanentError;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  console.error(
    `[worker] job ${job.id} failed (attempt ${job.attemptsMade}, permanent=${permanent}): ${err.message}`,
  );
  // On a permanent error, or once retries are exhausted, mark the media failed so
  // the UI can show it. The original stays safe in R2 regardless.
  if (permanent || exhausted) {
    captureError(err);
    await setState(job.data.mediaId, 'failed').catch((e) =>
      console.error('[worker] could not mark media failed', e),
    );
  }
});

// Liveness heartbeat: touch a file on an interval so a container healthcheck can
// confirm the event loop is still turning (the worker has no HTTP port).
const HEARTBEAT_FILE = '/tmp/worker-heartbeat';
const heartbeat = setInterval(() => {
  void writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});
}, 15_000);
heartbeat.unref();
void writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});

console.log(`[worker] listening on "${DERIVATIVES_QUEUE}" with concurrency ${env.WORKER_CONCURRENCY}`);

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down`);
  await worker.close();
  await reconcileWorker.close();
  await reconcileQueue.close();
  await sweepWorker.close();
  await sweepQueue.close();
  await connection.quit();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
