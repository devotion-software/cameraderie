import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import { closeDb } from './db.js';
import { closeQueue } from './queue.js';
import { initObservability } from './observability.js';

async function main() {
  const env = loadEnv();
  initObservability();
  const app = await buildServer();

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeQueue();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
