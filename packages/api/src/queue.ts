import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DERIVATIVES_QUEUE, type DerivativeJob } from '@cameraderie/shared';
import { loadEnv } from './env.js';

let connection: Redis | null = null;
let derivativesQueue: Queue<DerivativeJob> | null = null;

function getConnection(): Redis {
  if (!connection) {
    // BullMQ requires maxRetriesPerRequest: null on the shared connection.
    connection = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getDerivativesQueue(): Queue<DerivativeJob> {
  if (!derivativesQueue) {
    derivativesQueue = new Queue<DerivativeJob>(DERIVATIVES_QUEUE, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return derivativesQueue;
}

/** Enqueue derivative generation for a media id once its original is in R2. */
export async function enqueueDerivatives(mediaId: string): Promise<void> {
  await getDerivativesQueue().add('generate', { mediaId }, { jobId: `media:${mediaId}` });
}

export async function closeQueue(): Promise<void> {
  await derivativesQueue?.close();
  await connection?.quit();
  derivativesQueue = null;
  connection = null;
}
