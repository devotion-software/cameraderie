import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { user, session, account, verification } from '@cameraderie/db';
import { getDb } from './db.js';
import { loadEnv } from './env.js';

const env = loadEnv();

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
  user: {
    additionalFields: {
      usedBytes: { type: 'number', required: false, input: false, defaultValue: 0 },
      plan: { type: 'string', required: false, input: false, defaultValue: 'free' },
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
