import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { subscriptions, user, webhookEvents } from '@cameraderie/db';
import { planFromEntitlement, type PlanId } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { loadEnv } from '../env.js';
import { requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { badRequest, unauthorized } from '../errors.js';
import { extractRevenueCatEvent, isDuplicateKeyError } from '../billing-webhook.js';
import { z } from 'zod';

/**
 * Billing for both platforms. Mobile uses RevenueCat (StoreKit / Play Billing);
 * web uses Stripe Checkout. The backend checks a single "storage_tier"
 * entitlement regardless of where the user paid, and derives their quota from it.
 *
 * Everything is gated on configuration: with no Stripe key / webhook secret the
 * endpoints return 503/400 rather than pretending to work.
 */

const env = loadEnv();

let stripeClient: Stripe | null = null;
function stripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

const PLAN_TO_PRICE: Partial<Record<PlanId, string | undefined>> = {
  pro: env.STRIPE_PRICE_PRO,
  max: env.STRIPE_PRICE_MAX,
};
function priceToPlan(priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === env.STRIPE_PRICE_MAX) return 'max';
  return null;
}

const checkoutBody = z.object({ plan: z.enum(['pro', 'max']) });

export default async function billingRoutes(app: FastifyInstance) {
  const db = getDb();

  // Create a Stripe Checkout session for an upgrade. Returns a hosted URL the
  // web client redirects to (no card details ever touch this server).
  app.post('/billing/checkout', async (req) => {
    const me = await requireUser(req);
    const body = parse(checkoutBody, req.body);
    const client = stripe();
    if (!client) throw badRequest('Billing is not configured', 'billing_unavailable');
    const price = PLAN_TO_PRICE[body.plan];
    if (!price) throw badRequest(`No price configured for the ${body.plan} plan`, 'billing_unavailable');

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: me.id,
      customer_email: me.email,
      success_url: `${env.WEB_URL}/settings?billing=success`,
      cancel_url: `${env.WEB_URL}/settings?billing=cancel`,
      // Carry the user id onto the subscription so later lifecycle events resolve it.
      subscription_data: { metadata: { userId: me.id, plan: body.plan } },
      metadata: { userId: me.id, plan: body.plan },
    });
    return { url: session.url };
  });

  // Provider webhook. Stripe events are signature-verified against the raw body;
  // RevenueCat events are authenticated via a shared bearer secret.
  app.post('/billing/webhook', async (req, reply) => {
    const stripeSig = req.headers['stripe-signature'];
    if (typeof stripeSig === 'string') {
      return handleStripeWebhook(req, stripeSig);
    }
    return handleRevenueCatWebhook(req, reply);
  });

  // ── Stripe ───────────────────────────────────────────────────────────────────

  async function handleStripeWebhook(req: FastifyRequest, signature: string) {
    const client = stripe();
    if (!client || !env.STRIPE_WEBHOOK_SECRET) {
      throw badRequest('Stripe webhooks are not configured', 'billing_unavailable');
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw) throw badRequest('Missing raw body for signature verification');

    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      req.log.warn({ err }, 'stripe signature verification failed');
      throw badRequest('Invalid signature', 'invalid_signature');
    }

    let target: { userId: string; plan: PlanId; active: boolean; periodEnd: Date | null } | null =
      null;
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.client_reference_id ?? s.metadata?.userId;
        const plan = (s.metadata?.plan as PlanId | undefined) ?? 'pro';
        if (userId) target = { userId, plan, active: true, periodEnd: null };
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const priceId = sub.items.data[0]?.price.id;
        const plan = priceToPlan(priceId) ?? 'pro';
        const active = sub.status === 'active' || sub.status === 'trialing';
        const periodEnd = toDate((sub as unknown as { current_period_end?: number }).current_period_end);
        if (userId) target = { userId, plan, active, periodEnd };
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (userId) target = { userId, plan: 'free', active: false, periodEnd: null };
        break;
      }
      default:
        req.log.info({ type: event.type }, 'unhandled stripe event');
    }
    if (!target) return { received: true, applied: false };
    // Dedup on Stripe's event id: a replayed webhook rolls back (see applyEntitlement).
    const applied = await applyOnce(() =>
      applyEntitlement(
        target.userId,
        target.plan,
        target.active,
        target.periodEnd,
        'stripe',
        event,
        `stripe:${event.id}`,
      ),
    );
    return { received: true, applied };
  }

  // ── RevenueCat ───────────────────────────────────────────────────────────────

  async function handleRevenueCatWebhook(req: FastifyRequest, reply: { code: (n: number) => unknown }) {
    // RevenueCat signs by a shared Authorization header you configure in its dashboard.
    // Fail closed: without a configured secret we cannot authenticate the caller, and
    // the payload's `app_user_id` is attacker-controlled — trusting it would let anyone
    // grant any user an arbitrary plan. So an unset secret rejects the webhook outright.
    if (!env.REVENUECAT_WEBHOOK_SECRET) {
      throw badRequest('RevenueCat webhooks are not configured', 'billing_unavailable');
    }
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`) throw unauthorized('Bad webhook secret');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = extractRevenueCatEvent(body);
    if (!event) {
      req.log.warn({ body }, 'revenuecat webhook: unrecognized payload');
      reply.code(202);
      return { received: true, applied: false };
    }
    // Identity binding: the shared secret authenticates RevenueCat, and RevenueCat
    // vouches for `app_user_id` — but require it to resolve to a real account so a
    // forged/stale id can't create phantom entitlement rows (and so we fail soft
    // rather than hitting an FK error). Accept-and-ignore unknown users.
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, event.userId))
      .limit(1);
    if (existing.length === 0) {
      req.log.warn({ userId: event.userId }, 'revenuecat webhook for unknown user; ignoring');
      reply.code(202);
      return { received: true, applied: false };
    }
    const plan = planFromEntitlement(event.entitlement).id;
    const eventKey = event.eventId ? `revenuecat:${event.eventId}` : null;
    // Dedup on RevenueCat's event id when present; a replay rolls back.
    const applied = await applyOnce(() =>
      applyEntitlement(
        event.userId,
        event.active ? plan : 'free',
        event.active,
        event.expiresAt,
        'revenuecat',
        body,
        eventKey,
      ),
    );
    return { received: true, applied };
  }

  // ── Shared entitlement sync ────────────────────────────────────────────────────

  // Run an entitlement apply, treating a webhook-event PK collision as "already
  // processed" (idempotent replay) rather than an error. Returns whether the apply
  // actually ran. Any other error propagates so the provider retries.
  async function applyOnce(fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async function applyEntitlement(
    userId: string,
    planId: PlanId,
    active: boolean,
    currentPeriodEnd: Date | null,
    provider: string,
    raw: unknown,
    eventKey: string | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Record the event FIRST. Its PK is unique, so a replayed/duplicated delivery
      // collides here and the whole transaction (upsert + plan change) rolls back.
      if (eventKey) {
        await tx.insert(webhookEvents).values({ id: eventKey, provider });
      }
      await tx
        .insert(subscriptions)
        .values({
          id: newId(),
          userId,
          provider,
          entitlement: active ? planId : null,
          status: active ? 'active' : 'inactive',
          currentPeriodEnd,
          raw: raw as object,
        })
        .onDuplicateKeyUpdate({
          set: {
            provider,
            entitlement: active ? planId : null,
            status: active ? 'active' : 'inactive',
            currentPeriodEnd,
            raw: raw as object,
          },
        });
      // Over-quota handling (downgrade): we never auto-delete. The quota check
      // simply blocks new uploads until the user is back under their limit.
      await tx
        .update(user)
        .set({ plan: active ? planId : 'free' })
        .where(eq(user.id, userId));
    });
  }
}

function toDate(seconds: number | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}
