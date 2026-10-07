import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Standalone migration runner. Run with `pnpm --filter @cameraderie/db migrate`.
 * Reads DATABASE_URL from the environment.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations');

  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

  const connection = await mysql.createConnection({ uri: url, multipleStatements: true });
  const db = drizzle(connection);
  console.log(`Running migrations from ${migrationsFolder} …`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');
  await connection.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
