import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://cameraderie:cameraderie@localhost:3306/cameraderie',
  },
  verbose: true,
  strict: true,
});
