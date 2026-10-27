import { describe, it, expect } from 'vitest';
import { isDuplicateKeyError, extractRevenueCatEvent } from '../src/billing-webhook.js';

describe('isDuplicateKeyError', () => {
  it('detects mysql2 duplicate-key errors (errno 1062 / ER_DUP_ENTRY)', () => {
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
  });

  it('detects the error when wrapped under cause (as drizzle may surface it)', () => {
    expect(isDuplicateKeyError({ cause: { errno: 1062 } })).toBe(true);
    expect(isDuplicateKeyError({ cause: { code: 'ER_DUP_ENTRY' } })).toBe(true);
  });

  it('does not misclassify other errors', () => {
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
    expect(isDuplicateKeyError({ errno: 1452 })).toBe(false); // FK failure
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });
});

describe('extractRevenueCatEvent', () => {
  it('extracts the event id (idempotency key), user, and active entitlement', () => {
    const ev = extractRevenueCatEvent({
      event: {
        id: 'rc_evt_123',
        app_user_id: 'user_abc',
        type: 'INITIAL_PURCHASE',
        entitlement_ids: ['max'],
        expiration_at_ms: 1_700_000_000_000,
      },
    });
    expect(ev).not.toBeNull();
    expect(ev!.eventId).toBe('rc_evt_123');
    expect(ev!.userId).toBe('user_abc');
    expect(ev!.entitlement).toBe('max');
    expect(ev!.active).toBe(true);
    expect(ev!.expiresAt?.getTime()).toBe(1_700_000_000_000);
  });

  it('treats cancellation/expiration/refund as inactive', () => {
    for (const type of ['CANCELLATION', 'EXPIRATION', 'REFUND']) {
      const ev = extractRevenueCatEvent({
        event: { id: 'e', app_user_id: 'u', type, entitlement_ids: ['pro'] },
      });
      expect(ev!.active).toBe(false);
    }
  });

  it('is inactive when no entitlement is present', () => {
    const ev = extractRevenueCatEvent({
      event: { id: 'e', app_user_id: 'u', type: 'PURCHASE' },
    });
    expect(ev!.entitlement).toBeNull();
    expect(ev!.active).toBe(false);
  });

  it('returns null eventId when the payload omits an id (dedup falls back to apply)', () => {
    const ev = extractRevenueCatEvent({ app_user_id: 'u', entitlement_ids: ['pro'], type: 'PURCHASE' });
    expect(ev!.eventId).toBeNull();
    expect(ev!.userId).toBe('u');
  });

  it('returns null for an unrecognized payload with no user id', () => {
    expect(extractRevenueCatEvent({ foo: 'bar' })).toBeNull();
  });
});
