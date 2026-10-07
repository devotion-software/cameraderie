import * as Sentry from '@sentry/node';
import { loadEnv } from './env.js';

let enabled = false;

export function initObservability(): void {
  const env = loadEnv();
  if (!env.SENTRY_DSN || enabled) return;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  enabled = true;
}

export function captureError(err: unknown): void {
  if (enabled) Sentry.captureException(err);
}

/**
 * Raise a high-priority operator alert that isn't an exception — used for
 * content-safety quarantines, which must reach a human even though the job
 * itself "succeeded" (the upload was handled, just not published).
 */
export function captureAlert(message: string, context?: Record<string, unknown>): void {
  if (enabled) Sentry.captureMessage(message, { level: 'fatal', extra: context });
}
