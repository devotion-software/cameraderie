import type { ZodSchema } from 'zod';
import { badRequest } from './errors.js';

/** Parse a request body/params against a zod schema, throwing a 400 on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
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
