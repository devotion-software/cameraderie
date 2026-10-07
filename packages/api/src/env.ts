import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_URL: z.string().url().default('http://localhost:3000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Comma-separated allowlist of email addresses permitted to create an
  // account. When set, every other sign-up is rejected — this is how the app
  // stays invite-only/friends-only. When empty, sign-up is OPEN (dev default);
  // set it before any public-facing deployment.
  ALLOWED_SIGNUP_EMAILS: z.string().optional(),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  FREE_TIER_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),

  // --- Billing (all optional; billing is disabled until configured) ---
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_MAX: z.string().optional(),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  // --- Observability (optional) ---
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & { R2_ENDPOINT: string };

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  const endpoint =
    parsed.data.R2_ENDPOINT ?? `https://${parsed.data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  cached = { ...parsed.data, R2_ENDPOINT: endpoint };
  return cached;
}
