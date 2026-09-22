import {
  availabilityBodySchema,
  bulkTldPriceBodySchema,
  domainQuerySchema,
  startSyncBodySchema,
  testAlertBodySchema,
  tldSchema,
  updateDomainBodySchema,
  updateSettingsBodySchema,
  upsertTldPriceBodySchema,
  type ApiOk,
  type HealthDTO,
  type ListMeta,
  type RegistrarAccountDTO,
  type RegistrarAccountsMeta,
} from '@domain-check/shared';
import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Database } from '../db/client.js';
import { checkDbHealth } from '../db/client.js';
import { domains, registrarAccounts, syncChanges, syncRuns } from '../db/schema.js';
import {
  credentialAdvice,
  describeExpectedRegistrars,
  ensureRegistrarAccounts,
  NoRegistrarConfiguredError,
} from '../db/provision.js';
import { env, isMockMode } from '../env.js';
import { explainDbFailure, findDbFailure } from '../lib/dbError.js';
import { logger } from '../lib/logger.js';
import { HttpError, notFound } from '../middleware/errorHandler.js';
import { asyncHandler, parseBody, parseQuery } from '../middleware/validate.js';
import { capabilitiesFor, createRegistrar, isCredentialConfigured } from '../registrars/registry.js';
import { runAlerts, sendTestAlert } from '../services/alertService.js';
import { checkAvailability, findAvailabilityAccount } from '../services/availabilityService.js';
import {
  deleteDomain,
  getDomainDetail,
  listDomains,
  loadDomainContext,
  setSyncState,
  updateDomain,
} from '../services/domainService.js';
import {
  bulkUpsertTldPrices,
  deleteTldPrice,
  listTldPrices,
  upsertTldPrice,
} from '../services/priceService.js';
import { getSettings, toSettingsDTO, updateSettings } from '../services/settingsService.js';
import {
  getCostByTld,
  getExpiryBuckets,
  getExpiryTimeline,
  getRenewalCalendar,
  getSummary,
} from '../services/statsService.js';
import { getSyncRun, getSyncStatus, listSyncRuns, startSync } from '../services/syncRunner.js';
import { SyncInProgressError, refreshDomainDetail, syncAccount } from '../services/syncService.js';
import { alertLog } from '../db/schema.js';

const ok = <T, M = undefined>(data: T, meta?: M): ApiOk<T, M> => ({ ok: true, data, ...(meta ? { meta } : {}) });

export function createRoutes(db: Database, pool: pg.Pool, version: string): Router {
  const router = Router();

  /** Loads settings + price/account lookup tables once per request. */
  const context = async () => loadDomainContext(db, await getSettings(db));

  // --- health ---------------------------------------------------------------

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbStatus = await checkDbHealth();

      // Only query once the connection is known good. This endpoint exists to
      // be answerable when the database is NOT, so a second query here would
      // turn the one useful diagnostic into a 500 with a raw SQL error — and
      // make the caller wait through a second connection timeout to get it.
      let lastSyncAt: string | null = null;
      let counters: Pick<HealthDTO, 'registrarAccounts' | 'registrarAccountsReady' | 'syncRuns'> = {
        registrarAccounts: null,
        registrarAccountsReady: null,
        syncRuns: null,
      };
      let degraded = dbStatus !== 'up';

      if (dbStatus === 'up') {
        try {
          // One statement: the setup counters the UI needs to tell "nothing is
          // configured" from "never synced" from "synced and empty", plus the
          // timestamp. Credential presence cannot be asked of SQL, so the rows
          // come back and are counted here.
          const accounts = await db
            .select({
              kind: registrarAccounts.kind,
              credentialRef: registrarAccounts.credentialRef,
              isEnabled: registrarAccounts.isEnabled,
              lastSyncAt: registrarAccounts.lastSyncAt,
              runs: sql<number>`(select count(*)::int from ${syncRuns})`,
            })
            .from(registrarAccounts);

          const latest = accounts
            .map((row) => row.lastSyncAt)
            .filter((value): value is Date => value !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0];
          lastSyncAt = latest ? new Date(latest).toISOString() : null;

          counters = {
            registrarAccounts: accounts.length,
            registrarAccountsReady: accounts.filter(
              (row) => row.isEnabled && (isMockMode || isCredentialConfigured(row)),
            ).length,
            // The correlated subquery returns per row; with zero accounts there
            // are no rows, and zero accounts also means zero runs (the FK makes
            // a run without an account impossible).
            syncRuns: accounts[0]?.runs ?? 0,
          };
        } catch (err) {
          // This endpoint exists to be answerable when the database is not, so
          // a missing table must degrade it rather than turn it into a 500 with
          // a raw SQL error.
          const failure = findDbFailure(err);
          logger.warn(
            { err, db: failure ?? undefined },
            failure
              ? `health counters unavailable: ${explainDbFailure(failure) ?? failure.message}`
              : 'health counters unavailable — is the schema migrated?',
          );
          degraded = true;
        }
      }

      const payload: HealthDTO = {
        status: degraded ? 'degraded' : 'ok',
        db: dbStatus,
        registrarMode: isMockMode ? 'mock' : 'live',
        lastSyncAt,
        version,
        ...counters,
      };
      res.status(dbStatus === 'up' ? 200 : 503).json(ok(payload));
    }),
  );

  /**
   * Creates any registrar account row this environment's credentials call for.
   *
   * Registered *after* `/health` on purpose. Express matches in registration
   * order, so the one endpoint that must answer while the database is broken
   * can never be made to wait on a connection timeout by provisioning, nor be
   * turned into a 500 by it. Do not reorder these two.
   *
   * `ensureRegistrarAccounts` is memoized per process and never rejects, so
   * this costs one statement on the first request of a cold start and nothing
   * afterwards.
   */
  router.use(
    asyncHandler(async (_req, _res, next) => {
      await ensureRegistrarAccounts(db);
      next();
    }),
  );

  // --- domains --------------------------------------------------------------

  router.get(
    '/domains',
    asyncHandler(async (req, res) => {
      const query = parseQuery(domainQuerySchema, req);
      const ctx = await context();
      const { rows, total } = await listDomains(db, query, ctx);
      const meta: ListMeta = { total, limit: query.limit, offset: query.offset };
      res.json(ok(rows, meta));
    }),
  );

  router.get(
    '/domains/:id',
    asyncHandler(async (req, res) => {
      const detail = await getDomainDetail(db, req.params.id!, await context());
      if (!detail) throw notFound('Domain');
      res.json(ok(detail));
    }),
  );

  router.patch(
    '/domains/:id',
    asyncHandler(async (req, res) => {
      // The schema is `.strict()` and lists user-owned fields only, so naming a
      // registrar-owned column here is a 400 rather than a write the next sync
      // would silently undo.
      const patch = parseBody(updateDomainBodySchema, req);
      const updated = await updateDomain(db, req.params.id!, patch);
      if (!updated) throw notFound('Domain');
      const detail = await getDomainDetail(db, updated.id, await context());
      res.json(ok(detail));
    }),
  );

  router.post(
    '/domains/:id/refresh',
    asyncHandler(async (req, res) => {
      await refreshDomainDetail(db, req.params.id!);
      const detail = await getDomainDetail(db, req.params.id!, await context());
      if (!detail) throw notFound('Domain');
      res.json(ok(detail));
    }),
  );

  router.post(
    '/domains/:id/archive',
    asyncHandler(async (req, res) => {
      const updated = await setSyncState(db, req.params.id!, 'archived');
      if (!updated) throw notFound('Domain');
      res.json(ok(await getDomainDetail(db, updated.id, await context())));
    }),
  );

  router.post(
    '/domains/:id/unarchive',
    asyncHandler(async (req, res) => {
      const updated = await setSyncState(db, req.params.id!, 'active');
      if (!updated) throw notFound('Domain');
      res.json(ok(await getDomainDetail(db, updated.id, await context())));
    }),
  );

  router.delete(
    '/domains/:id',
    asyncHandler(async (req, res) => {
      const deleted = await deleteDomain(db, req.params.id!);
      if (!deleted) {
        // Deliberately not a 404: the row may well exist and simply not be
        // archived, and saying so is more useful than "not found".
        throw new HttpError(
          409,
          'CONFLICT',
          'Only archived domains can be deleted. Archive it first — this discards its cost data.',
        );
      }
      res.status(204).end();
    }),
  );

  // --- stats ----------------------------------------------------------------

  router.get('/stats/summary', asyncHandler(async (_req, res) => res.json(ok(await getSummary(db, await context())))));
  router.get('/stats/cost-by-tld', asyncHandler(async (_req, res) => res.json(ok(await getCostByTld(db, await context())))));
  router.get('/stats/expiry-buckets', asyncHandler(async (_req, res) => res.json(ok(await getExpiryBuckets(db, await context())))));
  router.get(
    '/stats/renewal-calendar',
    asyncHandler(async (req, res) => {
      const months = Math.min(Math.max(Number(req.query.months ?? 12) || 12, 1), 36);
      res.json(ok(await getRenewalCalendar(db, await context(), months)));
    }),
  );
  router.get(
    '/stats/expiry-timeline',
    asyncHandler(async (_req, res) => res.json(ok(await getExpiryTimeline(db, await context())))),
  );

  router.get(
    '/activity',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 15) || 15, 1), 100);
      const rows = await db
        .select({ change: syncChanges, name: domains.name })
        .from(syncChanges)
        .innerJoin(domains, eq(syncChanges.domainId, domains.id))
        .orderBy(desc(syncChanges.createdAt))
        .limit(limit);
      res.json(
        ok(
          rows.map(({ change, name }) => ({
            id: String(change.id),
            syncRunId: change.syncRunId,
            domainId: change.domainId,
            domainName: name,
            changeType: change.changeType,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            createdAt: change.createdAt.toISOString(),
          })),
        ),
      );
    }),
  );

  // --- prices ---------------------------------------------------------------

  router.get(
    '/tld-prices',
    asyncHandler(async (_req, res) => {
      const { prices, missingTlds } = await listTldPrices(db);
      res.json(ok(prices, { missingTlds }));
    }),
  );

  router.put(
    '/tld-prices/:tld',
    asyncHandler(async (req, res) => {
      const tld = tldSchema.parse(req.params.tld);
      res.json(ok(await upsertTldPrice(db, tld, parseBody(upsertTldPriceBodySchema, req))));
    }),
  );

  router.post(
    '/tld-prices/bulk',
    asyncHandler(async (req, res) => {
      const body = parseBody(bulkTldPriceBodySchema, req);
      const written = await bulkUpsertTldPrices(db, body.entries, body.currency, body.termMonths);
      res.json(ok({ written }));
    }),
  );

  router.delete(
    '/tld-prices/:tld',
    asyncHandler(async (req, res) => {
      const removed = await deleteTldPrice(db, tldSchema.parse(req.params.tld));
      if (!removed) throw notFound('TLD price');
      res.status(204).end();
    }),
  );

  // --- registrar accounts ---------------------------------------------------

  router.get(
    '/registrar-accounts',
    asyncHandler(async (_req, res) => {
      const accounts = await db.select().from(registrarAccounts);
      const counts = await db
        .select({ accountId: domains.registrarAccountId, count: sql<number>`count(*)::int` })
        .from(domains)
        .groupBy(domains.registrarAccountId);
      const countByAccount = new Map(counts.map((row) => [row.accountId, row.count]));

      const payload: RegistrarAccountDTO[] = accounts.map((account) => ({
        id: account.id,
        kind: account.kind as RegistrarAccountDTO['kind'],
        label: account.label,
        credentialRef: account.credentialRef,
        // Reports only whether the env var is set. The value never leaves the
        // process — no endpoint returns anything matching /key|secret|token/i.
        credentialConfigured: isCredentialConfigured(account),
        isEnabled: account.isEnabled,
        lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: account.lastSyncStatus as RegistrarAccountDTO['lastSyncStatus'],
        domainCount: countByAccount.get(account.id) ?? 0,
        capabilities: capabilitiesFor(account.kind),
      }));

      // `expected` is what makes an empty list speakable. With no rows there is
      // nothing to hang a "key missing" badge on, so the UI used to render
      // silence; this says which variable this environment is short of.
      const expected = describeExpectedRegistrars();
      const meta: RegistrarAccountsMeta = {
        expected,
        noCredentials: !expected.some((entry) => entry.configured),
      };
      res.json(ok(payload, meta));
    }),
  );

  router.post(
    '/registrar-accounts/:id/verify',
    asyncHandler(async (req, res) => {
      const account = await db.query.registrarAccounts.findFirst({
        where: eq(registrarAccounts.id, req.params.id!),
      });
      if (!account) throw notFound('Registrar account');
      res.json(ok(await createRegistrar(account).verifyCredentials()));
    }),
  );

  // --- availability ---------------------------------------------------------

  /**
   * POST rather than GET: 50 names do not belong in a query string, and this
   * costs an upstream request per call, so it should not look cacheable.
   */
  router.post(
    '/availability',
    asyncHandler(async (req, res) => {
      const { names } = parseBody(availabilityBodySchema, req);
      res.json(ok(await checkAvailability(db, names)));
    }),
  );

  /** Lets the UI gate the page without guessing from the capability list. */
  router.get(
    '/availability/support',
    asyncHandler(async (_req, res) => {
      const account = await findAvailabilityAccount(db);
      res.json(
        ok({
          supported: account !== null,
          // In mock mode the answer comes from fixtures whatever the account
          // says, so naming the registrar would be a straight lie in the one
          // place the user is deciding whether to trust a result.
          registrarLabel: account === null ? null : isMockMode ? 'fixtures' : account.label,
        }),
      );
    }),
  );

  // --- sync -----------------------------------------------------------------

  router.post(
    '/sync',
    asyncHandler(async (req, res) => {
      const body = parseBody(startSyncBodySchema, req);
      const started = await startSync(db, pool, { ...body, trigger: 'manual' });
      // 202: the run is underway; the client polls /sync/status for progress.
      res.status(202).json(ok(started));
    }),
  );

  /**
   * Scheduled sync, for platforms whose cron is an HTTP call rather than an
   * in-process timer (see jobs/scheduler.ts, which stands down on serverless).
   *
   * Runs the sync to completion rather than answering 202: a scheduler has no
   * one to poll for status, and returning early on a serverless runtime risks
   * the instance being frozen mid-run.
   */
  router.get(
    '/cron/sync',
    asyncHandler(async (req, res) => {
      const expected = env.CRON_SECRET;
      if (!expected) {
        // Refuse rather than run unauthenticated — otherwise this is a public
        // endpoint that hammers the registrar API on demand.
        throw new HttpError(503, 'INTERNAL', 'CRON_SECRET is not configured; scheduled sync is disabled');
      }
      if (req.headers.authorization !== `Bearer ${expected}`) {
        throw new HttpError(401, 'REGISTRAR_AUTH', 'Invalid cron credentials');
      }

      const accounts = await db.select().from(registrarAccounts).where(eq(registrarAccounts.isEnabled, true));

      // Zero syncable accounts used to answer `200 {runs: []}` — a scheduled
      // job that reported success every morning while doing nothing at all.
      // The cron has no UI to read, so the log line and the status code are the
      // only places this can be said.
      const syncable = accounts.filter((account) => isMockMode || isCredentialConfigured(account));
      if (syncable.length === 0) {
        logger.error(
          { accounts: accounts.length },
          'scheduled sync has nothing to sync — no registrar account has usable credentials',
        );
        throw new NoRegistrarConfiguredError(
          accounts.length === 0
            ? `Scheduled sync did nothing: no registrar account is configured. ${credentialAdvice()}`
            : `Scheduled sync did nothing: ${accounts.length} account(s) exist but none has credentials in this environment. ${credentialAdvice()}`,
          describeExpectedRegistrars().flatMap((entry) => entry.missingEnv),
        );
      }

      const outcomes = [];
      for (const account of syncable) {
        try {
          // syncAccount takes the advisory lock, so a scheduled run can never
          // overlap a manual one already in flight.
          outcomes.push(await syncAccount(db, pool, account, { mode: 'full', trigger: 'cron' }));
        } catch (err) {
          if (err instanceof SyncInProgressError) {
            // Someone pressed Sync now. Skipping is correct — the data is
            // being refreshed either way.
            outcomes.push({ account: account.label, skipped: 'a sync was already running' });
            continue;
          }
          throw err;
        }
      }

      const ctx = await context();
      const alerts = await runAlerts(db, ctx);
      // `accountsConsidered` makes a run that skipped accounts readable: the
      // run list alone cannot show what was left out.
      res.json(ok({ runs: outcomes, accountsConsidered: accounts.length, alerts }));
    }),
  );

  router.get('/sync/status', asyncHandler(async (_req, res) => res.json(ok(await getSyncStatus(db)))));

  router.get(
    '/sync/runs',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      res.json(ok(await listSyncRuns(db, limit)));
    }),
  );

  router.get(
    '/sync/runs/:id',
    asyncHandler(async (req, res) => {
      const run = await getSyncRun(db, req.params.id!);
      if (!run) throw notFound('Sync run');
      const changes = await db
        .select({ change: syncChanges, name: domains.name })
        .from(syncChanges)
        .innerJoin(domains, eq(syncChanges.domainId, domains.id))
        .where(eq(syncChanges.syncRunId, run.id))
        .orderBy(desc(syncChanges.createdAt))
        .limit(500);
      res.json(
        ok({
          run,
          changes: changes.map(({ change, name }) => ({
            id: String(change.id),
            domainId: change.domainId,
            domainName: name,
            changeType: change.changeType,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            createdAt: change.createdAt.toISOString(),
          })),
        }),
      );
    }),
  );

  // --- settings & alerts ----------------------------------------------------

  router.get('/settings', asyncHandler(async (_req, res) => res.json(ok(toSettingsDTO(await getSettings(db))))));

  router.patch(
    '/settings',
    asyncHandler(async (req, res) => {
      const patch = parseBody(updateSettingsBodySchema, req);
      res.json(ok(toSettingsDTO(await updateSettings(db, patch))));
    }),
  );

  router.get(
    '/alerts',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const rows = await db
        .select({ alert: alertLog, name: domains.name })
        .from(alertLog)
        .innerJoin(domains, eq(alertLog.domainId, domains.id))
        .orderBy(desc(alertLog.sentAt))
        .limit(limit);
      res.json(
        ok(
          rows.map(({ alert, name }) => ({
            id: String(alert.id),
            domainId: alert.domainId,
            domainName: name,
            alertKind: alert.alertKind,
            expirationDate: alert.expirationDate,
            sentAt: alert.sentAt.toISOString(),
            resendMessageId: alert.resendMessageId,
            status: alert.status,
            error: alert.error,
          })),
        ),
      );
    }),
  );

  router.post(
    '/alerts/run',
    asyncHandler(async (_req, res) => res.json(ok(await runAlerts(db, await context())))),
  );

  router.post(
    '/alerts/test',
    asyncHandler(async (req, res) => {
      const body = parseBody(testAlertBodySchema, req);
      res.json(ok(await sendTestAlert(db, await context(), body.to)));
    }),
  );

  return router;
}
