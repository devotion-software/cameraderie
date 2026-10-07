import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  // libraw's dcraw_emu binary, for decoding camera RAW. Defaults to PATH.
  DCRAW_EMU_PATH: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  // Comma-separated SHA-256 hex digests to block on upload (content-safety
  // denylist). A production setup would query a hash service instead.
  BLOCKED_SHA256: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & { R2_ENDPOINT: string };

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid worker environment configuration');
  }
  const endpoint =
    parsed.data.R2_ENDPOINT ?? `https://${parsed.data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  cached = { ...parsed.data, R2_ENDPOINT: endpoint };
  return cached;
}
