import { env } from '$env/dynamic/public';

const configured = env.PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Base URL of the Cameraderie API. Set PUBLIC_API_URL to override. A value
 * starting with "/" (e.g. the `/api-proxy` used by `make dev-host`) is
 * resolved against the current origin, since better-auth's client requires
 * an absolute URL.
 */
export const API_URL = configured.startsWith('/')
  ? `${window.location.origin}${configured}`
  : configured;
