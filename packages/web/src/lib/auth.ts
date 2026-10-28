import { createAuthClient } from 'better-auth/svelte';
import { emailOTPClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { API_URL } from './config';

/**
 * Better Auth client. Cookies are sent cross-origin (credentials: include),
 * so the web app on :5173 shares a session with the API on :3000. No
 * passwords: sign-in is email OTP, Google, Apple, or a passkey.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: 'include' },
  plugins: [emailOTPClient(), passkeyClient()],
});

export const { signIn, signOut, useSession } = authClient;
