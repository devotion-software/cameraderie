import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

/**
 * Parse a request body/params against a zod schema, throwing a 400 on failure.
 * Typed as `ZodType<T, any, any>` (not `ZodSchema<T>`) so T binds to the
 * schema's *output* type even when a `.default()` makes the input differ
 * (input allows the field to be missing; output always has it filled in).
 */
export function parse<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    throw badRequest(
      first ? `${path ? path + ': ' : ''}${first.message}` : 'Invalid request',
      'validation_error',
    );
  }
  return result.data;
}
