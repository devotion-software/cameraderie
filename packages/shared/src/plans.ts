/**
 * Storage plans. A user's quota is derived from the single "storage_tier"
 * entitlement (from RevenueCat/Stripe), so the quota is just a config value
 * we can tune once real usage appears.
 */

export const GiB = 1024 * 1024 * 1024;

export type PlanId = 'free' | 'pro' | 'max';

export interface Plan {
  id: PlanId;
  label: string;
  /** Quota in bytes, measured on the user's own originals. */
  quotaBytes: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', label: 'Free', quotaBytes: 5 * GiB },
  pro: { id: 'pro', label: 'Pro', quotaBytes: 100 * GiB },
  max: { id: 'max', label: 'Max', quotaBytes: 1024 * GiB },
};

export const DEFAULT_PLAN: PlanId = 'free';

export function planFromEntitlement(entitlement: string | null | undefined): Plan {
  if (entitlement && entitlement in PLANS) return PLANS[entitlement as PlanId];
  return PLANS[DEFAULT_PLAN];
}

export function quotaForPlan(planId: PlanId): number {
  return PLANS[planId].quotaBytes;
}
