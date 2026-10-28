import { betterAuth, type Auth as BetterAuthInstance } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, emailOTP } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { user, session, account, verification, passkey as passkeyTable, invites } from '@cameraderie/db';
import { getDb } from './db.js';
import { loadEnv } from './env.js';
import { sendOtpEmail } from './email.js';

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
 * Social providers are only enabled once their keys are configured, so the
 * server boots fine in dev without them (the corresponding button in the web
 * UI will just error until real credentials are set).
 */
const socialProviders: NonNullable<Parameters<typeof betterAuth>[0]['socialProviders']> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}
if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
  socialProviders.apple = {
    clientId: env.APPLE_CLIENT_ID,
    clientSecret: env.APPLE_CLIENT_SECRET,
    appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
  };
}

/**
 * Better Auth owns authentication. No passwords: sign-in is email OTP,
 * Google, Apple, or a passkey (passkeys are registered from Settings once
 * signed in another way — WebAuthn credential registration needs an existing
 * session to attach to). Web clients use session cookies; native apps use the
 * bearer plugin (send the session token as `Authorization: Bearer <token>`)
 * and store it in the Keychain / Keystore.
 *
 * `usedBytes` and `plan` are custom user fields the app maintains — declared
 * here with `input: false` so clients can never set them directly.
 */
export const auth = betterAuth({
  baseURL: env.API_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: 'mysql',
    schema: { user, session, account, verification, passkey: passkeyTable },
  }),
  socialProviders,
  trustedOrigins: [env.WEB_URL],
  databaseHooks: {
    user: {
      create: {
        // Gate account creation. This runs for every sign-up path (email OTP
        // auto-signup, Google, Apple), so there is no way to register an
        // account whose email isn't either on the static allowlist or already
        // invited to a group. The 18+/Terms consent is captured separately,
        // right after first sign-in (see `POST /me/accept-terms` and the
        // `requireAcceptedTerms` gate in server.ts) — none of these sign-up
        // flows can carry custom form fields through to account creation the
        // way the old email/password sign-up body could.
        before: async (userData) => {
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
      // Set once, via POST /me/accept-terms, right after the user's first
      // sign-in. Never accepted as sign-up/sign-in input.
      acceptedTermsAt: { type: 'date', required: false, input: false },
    },
  },
  advanced: {
    // In production (separate web + api domains) set these so the session
    // cookie is sent cross-site: sameSite 'none' + secure true, and configure
    // crossSubDomainCookies / a shared parent domain as appropriate.
    defaultCookieAttributes:
      env.NODE_ENV === 'production' ? { sameSite: 'none', secure: true } : undefined,
  },
  plugins: [
    bearer(),
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      sendVerificationOTP: async ({ email, otp }) => {
        await sendOtpEmail(email, otp);
      },
    }),
    passkey({
      rpID: new URL(env.WEB_URL).hostname,
      rpName: 'Cameraderie',
    }),
  ],
  // The precise inferred type here pulls in better-auth's internal zod v4 and
  // @simplewebauthn/server types in a way tsc can't emit a portable .d.ts for
  // (TS2742). We only ever call the plugin-agnostic `auth.api.getSession` /
  // `auth.handler` outside this file, so widen to the base `Auth` type.
}) as unknown as BetterAuthInstance;

export type Auth = typeof auth;
