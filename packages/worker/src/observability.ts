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
