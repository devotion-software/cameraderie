import { describe, it, expect } from 'vitest';
import { parseDenylist, verdictFor } from '../src/safety.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('parseDenylist', () => {
  it('parses, trims, lowercases, and keeps only valid 64-hex digests', () => {
    const set = parseDenylist(` ${A.toUpperCase()} , ${B}, short, , zz${'z'.repeat(62)}`);
    expect(set.has(A)).toBe(true);
    expect(set.has(B)).toBe(true);
    expect(set.size).toBe(2);
  });

  it('handles empty/undefined input', () => {
    expect(parseDenylist(undefined).size).toBe(0);
    expect(parseDenylist('').size).toBe(0);
  });
});

describe('verdictFor', () => {
  const denylist = parseDenylist(`${A}`);
  it('blocks a matching hash (case-insensitive)', () => {
    expect(verdictFor(A, denylist).blocked).toBe(true);
    expect(verdictFor(A.toUpperCase(), denylist).blocked).toBe(true);
  });
  it('allows a non-matching hash', () => {
    expect(verdictFor(B, denylist).blocked).toBe(false);
  });
});
