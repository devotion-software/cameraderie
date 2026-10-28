// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  // Injected from package.json by vite.config.ts.
  const __APP_VERSION__: string;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
