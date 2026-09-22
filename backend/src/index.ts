import { APP_VERSION, createApp } from './app.js';
import { db, pool } from './db/client.js';
import { corsOrigins, env, isMockMode } from './env.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { provisionRegistrarAccounts } from './db/provision.js';
import { reapStaleRuns } from './services/syncService.js';

/**
 * Bind the port first, then do database housekeeping.
 *
 * The order matters. Everything below touches Postgres, and if the database is
 * briefly unreachable — a firewall rule that moved, a restarting container —
 * awaiting it before `listen()` means the process hangs for the connection
 * timeout and binds nothing, printing not one line. From the outside that is
 * indistinguishable from a crash.
 *
 * Listening first means `/api/health` answers immediately and says `db: down`,
 * which is the one thing you need to diagnose it.
 */
async function main() {
  const app = createApp(db, pool);

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        url: `http://${env.HOST}:${env.PORT}`,
        version: APP_VERSION,
        registrar: isMockMode ? 'mock' : 'live',
        corsOrigins: corsOrigins.length > 0 ? corsOrigins : 'same-origin only',
      },
      'domain-check server listening',
    );
    if (isMockMode) {
      logger.warn('MOCK_REGISTRAR=1 — serving fixture data. Set it to 0 with a real IONOS_API_KEY for live data.');
    }
  });

  // Housekeeping is best-effort: a failure here must not stop the server from
  // serving, precisely so you can see *why* it failed.
  void (async () => {
    try {
      // Before the scheduler: `maybeCatchUp` can fire 30s from now having never
      // seen an HTTP request, so waiting for the request-path middleware to
      // provision accounts would let a startup catch-up find none and return
      // silently.
      await provisionRegistrarAccounts(db);

      // A crash or restart leaves runs stuck at 'running', which would otherwise
      // pin /api/sync/status to `running: true` forever and block new syncs.
      const reaped = await reapStaleRuns(db);
      if (reaped > 0) logger.warn({ reaped }, 'marked interrupted sync runs as failed');
      await startScheduler(db, pool);
    } catch (err) {
      logger.error(
        { err },
        'startup housekeeping failed — the API is up but the database is not reachable. Run `npm run db:check`.',
      );
    }
  })();

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
