import { createDb, type Database } from '@cameraderie/db';
import { loadEnv } from './env.js';

let handle: ReturnType<typeof createDb> | null = null;

export function getDb(): Database {
  if (!handle) handle = createDb(loadEnv().DATABASE_URL);
  return handle.db;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.pool.end();
    handle = null;
  }
}
