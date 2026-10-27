/**
 * Runs before each integration test file (vitest setupFiles), so the API's env
 * is populated before any `loadEnv()` call fires at module import. Points the DB
 * at TEST_DATABASE_URL and fills the remaining required vars with safe dummies
 * (R2 is mocked in the tests that touch it, so the credentials are never used).
 */
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) {
  throw new Error(
    'TEST_DATABASE_URL is required for integration tests (e.g. mysql://user:pass@localhost:3306/cameraderie_test)',
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDb;
process.env.BETTER_AUTH_SECRET ??= 'test-secret-at-least-16-chars-long';
process.env.API_URL ??= 'http://localhost:3000';
process.env.WEB_URL ??= 'http://localhost:5173';
process.env.R2_ACCOUNT_ID ??= 'test';
process.env.R2_ACCESS_KEY_ID ??= 'test';
process.env.R2_SECRET_ACCESS_KEY ??= 'test';
process.env.R2_BUCKET ??= 'test-bucket';
