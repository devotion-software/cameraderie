import { env } from '$env/dynamic/public';

/** Base URL of the Cameraderie API. Set PUBLIC_API_URL to override. */
export const API_URL = env.PUBLIC_API_URL ?? 'http://localhost:3000';
