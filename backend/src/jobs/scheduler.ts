import cron, { type ScheduledTask } from 'node-cron';
import type pg from 'pg';
import type { Database } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getSettings } from '../services/settingsService.js';
import { startSync } from '../services/syncRunner.js';
import { SyncInProgressError } from '../services/syncService.js';

/**
 * In-process scheduling with node-cron.
 *
 * This is a single-user tool that already runs as a long-lived process; a queue
 * with its own Redis would exist solely to run one job a day. Overlap is
 * prevented by the Postgres advisory lock in the sync path, not by cron config,
 * so a slow run simply causes the next tick to be skipped rather than queued.
 */

let task: ScheduledTask | null = null;
let startupTimer: NodeJS.Timeout | null = null;

const STALE_SYNC_MS = 24 * 60 * 60_000;
const STARTUP_DELAY_MS = 30_000;

export async function startScheduler(db: Database, pool: pg.Pool): Promise<void> {
  stopScheduler();

  const settings = await getSettings(db);

  if (!cron.validate(settings.syncCron)) {
    logger.error({ syncCron: settings.syncCron }, 'invalid cron expression — scheduled sync disabled');
    return;
  }

  task = cron.schedule(
    settings.syncCron,
    () => {
      void runScheduledSync(db, pool, 'cron');
    },
    { timezone: settings.timezone },
  );

  logger.info({ syncCron: settings.syncCron, timezone: settings.timezone }, 'scheduled sync registered');

  // If the process was down when the cron should have fired, the tick is simply
  // missed — node-cron has no catch-up. Checking staleness at boot covers that.
  startupTimer = setTimeout(() => {
    void maybeCatchUp(db, pool);
  }, STARTUP_DELAY_MS);
  startupTimer.unref();
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
}

/** Re-registers after a settings change so a new cron/timezone takes effect. */
export async function restartScheduler(db: Database, pool: pg.Pool): Promise<void> {
  await startScheduler(db, pool);
}

async function maybeCatchUp(db: Database, pool: pg.Pool): Promise<void> {
  try {
    const accounts = await db.query.registrarAccounts.findMany();
    const enabled = accounts.filter((account) => account.isEnabled);
    if (enabled.length === 0) return;

    const stale = enabled.some(
      (account) =>
        account.lastSyncStatus !== 'success' ||
        !account.lastSyncAt ||
        Date.now() - account.lastSyncAt.getTime() > STALE_SYNC_MS,
    );
    if (!stale) return;

    logger.info('last successful sync is stale — running a catch-up sync');
    await runScheduledSync(db, pool, 'startup');
  } catch (err) {
    logger.error({ err }, 'startup catch-up check failed');
  }
}

async function runScheduledSync(db: Database, pool: pg.Pool, trigger: 'cron' | 'startup'): Promise<void> {
  try {
    const started = await startSync(db, pool, { mode: 'full', trigger });
    logger.info({ trigger, runs: started.length }, 'scheduled sync started');
  } catch (err) {
    if (err instanceof SyncInProgressError) {
      logger.warn({ trigger }, 'scheduled sync skipped — a sync is already running');
      return;
    }
    logger.error({ err, trigger }, 'scheduled sync failed to start');
  }
}
