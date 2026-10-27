import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    // Integration tests need a real DB and run via vitest.integration.config.ts.
    exclude: [...configDefaults.exclude, 'packages/**/test/integration/**'],
    environment: 'node',
  },
});
