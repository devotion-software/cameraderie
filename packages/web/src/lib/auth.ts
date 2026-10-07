import { createAuthClient } from 'better-auth/svelte';
import { API_URL } from './config';

/**
 * Better Auth client. Cookies are sent cross-origin (credentials: include),
 * so the web app on :5173 shares a session with the API on :3000.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: 'include' },
});

export const { signIn, signUp, signOut, useSession } = authClient;
