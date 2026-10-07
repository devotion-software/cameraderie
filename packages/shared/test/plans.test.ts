import { describe, it, expect } from 'vitest';
import { planFromEntitlement, quotaForPlan, GiB, PLANS } from '@cameraderie/shared';

describe('plans', () => {
  it('maps entitlements to plans, defaulting to free', () => {
    expect(planFromEntitlement('pro').id).toBe('pro');
    expect(planFromEntitlement('max').id).toBe('max');
    expect(planFromEntitlement(null).id).toBe('free');
    expect(planFromEntitlement('nonsense').id).toBe('free');
  });

  it('reports the right quota per plan', () => {
    expect(quotaForPlan('free')).toBe(5 * GiB);
    expect(quotaForPlan('pro')).toBe(100 * GiB);
    expect(quotaForPlan('max')).toBe(1024 * GiB);
  });

  it('every plan has a positive quota', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.quotaBytes).toBeGreaterThan(0);
    }
  });
});
