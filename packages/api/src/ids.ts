import { randomUUID, randomBytes } from 'node:crypto';

/** Primary-key id for domain rows (36-char UUID v4). */
export function newId(): string {
  return randomUUID();
}

/** Short, URL-safe, unambiguous invite code (no 0/O/1/I/l). */
export function newInviteCode(length = 10): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
