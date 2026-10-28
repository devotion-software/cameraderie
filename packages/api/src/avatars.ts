import { presignGet } from './r2.js';

/**
 * Resolve a batch of users' display avatar URLs: a self-uploaded avatar (R2
 * key, freshly presigned) takes priority over Better Auth's `image` (an
 * OAuth-provider photo URL, already a real URL — never presigned).
 */
export async function avatarUrlsFor(
  rows: { userId: string; avatarObjectKey: string | null; image: string | null }[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    rows.map(async (r) => {
      const url = r.avatarObjectKey ? await presignGet(r.avatarObjectKey) : (r.image ?? null);
      return [r.userId, url] as const;
    }),
  );
  return Object.fromEntries(entries);
}
