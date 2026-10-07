import { loadEnv } from './env.js';

/**
 * Content-safety check on the original's SHA-256, run in the worker before any
 * derivatives are generated.
 *
 * This is a pluggable hash-denylist: a real deployment would swap `isBlocked`
 * for a call to a hash-matching service (e.g. PhotoDNA / NCMEC industry hash
 * lists) — the interface stays the same. Here it matches against the
 * BLOCKED_SHA256 env list so the enforcement path is real and testable.
 */

export interface SafetyVerdict {
  blocked: boolean;
  reason?: string;
}

/** Parse the comma-separated env denylist into a set of valid hex digests. */
export function parseDenylist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f]{64}$/.test(s)),
  );
}

/** Pure matcher — easy to unit test without touching the environment. */
export function verdictFor(sha256Hex: string, denylist: Set<string>): SafetyVerdict {
  if (denylist.has(sha256Hex.toLowerCase())) {
    return { blocked: true, reason: 'matched content-safety denylist' };
  }
  return { blocked: false };
}

let cached: Set<string> | null = null;

export async function checkContentSafety(sha256Hex: string): Promise<SafetyVerdict> {
  if (!cached) cached = parseDenylist(loadEnv().BLOCKED_SHA256);
  return verdictFor(sha256Hex, cached);
}
