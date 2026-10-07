import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { subscriptions, user } from '@cameraderie/db';
import { planFromEntitlement } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';

/**
 * Billing webhook (RevenueCat / Stripe). The backend checks a single
 * "storage_tier" entitlement regardless of where the user paid, and derives
 * their quota from it.
 *
 * This is a functional skeleton: it upserts the subscription row and syncs the
 * user's `plan`. Signature verification is marked TODO — wire it up with the
 * provider's webhook secret before accepting real traffic.
 */
export default async function billingRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post('/billing/webhook', async (req, reply) => {
    // TODO: verify the provider signature (RevenueCat Authorization header /
    // Stripe-Signature) against the configured webhook secret before trusting.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = extractEntitlementEvent(body);
    if (!event) {
      req.log.warn({ body }, 'billing webhook: unrecognized payload');
      reply.code(202);
      return { received: true, applied: false };
    }

    const plan = planFromEntitlement(event.entitlement);

    await db.transaction(async (tx) => {
      await tx
        .insert(subscriptions)
        .values({
          id: newId(),
          userId: event.userId,
          provider: event.provider,
          entitlement: event.active ? plan.id : null,
          status: event.active ? 'active' : 'inactive',
          currentPeriodEnd: event.expiresAt ?? null,
          raw: body,
        })
        .onDuplicateKeyUpdate({
          set: {
            provider: event.provider,
            entitlement: event.active ? plan.id : null,
            status: event.active ? 'active' : 'inactive',
            currentPeriodEnd: event.expiresAt ?? null,
            raw: body,
          },
        });

      // Over-quota handling (downgrade): we never auto-delete. If the user is
      // now over their new limit, uploads are blocked (read-only) by the quota
      // check; viewing/downloading/deleting still work.
      await tx
        .update(user)
        .set({ plan: event.active ? plan.id : 'free' })
        .where(eq(user.id, event.userId));
    });

    return { received: true, applied: true, plan: event.active ? plan.id : 'free' };
  });
}

interface EntitlementEvent {
  userId: string;
  provider: string;
  entitlement: string | null;
  active: boolean;
  expiresAt: Date | null;
}

/** Best-effort parse of a RevenueCat-style webhook body. */
function extractEntitlementEvent(body: Record<string, unknown>): EntitlementEvent | null {
  const ev = (body.event ?? body) as Record<string, unknown>;
  const userId = (ev.app_user_id ?? ev.userId) as string | undefined;
  if (!userId) return null;
  const entitlements = (ev.entitlement_ids ?? ev.entitlements) as string[] | undefined;
  const entitlement = Array.isArray(entitlements) && entitlements.length ? entitlements[0]! : null;
  const type = (ev.type as string | undefined)?.toUpperCase() ?? '';
  const active = !['CANCELLATION', 'EXPIRATION', 'REFUND'].includes(type) && entitlement !== null;
  const expiresMs = ev.expiration_at_ms as number | undefined;
  return {
    userId,
    provider: (ev.store as string | undefined) ?? 'revenuecat',
    entitlement,
    active,
    expiresAt: expiresMs ? new Date(expiresMs) : null,
  };
}
