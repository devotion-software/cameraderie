import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    // In `make dev-host` (LAN testing, e.g. from a phone) PUBLIC_API_URL is
    // set to `/api-proxy` so API calls stay same-origin with the web app —
    // this avoids cross-site cookie rules blocking the session cookie.
    proxy: {
      '/api-proxy': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
});
