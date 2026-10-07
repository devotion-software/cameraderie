import * as Sentry from '@sentry/node';
import { loadEnv } from './env.js';

let enabled = false;

/** Initialise Sentry if SENTRY_DSN is set. Safe to call once at startup. */
export function initObservability(): void {
  const env = loadEnv();
  if (!env.SENTRY_DSN || enabled) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
  });
  enabled = true;
}

export function captureError(err: unknown): void {
  if (enabled) Sentry.captureException(err);
}
