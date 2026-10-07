import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { subscriptions, user } from '@cameraderie/db';
import { planFromEntitlement, type PlanId } from '@cameraderie/shared';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { loadEnv } from '../env.js';
import { requireUser } from '../guards.js';
import { parse } from '../validate.js';
import { badRequest, unauthorized } from '../errors.js';
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

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.client_reference_id ?? s.metadata?.userId;
        const plan = (s.metadata?.plan as PlanId | undefined) ?? 'pro';
        if (userId) await applyEntitlement(userId, plan, true, null, 'stripe', event);
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
        if (userId) await applyEntitlement(userId, plan, active, periodEnd, 'stripe', event);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (userId) await applyEntitlement(userId, 'free', false, null, 'stripe', event);
        break;
      }
      default:
        req.log.info({ type: event.type }, 'unhandled stripe event');
    }
    return { received: true };
  }

  // ── RevenueCat ───────────────────────────────────────────────────────────────

  async function handleRevenueCatWebhook(req: FastifyRequest, reply: { code: (n: number) => unknown }) {
    // RevenueCat signs by a shared Authorization header you configure in its dashboard.
    if (env.REVENUECAT_WEBHOOK_SECRET) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`) throw unauthorized('Bad webhook secret');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = extractRevenueCatEvent(body);
    if (!event) {
      req.log.warn({ body }, 'revenuecat webhook: unrecognized payload');
      reply.code(202);
      return { received: true, applied: false };
    }
    const plan = planFromEntitlement(event.entitlement).id;
    await applyEntitlement(
      event.userId,
      event.active ? plan : 'free',
      event.active,
      event.expiresAt,
      'revenuecat',
      body,
    );
    return { received: true, applied: true };
  }

  // ── Shared entitlement sync ────────────────────────────────────────────────────

  async function applyEntitlement(
    userId: string,
    planId: PlanId,
    active: boolean,
    currentPeriodEnd: Date | null,
    provider: string,
    raw: unknown,
  ): Promise<void> {
    await db.transaction(async (tx) => {
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

interface RevenueCatEvent {
  userId: string;
  entitlement: string | null;
  active: boolean;
  expiresAt: Date | null;
}

function extractRevenueCatEvent(body: Record<string, unknown>): RevenueCatEvent | null {
  const ev = (body.event ?? body) as Record<string, unknown>;
  const userId = (ev.app_user_id ?? ev.userId) as string | undefined;
  if (!userId) return null;
  const entitlements = (ev.entitlement_ids ?? ev.entitlements) as string[] | undefined;
  const entitlement = Array.isArray(entitlements) && entitlements.length ? entitlements[0]! : null;
  const type = (ev.type as string | undefined)?.toUpperCase() ?? '';
  const active = !['CANCELLATION', 'EXPIRATION', 'REFUND'].includes(type) && entitlement !== null;
  const expiresMs = ev.expiration_at_ms as number | undefined;
  return { userId, entitlement, active, expiresAt: expiresMs ? new Date(expiresMs) : null };
}
