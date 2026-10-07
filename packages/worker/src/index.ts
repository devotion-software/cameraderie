import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DERIVATIVES_QUEUE, type DerivativeJob } from '@cameraderie/shared';
import { loadEnv } from './env.js';
import { processMedia, PermanentError, setState } from './process.js';
import { closeDb } from './db.js';

const env = loadEnv();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<DerivativeJob>(
  DERIVATIVES_QUEUE,
  async (job) => {
    console.log(`[worker] processing media ${job.data.mediaId} (attempt ${job.attemptsMade + 1})`);
    await processMedia(job.data.mediaId);
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
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
    await setState(job.data.mediaId, 'failed').catch((e) =>
      console.error('[worker] could not mark media failed', e),
    );
  }
});

console.log(`[worker] listening on "${DERIVATIVES_QUEUE}" with concurrency ${env.WORKER_CONCURRENCY}`);

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down`);
  await worker.close();
  await connection.quit();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
