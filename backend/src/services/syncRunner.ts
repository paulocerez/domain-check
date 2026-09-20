import type { SyncMode, SyncRunDTO, SyncStatusDTO, SyncTrigger } from '@domain-check/shared';
import { desc, eq } from 'drizzle-orm';
import type pg from 'pg';
import type { Database } from '../db/client.js';
import { registrarAccounts, syncRuns, type SyncRunRow } from '../db/schema.js';
import { acquireAdvisoryLock } from '../lib/advisoryLock.js';
import { runInBackground } from '../lib/background.js';
import { logger } from '../lib/logger.js';
import { runAlerts } from './alertService.js';
import { loadDomainContext } from './domainService.js';
import { getSettings } from './settingsService.js';
import { SyncInProgressError, createSyncRun, runSync, syncLockKey } from './syncService.js';

/**
 * Starts syncs in the background.
 *
 * A full sync of a few hundred domains takes 30–60 seconds, past any sane HTTP
 * timeout, so `POST /api/sync` answers 202 and the client polls
 * `/api/sync/status`. The lock and the run row are both taken *synchronously*
 * here so the response can be either a real run id or a truthful 409 — doing
 * that work in the background would mean returning an id for a run that may
 * never start.
 */

export interface StartSyncResult {
  syncRunId: string;
  accountId: string;
  registrarLabel: string;
}

export async function startSync(
  db: Database,
  pool: pg.Pool,
  options: { accountId?: string; mode: SyncMode; trigger: SyncTrigger },
): Promise<StartSyncResult[]> {
  const accounts = options.accountId
    ? await db.select().from(registrarAccounts).where(eq(registrarAccounts.id, options.accountId))
    : await db.select().from(registrarAccounts).where(eq(registrarAccounts.isEnabled, true));

  if (accounts.length === 0) throw new Error('No enabled registrar account to sync');

  const started: StartSyncResult[] = [];

  for (const account of accounts) {
    const lock = await acquireAdvisoryLock(pool, syncLockKey(account.id));
    if (!lock) {
      // Release anything already taken in this request so a partial failure
      // does not strand locks for the other accounts.
      await Promise.all(started.map((entry) => releaseFor(entry.accountId)));
      throw new SyncInProgressError(account.id);
    }

    let syncRunId: string;
    try {
      syncRunId = await createSyncRun(db, account, options);
    } catch (err) {
      await lock.release();
      throw err;
    }

    locks.set(account.id, lock);
    started.push({ syncRunId, accountId: account.id, registrarLabel: account.label });

    runInBackground(async () => {
      try {
        await runSync(db, account, { mode: options.mode, trigger: options.trigger }, syncRunId);
        await afterSync(db);
      } catch (err) {
        // runSync already recorded the failure on the run row.
        logger.error({ err, account: account.label }, 'background sync failed');
      } finally {
        await releaseFor(account.id);
      }
    }, `sync:${account.label}`);
  }

  return started;
}

const locks = new Map<string, { release(): Promise<void> }>();

async function releaseFor(accountId: string): Promise<void> {
  const lock = locks.get(accountId);
  if (!lock) return;
  locks.delete(accountId);
  await lock.release();
}

/** Alert evaluation follows every sync, so it runs on fresh expiry data. */
async function afterSync(db: Database): Promise<void> {
  try {
    const settings = await getSettings(db);
    const context = await loadDomainContext(db, settings);
    await runAlerts(db, context);
  } catch (err) {
    // A mail failure must not be reported as a sync failure — the portfolio
    // data landed fine.
    logger.error({ err }, 'post-sync alert evaluation failed');
  }
}

export function isSyncInFlight(accountId?: string): boolean {
  return accountId ? locks.has(accountId) : locks.size > 0;
}

export async function listSyncRuns(db: Database, limit = 50): Promise<SyncRunDTO[]> {
  const rows = await db
    .select({ run: syncRuns, label: registrarAccounts.label })
    .from(syncRuns)
    .innerJoin(registrarAccounts, eq(syncRuns.registrarAccountId, registrarAccounts.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit);
  return rows.map(({ run, label }) => toSyncRunDTO(run, label));
}

export async function getSyncRun(db: Database, id: string): Promise<SyncRunDTO | null> {
  const rows = await db
    .select({ run: syncRuns, label: registrarAccounts.label })
    .from(syncRuns)
    .innerJoin(registrarAccounts, eq(syncRuns.registrarAccountId, registrarAccounts.id))
    .where(eq(syncRuns.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toSyncRunDTO(row.run, row.label) : null;
}

export async function getSyncStatus(db: Database): Promise<SyncStatusDTO> {
  const rows = await db
    .select({ run: syncRuns, label: registrarAccounts.label })
    .from(syncRuns)
    .innerJoin(registrarAccounts, eq(syncRuns.registrarAccountId, registrarAccounts.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(10);

  const current = rows.find(({ run }) => run.status === 'running');
  const last = rows.find(({ run }) => run.status !== 'running');

  return {
    running: Boolean(current) || isSyncInFlight(),
    currentRun: current ? toSyncRunDTO(current.run, current.label) : null,
    lastRun: last ? toSyncRunDTO(last.run, last.label) : null,
  };
}

export function toSyncRunDTO(row: SyncRunRow, registrarLabel: string): SyncRunDTO {
  return {
    id: row.id,
    registrarAccountId: row.registrarAccountId,
    registrarLabel,
    mode: row.mode as SyncMode,
    trigger: row.trigger as SyncTrigger,
    status: row.status as SyncRunDTO['status'],
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    domainsSeen: row.domainsSeen,
    domainsCreated: row.domainsCreated,
    domainsUpdated: row.domainsUpdated,
    domainsUnchanged: row.domainsUnchanged,
    domainsMissing: row.domainsMissing,
    detailCalls: row.detailCalls,
    apiErrors: row.apiErrors,
    errorMessage: row.errorMessage,
  };
}
