import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { user, session, account, verification } from '@cameraderie/db';
import { getDb } from './db.js';
import { loadEnv } from './env.js';

const env = loadEnv();

/**
 * Parse ALLOWED_SIGNUP_EMAILS into a lowercased set. Empty/unset => open
 * sign-up (dev default; the create hook logs a warning so it can't be missed).
 */
const signupAllowlist = new Set(
  (env.ALLOWED_SIGNUP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

if (signupAllowlist.size === 0) {
  console.warn(
    '[auth] ALLOWED_SIGNUP_EMAILS is empty — account sign-up is OPEN. ' +
      'Set it to your friends’ emails before any public deployment.',
  );
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
        // Gate account creation on the allowlist. This runs for every sign-up
        // path (email/password HTTP endpoint and the server-side
        // `auth.api.signUpEmail` used by the seed script), so there is no way
        // to register an account whose email isn't explicitly permitted.
        before: async (userData) => {
          if (signupAllowlist.size === 0) return; // open sign-up (see warning above)
          const email = (userData.email ?? '').toLowerCase();
          if (!signupAllowlist.has(email)) {
            throw new APIError('FORBIDDEN', {
              message: 'This app is invite-only; your email is not on the allowlist.',
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
