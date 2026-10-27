import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { user, session, account, verification, invites } from '@cameraderie/db';
import { getDb } from './db.js';
import { loadEnv } from './env.js';

const env = loadEnv();

/**
 * Parse ALLOWED_SIGNUP_EMAILS into a lowercased set. This is a static
 * bootstrap allowlist (e.g. for the founder/first admin account) — the
 * primary gate is a pending group invite addressed to that email, checked in
 * `isEmailInvited` below. Empty/unset => no static allowlist entries (dev
 * default; the create hook logs a warning so it can't be missed).
 */
const signupAllowlist = new Set(
  (env.ALLOWED_SIGNUP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

if (signupAllowlist.size === 0) {
  if (env.NODE_ENV === 'production') {
    console.warn(
      '[auth] ALLOWED_SIGNUP_EMAILS is empty in production — sign-up is gated purely on ' +
        'group invites. Set it if you need a bootstrap admin account that has no invite.',
    );
  } else {
    console.warn(
      '[auth] ALLOWED_SIGNUP_EMAILS is empty — sign-up is gated purely on group invites. ' +
        'Set it, or create an invite addressed to your email, before signing up in dev.',
    );
  }
}

/**
 * An email may sign up if it's on the static allowlist, or if a non-expired,
 * not-yet-exhausted group invite was addressed to it. This is the sole gate
 * on account creation — the app is invite-only with no open registration.
 */
async function isEmailInvited(email: string): Promise<boolean> {
  if (signupAllowlist.has(email)) return true;
  const db = getDb();
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.inviteeEmail, email),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
        or(isNull(invites.maxUses), lt(invites.uses, invites.maxUses)),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Better Auth owns authentication. Web clients use session cookies; native
 * apps use the bearer plugin (send the session token as `Authorization:
 * Bearer <token>`) and store it in the Keychain / Keystore.
 *
 * `usedBytes` and `plan` are custom user fields the app maintains — declared
 * here with `input: false` so clients can never set them directly.
 */
export const auth = betterAuth({
  baseURL: env.API_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: 'mysql',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // For a private app we don't gate on email verification yet.
    requireEmailVerification: false,
  },
  trustedOrigins: [env.WEB_URL],
  databaseHooks: {
    user: {
      create: {
        // Gate account creation. This runs for every sign-up path (email/password
        // HTTP endpoint and the server-side `auth.api.signUpEmail` used by the
        // seed script), so there is no way to register an account whose email
        // isn't either on the static allowlist or already invited to a group.
        before: async (userData) => {
          // Age + legal gate (always enforced, independent of the invite gate): the
          // client must send `acceptedTermsAt`, set only when the user confirms
          // they are 18 or over and accepts the Terms + Privacy Policy. This is a
          // self-attestation record, not identity-grade age verification.
          const accepted = (userData as { acceptedTermsAt?: unknown }).acceptedTermsAt;
          if (!accepted) {
            throw new APIError('BAD_REQUEST', {
              message:
                'You must confirm you are 18 or over and accept the Terms and Privacy Policy.',
            });
          }
          const email = (userData.email ?? '').toLowerCase();
          if (!(await isEmailInvited(email))) {
            throw new APIError('FORBIDDEN', {
              message: 'This app is invite-only; your email has not been invited to a group yet.',
            });
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      usedBytes: { type: 'number', required: false, input: false, defaultValue: 0 },
      plan: { type: 'string', required: false, input: false, defaultValue: 'free' },
      role: { type: 'string', required: false, input: false, defaultValue: 'user' },
      canCreateGroups: { type: 'boolean', required: false, input: false, defaultValue: false },
      canInviteMembers: { type: 'boolean', required: false, input: false, defaultValue: false },
      // Accepted from the sign-up body (see the create.before gate). The client
      // sends the current timestamp only once the 18+/Terms checkboxes are ticked.
      acceptedTermsAt: { type: 'date', required: false, input: true },
    },
  },
  advanced: {
    // In production (separate web + api domains) set these so the session
    // cookie is sent cross-site: sameSite 'none' + secure true, and configure
    // crossSubDomainCookies / a shared parent domain as appropriate.
    defaultCookieAttributes:
      env.NODE_ENV === 'production' ? { sameSite: 'none', secure: true } : undefined,
  },
  plugins: [bearer()],
});

export type Auth = typeof auth;
