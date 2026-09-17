import { APP_VERSION, createApp } from './app.js';
import { db, pool } from './db/client.js';
import { env, isMockMode } from './env.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { reapStaleRuns } from './services/syncService.js';

async function main() {
  const app = createApp(db, pool);

  // A crash or restart leaves runs stuck at 'running', which would otherwise
  // pin /api/sync/status to `running: true` forever and block new syncs.
  const reaped = await reapStaleRuns(db);
  if (reaped > 0) logger.warn({ reaped }, 'marked interrupted sync runs as failed');

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { url: `http://${env.HOST}:${env.PORT}`, version: APP_VERSION, registrar: isMockMode ? 'mock' : 'live' },
      'domain-check server listening',
    );
    if (isMockMode) {
      logger.warn('MOCK_REGISTRAR=1 — serving fixture data. Set it to 0 with a real IONOS_API_KEY for live data.');
    }
  });

  await startScheduler(db, pool);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'server failed to start');
  process.exit(1);
});
