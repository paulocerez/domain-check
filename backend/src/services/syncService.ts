import { TRACKED_CHANGE_FIELDS, type SyncMode, type SyncStatus, type SyncTrigger } from '@domain-check/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import type pg from 'pg';
import type { Database, DbOrTx } from '../db/client.js';
import {
  REGISTRAR_OWNED_FIELDS,
  domains,
  registrarAccounts,
  syncChanges,
  syncRuns,
  type DomainRow,
  type NewDomainRow,
  type RegistrarAccountRow,
} from '../db/schema.js';
import { env } from '../env.js';
import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { logger } from '../lib/logger.js';
import { createRegistrar } from '../registrars/registry.js';
import type { Registrar, RegistrarDomainDetail, RegistrarDomainSummary } from '../registrars/types.js';
import { RegistrarError } from '../registrars/types.js';

export interface SyncOptions {
  mode: SyncMode;
  trigger: SyncTrigger;
  signal?: AbortSignal;
}

export interface SyncOutcome {
  syncRunId: string;
  status: SyncStatus;
  domainsSeen: number;
  domainsCreated: number;
  domainsUpdated: number;
  domainsUnchanged: number;
  domainsMissing: number;
  detailCalls: number;
  apiErrors: number;
}

export class SyncInProgressError extends Error {
  constructor(accountId: string) {
    super(`A sync is already running for account ${accountId}`);
    this.name = 'SyncInProgressError';
  }
}

const BATCH_SIZE = 50;

export function syncLockKey(accountId: string): string {
  return `domain-check:sync:${accountId}`;
}

/**
 * Syncs one registrar account.
 *
 * Two-phase by design: the list endpoint yields the whole portfolio (including
 * a usable expiry) in a handful of requests, then a concurrency-limited fan-out
 * fetches the authoritative per-domain detail. `mode: 'quick'` skips the second
 * phase entirely.
 */
export async function syncAccount(
  db: Database,
  pool: pg.Pool,
  account: RegistrarAccountRow,
  options: SyncOptions,
): Promise<SyncOutcome> {
  const result = await withAdvisoryLock(pool, syncLockKey(account.id), async () => {
    const syncRunId = await createSyncRun(db, account, options);
    return runSync(db, account, options, syncRunId);
  });
  if (result === null) throw new SyncInProgressError(account.id);
  return result;
}

/**
 * Opens the run row.
 *
 * Split out so the HTTP layer can take the lock and create the run
 * synchronously — returning either a real run id or a 409 — and only then hand
 * the long-running work to the background.
 */
export async function createSyncRun(
  db: Database,
  account: RegistrarAccountRow,
  options: Pick<SyncOptions, 'mode' | 'trigger'>,
): Promise<string> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      registrarAccountId: account.id,
      mode: options.mode,
      trigger: options.trigger,
      status: 'running',
    })
    .returning({ id: syncRuns.id });
  return run!.id;
}

export async function runSync(
  db: Database,
  account: RegistrarAccountRow,
  options: SyncOptions,
  syncRunId: string,
): Promise<SyncOutcome> {
  const startedAt = Date.now();
  const log = logger.child({ syncRunId, account: account.label, mode: options.mode });

  const counts = {
    domainsSeen: 0,
    domainsCreated: 0,
    domainsUpdated: 0,
    domainsUnchanged: 0,
    domainsMissing: 0,
    detailCalls: 0,
    apiErrors: 0,
  };

  try {
    const registrar = createRegistrar(account);

    const summaries = await registrar.listDomains({ signal: options.signal });
    counts.domainsSeen = summaries.length;
    log.info({ domains: summaries.length }, 'listed domains');

    const details =
      options.mode === 'full'
        ? await fetchDetails(registrar, summaries, counts, options.signal, log)
        : new Map<string, RegistrarDomainDetail>();

    for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
      options.signal?.throwIfAborted();
      const batch = summaries.slice(i, i + BATCH_SIZE);
      await db.transaction(async (tx) => {
        for (const summary of batch) {
          const outcome = await upsertDomain(
            tx,
            account,
            syncRunId,
            summary,
            details.get(summary.registrarDomainId) ?? null,
          );
          if (outcome === 'created') counts.domainsCreated++;
          else if (outcome === 'updated') counts.domainsUpdated++;
          else counts.domainsUnchanged++;
        }
      });
    }

    // A run that hit any API error saw an incomplete portfolio, so it must not
    // conclude that anything is gone. Disappearance is far more often a
    // transient upstream fault than an actual deletion.
    const status: SyncStatus = counts.apiErrors > 0 ? 'partial' : 'success';
    if (status === 'success') {
      counts.domainsMissing = await sweepMissing(db, account.id, syncRunId);
      await reviveReappeared(db, account.id, syncRunId);
    } else {
      log.warn({ apiErrors: counts.apiErrors }, 'partial sync — skipping missing-domain sweep');
    }

    await finishRun(db, account, syncRunId, status, startedAt, counts, null);
    log.info({ ...counts, status }, 'sync finished');
    return { syncRunId, status, ...counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err instanceof RegistrarError
        ? { kind: err.kind, httpStatus: err.httpStatus, registrarCode: err.registrarCode }
        : undefined;
    await finishRun(db, account, syncRunId, 'failed', startedAt, counts, { message, detail });
    log.error({ err }, 'sync failed');
    throw err;
  }
}

/**
 * Fans out per-domain detail requests under a concurrency cap.
 *
 * Individual failures are counted, not thrown: a run where 3 of 120 details
 * fail should still persist the 117 good updates. It degrades the run to
 * 'partial', which in turn suppresses the missing sweep.
 */
async function fetchDetails(
  registrar: Registrar,
  summaries: RegistrarDomainSummary[],
  counts: { detailCalls: number; apiErrors: number },
  signal: AbortSignal | undefined,
  log: typeof logger,
): Promise<Map<string, RegistrarDomainDetail>> {
  const limit = pLimit(env.IONOS_CONCURRENCY);
  const details = new Map<string, RegistrarDomainDetail>();

  await Promise.all(
    summaries.map((summary) =>
      limit(async () => {
        signal?.throwIfAborted();
        try {
          counts.detailCalls++;
          details.set(summary.registrarDomainId, await registrar.getDomainDetail(summary.registrarDomainId));
        } catch (err) {
          counts.apiErrors++;
          log.warn(
            { domain: summary.name, err: err instanceof Error ? err.message : String(err) },
            'detail fetch failed — keeping previous values for this domain',
          );
        }
      }),
    ),
  );

  return details;
}

type UpsertOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Identity resolution, then a whitelist-only update.
 *
 * Matching is by registrar id first (immune to IDN/punycode confusion), then by
 * name — the name fallback lets a domain that was removed and re-added keep the
 * user's price overrides and notes instead of arriving as a blank new row.
 */
async function upsertDomain(
  tx: DbOrTx,
  account: RegistrarAccountRow,
  syncRunId: string,
  summary: RegistrarDomainSummary,
  detail: RegistrarDomainDetail | null,
): Promise<UpsertOutcome> {
  const incoming = toRegistrarOwnedValues(summary, detail);

  const byRegistrarId = await tx.query.domains.findFirst({
    where: and(
      eq(domains.registrarAccountId, account.id),
      eq(domains.registrarDomainId, summary.registrarDomainId),
    ),
  });

  const existing =
    byRegistrarId ??
    (await tx.query.domains.findFirst({
      where: and(eq(domains.registrarAccountId, account.id), eq(domains.name, summary.name)),
    }));

  if (!existing) {
    const [created] = await tx
      .insert(domains)
      .values({
        registrarAccountId: account.id,
        registrarDomainId: summary.registrarDomainId,
        ...incoming,
        syncState: 'active',
        lastSeenAt: new Date(),
        lastSeenSyncRunId: syncRunId,
      } as NewDomainRow)
      .returning({ id: domains.id });

    await tx.insert(syncChanges).values({
      syncRunId,
      domainId: created!.id,
      changeType: 'created',
    });
    return 'created';
  }

  const changes = diffTrackedFields(existing, incoming);

  await tx
    .update(domains)
    .set({
      // Adopt the row if it was matched by name under a new registrar id.
      registrarDomainId: summary.registrarDomainId,
      ...incoming,
      lastSeenAt: new Date(),
      lastSeenSyncRunId: syncRunId,
      updatedAt: new Date(),
    })
    .where(eq(domains.id, existing.id));

  if (changes.length > 0) {
    await tx.insert(syncChanges).values(
      changes.map((change) => ({
        syncRunId,
        domainId: existing.id,
        changeType: 'updated' as const,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      })),
    );
    return 'updated';
  }

  return 'unchanged';
}

/**
 * Builds the update payload by *picking* from an explicit allow-list rather
 * than spreading the mapped registrar object.
 *
 * This is the single most important invariant in the codebase. A spread would
 * silently clobber the user's price overrides, notes and alert preferences the
 * first time the mapper gained a field whose name happened to collide. There is
 * a dedicated test for it in sync.test.ts.
 */
export function toRegistrarOwnedValues(
  summary: RegistrarDomainSummary,
  detail: RegistrarDomainDetail | null,
): Pick<NewDomainRow, (typeof REGISTRAR_OWNED_FIELDS)[number]> {
  const source: Record<string, unknown> = {
    name: summary.name,
    encodedName: summary.encodedName ?? null,
    tld: summary.tld,
    setToExpireOn: summary.setToExpireOn ?? null,
    setToRenewOn: summary.setToRenewOn ?? null,
    provisioningStatus: summary.provisioningStatus ?? null,
    registrationType: summary.registrationType ?? null,
    complianceStatus: summary.complianceStatus ?? null,
    processStatus: summary.processStatus ?? null,
    transferStatus: summary.transferStatus ?? null,
    pendingProvisioning: summary.pendingProvisioning,
    isAutorenewSwitchable: summary.isAutorenewSwitchable ?? null,
    revivePossibleUntil: summary.revivePossibleUntil ?? null,
  };

  // Fields a rich list endpoint may already have answered for. `undefined` means
  // this registrar's list call does not carry them (IONOS), so the key must stay
  // *absent* from `source` and the stored value must survive — writing `?? null`
  // here instead would null out every expiry on the next quick IONOS sync.
  const fromRichSummary: Record<string, unknown> = {
    expirationDate: summary.expirationDate,
    cancellationDate: summary.cancellationDate,
    autoRenew: summary.autoRenew,
    cancelOnExpire: summary.cancelOnExpire,
    domainLock: summary.domainLock,
    transferLock: summary.transferLock,
    privacyEnabled: summary.privacyEnabled,
    dnsSecEnabled: summary.dnsSecEnabled,
    domainType: summary.domainType,
  };
  for (const [key, value] of Object.entries(fromRichSummary)) {
    if (value !== undefined) source[key] = value;
  }

  // A detail is authoritative and complete, so it overwrites unconditionally.
  if (detail) {
    Object.assign(source, {
      expirationDate: detail.expirationDate ?? null,
      cancellationDate: detail.cancellationDate ?? null,
      autoRenew: detail.autoRenew ?? null,
      cancelOnExpire: detail.cancelOnExpire ?? null,
      domainLock: detail.domainLock ?? null,
      transferLock: detail.transferLock ?? null,
      privacyEnabled: detail.privacyEnabled ?? null,
      dnsSecEnabled: detail.dnsSecEnabled ?? null,
      domainType: detail.domainType ?? null,
      rawDetail: detail.raw,
      detailFetchedAt: new Date(),
    });
  }

  const picked: Record<string, unknown> = {};
  for (const field of REGISTRAR_OWNED_FIELDS) {
    // A quick sync has no detail, so detail-only fields are simply absent from
    // the SET clause and keep their previous values rather than being nulled.
    if (field in source) picked[field] = source[field];
  }
  return picked as Pick<NewDomainRow, (typeof REGISTRAR_OWNED_FIELDS)[number]>;
}

interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

function diffTrackedFields(existing: DomainRow, incoming: Record<string, unknown>): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_CHANGE_FIELDS) {
    if (!(field in incoming)) continue;
    const before = serializeValue((existing as Record<string, unknown>)[field]);
    const after = serializeValue(incoming[field]);
    if (before !== after) changes.push({ field, oldValue: before, newValue: after });
  }
  return changes;
}

function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Flags active domains this run did not observe. Only ever called for clean runs. */
async function sweepMissing(db: Database, accountId: string, syncRunId: string): Promise<number> {
  const swept = await db
    .update(domains)
    .set({ syncState: 'missing', missingSince: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(domains.registrarAccountId, accountId),
        eq(domains.syncState, 'active'),
        // `is distinct from` so rows that never got a run id are caught too.
        sql`${domains.lastSeenSyncRunId} is distinct from ${syncRunId}::uuid`,
      ),
    )
    .returning({ id: domains.id });

  if (swept.length > 0) {
    await db.insert(syncChanges).values(
      swept.map((row) => ({ syncRunId, domainId: row.id, changeType: 'missing' as const })),
    );
  }
  return swept.length;
}

/** A previously-missing domain seen again this run is active once more. */
async function reviveReappeared(db: Database, accountId: string, syncRunId: string): Promise<void> {
  const revived = await db
    .update(domains)
    .set({ syncState: 'active', missingSince: null, updatedAt: new Date() })
    .where(
      and(
        eq(domains.registrarAccountId, accountId),
        eq(domains.syncState, 'missing'),
        eq(domains.lastSeenSyncRunId, syncRunId),
      ),
    )
    .returning({ id: domains.id });

  if (revived.length > 0) {
    await db.insert(syncChanges).values(
      revived.map((row) => ({ syncRunId, domainId: row.id, changeType: 'reappeared' as const })),
    );
  }
}

async function finishRun(
  db: Database,
  account: RegistrarAccountRow,
  syncRunId: string,
  status: SyncStatus,
  startedAt: number,
  counts: Omit<SyncOutcome, 'syncRunId' | 'status'>,
  error: { message: string; detail?: unknown } | null,
): Promise<void> {
  const finishedAt = new Date();
  await db
    .update(syncRuns)
    .set({
      status,
      finishedAt,
      durationMs: Date.now() - startedAt,
      ...counts,
      errorMessage: error?.message ?? null,
      errorDetail: error?.detail ?? null,
    })
    .where(eq(syncRuns.id, syncRunId));

  await db
    .update(registrarAccounts)
    .set({ lastSyncAt: finishedAt, lastSyncStatus: status, updatedAt: finishedAt })
    .where(eq(registrarAccounts.id, account.id));
}

/**
 * Marks runs left in 'running' by a crash or restart as failed.
 *
 * Without this the UI would show a sync that has been "in progress" for three
 * days, and `/api/sync/status` would report `running: true` forever.
 */
export async function reapStaleRuns(db: Database, olderThanMs = 30 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const reaped = await db
    .update(syncRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: 'Interrupted — the server stopped while this run was in progress',
    })
    .where(and(eq(syncRuns.status, 'running'), sql`${syncRuns.startedAt} < ${cutoff}`))
    .returning({ id: syncRuns.id });
  return reaped.length;
}

/** Refreshes one domain's detail on demand, outside a full run. */
export async function refreshDomainDetail(db: Database, domainId: string): Promise<void> {
  const domain = await db.query.domains.findFirst({ where: eq(domains.id, domainId) });
  if (!domain) throw new Error(`Domain ${domainId} not found`);

  const account = await db.query.registrarAccounts.findFirst({
    where: eq(registrarAccounts.id, domain.registrarAccountId),
  });
  if (!account) throw new Error(`Registrar account ${domain.registrarAccountId} not found`);

  const registrar = createRegistrar(account);
  const detail = await registrar.getDomainDetail(domain.registrarDomainId);

  await db
    .update(domains)
    .set({ ...toRegistrarOwnedValues(detail, detail), lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(domains.id, domainId));
}

/** Used by tests and the archive endpoint. */
export async function archiveDomains(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(domains)
    .set({ syncState: 'archived', updatedAt: new Date() })
    .where(and(inArray(domains.id, ids), ne(domains.syncState, 'archived')));
}
