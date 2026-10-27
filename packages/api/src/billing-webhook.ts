/**
 * Pure helpers for the billing webhook path — no env/db/Stripe imports, so they
 * are unit-testable in isolation. The route handlers in routes/billing.ts consume
 * these.
 */

/**
 * True for a MySQL duplicate-key error (errno 1062 / ER_DUP_ENTRY) as surfaced
 * through drizzle + mysql2, including when wrapped under `.cause`. Used to treat a
 * webhook-event PK collision as an idempotent replay rather than a failure.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as
    | { errno?: number; code?: string; cause?: { errno?: number; code?: string } }
    | null
    | undefined;
  return (
    e?.errno === 1062 ||
    e?.code === 'ER_DUP_ENTRY' ||
    e?.cause?.errno === 1062 ||
    e?.cause?.code === 'ER_DUP_ENTRY'
  );
}

export interface RevenueCatEvent {
  userId: string;
  /** RevenueCat event id, used as the idempotency key. Null if the payload omits it. */
  eventId: string | null;
  entitlement: string | null;
  active: boolean;
  expiresAt: Date | null;
}

/**
 * Normalize a RevenueCat webhook body into the fields we act on. Returns null when
 * the payload has no resolvable user id (unrecognized shape).
 */
export function extractRevenueCatEvent(body: Record<string, unknown>): RevenueCatEvent | null {
  const ev = (body.event ?? body) as Record<string, unknown>;
  const userId = (ev.app_user_id ?? ev.userId) as string | undefined;
  if (!userId) return null;
  const eventId = (ev.id as string | undefined) ?? null;
  const entitlements = (ev.entitlement_ids ?? ev.entitlements) as string[] | undefined;
  const entitlement = Array.isArray(entitlements) && entitlements.length ? entitlements[0]! : null;
  const type = (ev.type as string | undefined)?.toUpperCase() ?? '';
  const active = !['CANCELLATION', 'EXPIRATION', 'REFUND'].includes(type) && entitlement !== null;
  const expiresMs = ev.expiration_at_ms as number | undefined;
  return { userId, eventId, entitlement, active, expiresAt: expiresMs ? new Date(expiresMs) : null };
}
