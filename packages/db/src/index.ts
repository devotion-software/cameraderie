import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { schema } from './schema.js';

export * from './schema.js';

export type Database = MySql2Database<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: mysql.Pool;
}

/**
 * Create a pooled Drizzle client. Callers should create one per process and
 * reuse it. `close()` drains the pool on shutdown.
 */
export function createDb(databaseUrl: string): DbHandle {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    // Keep timezone handling explicit and predictable.
    timezone: 'Z',
    // Big files declare big byte counts; keep them as JS numbers (safe < 2^53).
    supportBigNumbers: true,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}
