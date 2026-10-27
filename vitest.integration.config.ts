import { defineConfig } from 'vitest/config';

/**
 * Integration tests that exercise the real critical paths against a real MariaDB.
 * They require TEST_DATABASE_URL to point at a throwaway database (the schema is
 * reset between tests). Kept separate from the default unit config so `bun run
 * test` stays DB-free; run these with `bun run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['packages/**/test/integration/**/*.test.ts'],
    environment: 'node',
    // Migrations are applied by the `test:integration` script before vitest runs
    // (via bun, like production) — running them through vite's transform can't
    // resolve the drizzle mysql2 driver subpath.
    setupFiles: ['packages/api/test/integration/setup-env.ts'],
    // One shared database → run files serially in a single process.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
