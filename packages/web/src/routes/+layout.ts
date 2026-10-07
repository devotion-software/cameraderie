// Client-side SPA: the API lives on a separate origin and auth is cookie-based,
// so we render everything in the browser and skip SSR.
export const ssr = false;
export const prerender = false;
