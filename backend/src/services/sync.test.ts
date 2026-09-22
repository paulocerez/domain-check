import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import { alertLog, domains, syncChanges, syncRuns, tldPrices, type RegistrarAccountRow } from '../db/schema.js';
import { MockRegistrar } from '../registrars/mock/index.js';
import { FIXTURE_SPECS } from '../registrars/mock/fixtures.js';
import type { Registrar, RegistrarDomainSummary } from '../registrars/types.js';
import { createHarness, resetDatabase, seedBaseline, type TestHarness } from '../test/helpers.js';
import { runAlerts } from './alertService.js';
import { loadDomainContext } from './domainService.js';
import { getSettings } from './settingsService.js';
import {
  createSyncRun,
  runSync,
  syncAccount,
  SyncInProgressError,
  toRegistrarOwnedValues,
} from './syncService.js';
import type { EmailTransport } from './emailTransport.js';

let harness: TestHarness;
let db: Database;
let account: RegistrarAccountRow;

/**
 * `createRegistrar` reads MOCK_REGISTRAR from the environment, so every test
 * here runs against fixtures. `registrarOverride` lets individual cases swap in
 * a mock with domains hidden, to drive the missing/reappeared cycle.
 */
let registrarOverride: Registrar | null = null;

beforeAll(async () => {
  harness = await createHarness();
  db = harness.db;
  const { createRegistrar } = await import('../registrars/registry.js');
  // Patch the module so runSync picks up the per-test registrar.
  const registry = await import('../registrars/registry.js');
  Object.defineProperty(registry, 'createRegistrar', {
    value: (acct: RegistrarAccountRow) => registrarOverride ?? createRegistrar(acct),
    configurable: true,
  });
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  registrarOverride = null;
  await resetDatabase(db);
  account = await seedBaseline(db);
});

async function sync(options: { mode?: 'full' | 'quick'; hidden?: string[] } = {}) {
  registrarOverride = new MockRegistrar({ hiddenIds: new Set(options.hidden ?? []) });
  const mode = options.mode ?? 'full';
  const syncRunId = await createSyncRun(db, account, { mode, trigger: 'manual' });
  return runSync(db, account, { mode, trigger: 'manual' }, syncRunId);
}

describe('syncAccount', () => {
  it('creates every fixture domain on a first run', async () => {
    const outcome = await sync();
    expect(outcome.domainsSeen).toBe(FIXTURE_SPECS.length);
    expect(outcome.domainsCreated).toBe(FIXTURE_SPECS.length);
    // One fixture deliberately fails its detail fetch.
    expect(outcome.apiErrors).toBe(1);
    expect(outcome.status).toBe('partial');
  });

  it('is idempotent — a second identical run changes nothing', async () => {
    await sync();
    const second = await sync();
    expect(second.domainsCreated).toBe(0);
    expect(second.domainsUpdated).toBe(0);
    expect(second.domainsUnchanged).toBe(FIXTURE_SPECS.length);
  });

  it('never overwrites user-owned columns', async () => {
    // The single most important invariant in the codebase: a sync must not
    // touch the price the user entered, nor their notes, tags or alert prefs.
    await sync();
    const before = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.de') });

    await db
      .update(domains)
      .set({
        priceOverrideCents: 2599,
        priceCurrency: 'EUR',
        termMonthsOverride: 24,
        notes: 'main brand domain',
        tags: ['core', 'brand'],
        project: 'Brand',
        alertsEnabled: false,
        alertLeadDays: [90, 45],
        isFavorite: true,
      })
      .where(eq(domains.id, before!.id));

    await sync();

    const after = await db.query.domains.findFirst({ where: eq(domains.id, before!.id) });
    expect(after).toMatchObject({
      priceOverrideCents: 2599,
      priceCurrency: 'EUR',
      termMonthsOverride: 24,
      notes: 'main brand domain',
      tags: ['core', 'brand'],
      project: 'Brand',
      alertsEnabled: false,
      alertLeadDays: [90, 45],
      isFavorite: true,
    });
  });

  it('records an audit row when a tracked field changes', async () => {
    await sync();
    const domain = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.de') });

    await db.update(domains).set({ autoRenew: false }).where(eq(domains.id, domain!.id));
    await sync();

    const changes = await db
      .select()
      .from(syncChanges)
      .where(and(eq(syncChanges.domainId, domain!.id), eq(syncChanges.field, 'autoRenew')));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: 'false', newValue: 'true', changeType: 'updated' });
  });

  it('marks a vanished domain missing, then revives it when it returns', async () => {
    await sync();
    const target = FIXTURE_SPECS[0]!;

    // Hide it *and* the fixture whose detail fails, so the run is clean and the
    // sweep is allowed to conclude anything is actually gone.
    const alsoHide = FIXTURE_SPECS.find((spec) => spec.detailFails)!.id;
    const withHidden = await sync({ hidden: [target.id, alsoHide] });
    expect(withHidden.status).toBe('success');
    expect(withHidden.domainsMissing).toBe(2);

    const missing = await db.query.domains.findFirst({ where: eq(domains.name, target.name) });
    expect(missing?.syncState).toBe('missing');
    expect(missing?.missingSince).not.toBeNull();

    await sync({ hidden: [alsoHide] });
    const revived = await db.query.domains.findFirst({ where: eq(domains.name, target.name) });
    expect(revived?.syncState).toBe('active');
    expect(revived?.missingSince).toBeNull();
  });

  it('does not sweep anything when the run was only partial', async () => {
    await sync();
    // The default fixture set always produces one detail failure, so this run
    // is 'partial' and must leave sync_state alone even though nothing is gone.
    const outcome = await sync();
    expect(outcome.status).toBe('partial');
    expect(outcome.domainsMissing).toBe(0);
    const states = await db.select({ state: domains.syncState }).from(domains);
    expect(states.every((row) => row.state === 'active')).toBe(true);
  });

  it('adopts a renamed registrar id by matching on name, keeping cost data', async () => {
    await sync();
    const target = FIXTURE_SPECS[1]!;
    const before = await db.query.domains.findFirst({ where: eq(domains.name, target.name) });
    await db
      .update(domains)
      .set({ registrarDomainId: 'stale-id-from-a-previous-registration', priceOverrideCents: 4242, priceCurrency: 'EUR' })
      .where(eq(domains.id, before!.id));

    await sync();

    const after = await db.query.domains.findFirst({ where: eq(domains.id, before!.id) });
    expect(after?.registrarDomainId).toBe(target.id);
    expect(after?.priceOverrideCents).toBe(4242);
    // Crucially, no duplicate row was inserted.
    const all = await db.select().from(domains).where(eq(domains.name, target.name));
    expect(all).toHaveLength(1);
  });

  it('keeps detail fields on a quick sync instead of nulling them', async () => {
    await sync({ mode: 'full' });
    const before = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.com') });
    expect(before?.expirationDate).not.toBeNull();

    const quick = await sync({ mode: 'quick' });
    expect(quick.detailCalls).toBe(0);

    const after = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.com') });
    // A quick sync simply omits detail-only columns from the SET clause.
    expect(after?.expirationDate?.toISOString()).toBe(before?.expirationDate?.toISOString());
    expect(after?.autoRenew).toBe(before?.autoRenew);
  });

  it('refuses to sweep the whole portfolio when the list comes back empty', async () => {
    await sync();
    const before = await db.select({ id: domains.id }).from(domains);
    expect(before.length).toBeGreaterThan(0);

    // A registrar answering 200 with nothing we recognise looks exactly like a
    // clean run over an empty account — zero summaries, zero errors — and used
    // to flag every domain 'missing' behind a green success badge.
    registrarOverride = new MockRegistrar({ hiddenIds: new Set(FIXTURE_SPECS.map((spec) => spec.id)) });
    const syncRunId = await createSyncRun(db, account, { mode: 'full', trigger: 'manual' });
    const outcome = await runSync(db, account, { mode: 'full', trigger: 'manual' }, syncRunId);

    expect(outcome.domainsSeen).toBe(0);
    expect(outcome.domainsMissing).toBe(0);
    expect(outcome.status).toBe('partial');

    const states = await db.select({ state: domains.syncState }).from(domains);
    expect(states).toHaveLength(before.length);
    expect(states.every((row) => row.state === 'active')).toBe(true);

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, syncRunId));
    expect(run?.errorMessage).toContain('returned 0 domains');
  });

  it('treats an empty list over an empty portfolio as a clean success', async () => {
    // Nothing tracked, nothing to lose: an account that genuinely holds no
    // domains must not be reported as a problem every time it is synced.
    registrarOverride = new MockRegistrar({ hiddenIds: new Set(FIXTURE_SPECS.map((spec) => spec.id)) });
    const syncRunId = await createSyncRun(db, account, { mode: 'full', trigger: 'manual' });
    const outcome = await runSync(db, account, { mode: 'full', trigger: 'manual' }, syncRunId);

    expect(outcome.status).toBe('success');
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, syncRunId));
    expect(run?.errorMessage).toBeNull();
  });

  it('rejects a concurrent sync of the same account', async () => {
    registrarOverride = new MockRegistrar();
    const first = syncAccount(db, harness.pool, account, { mode: 'full', trigger: 'manual' });
    await expect(
      syncAccount(db, harness.pool, account, { mode: 'full', trigger: 'manual' }),
    ).rejects.toBeInstanceOf(SyncInProgressError);
    await first;
  });
});

describe('alerts', () => {
  class CapturingTransport implements EmailTransport {
    readonly name = 'console' as const;
    sent: Array<{ subject: string; text: string }> = [];
    async send(message: { subject: string; text: string }) {
      this.sent.push({ subject: message.subject, text: message.text });
      return { messageId: `test-${this.sent.length}` };
    }
  }

  async function context() {
    const settings = await getSettings(db);
    await db
      .update(await import('../db/schema.js').then((m) => m.appSettings))
      .set({ alertEmailTo: 'to@example.com', alertEmailFrom: 'from@example.com' });
    return loadDomainContext(db, { ...settings, alertEmailTo: 'to@example.com', alertEmailFrom: 'from@example.com' });
  }

  it('sends one digest and then dedupes', async () => {
    await sync();
    const transport = new CapturingTransport();

    const first = await runAlerts(db, await context(), { transport });
    expect(first.claimed).toBeGreaterThan(0);
    expect(first.sent).toBe(true);
    expect(transport.sent).toHaveLength(1);

    // Running again must claim nothing — the dedupe key includes the expiry.
    const second = await runAlerts(db, await context(), { transport });
    expect(second.claimed).toBe(0);
    expect(second.sent).toBe(false);
    expect(transport.sent).toHaveLength(1);
  });

  it('becomes eligible again once the domain renews', async () => {
    await sync();
    const transport = new CapturingTransport();
    await runAlerts(db, await context(), { transport });

    const domain = await db.query.domains.findFirst({ where: eq(domains.name, 'expiring-tomorrow.de') });
    const claimedBefore = await db.select().from(alertLog).where(eq(alertLog.domainId, domain!.id));
    expect(claimedBefore.length).toBeGreaterThan(0);

    // Push the expiry a year out, as a renewal would.
    const nextYear = new Date(Date.now() + 365 * 86_400_000);
    await db
      .update(domains)
      .set({ expirationDate: nextYear, setToExpireOn: nextYear })
      .where(eq(domains.id, domain!.id));

    // Still outside every lead window, so nothing fires yet...
    const quiet = await runAlerts(db, await context(), { transport });
    expect(quiet.claimed).toBe(0);

    // ...but bring it back inside one and the same kind is eligible again,
    // because the dedupe key now carries a different expiry.
    const soon = new Date(Date.now() + 2 * 86_400_000);
    await db.update(domains).set({ expirationDate: soon, setToExpireOn: soon }).where(eq(domains.id, domain!.id));
    const again = await runAlerts(db, await context(), { transport });
    expect(again.claimed).toBeGreaterThan(0);
  });

  it('releases claims when sending fails, so the next run retries', async () => {
    await sync();
    const failing: EmailTransport = {
      name: 'console',
      async send() {
        throw new Error('mail server unreachable');
      },
    };

    await expect(runAlerts(db, await context(), { transport: failing })).rejects.toThrow('unreachable');
    const stranded = await db.select().from(alertLog);
    expect(stranded).toHaveLength(0);

    const transport = new CapturingTransport();
    const retry = await runAlerts(db, await context(), { transport });
    expect(retry.claimed).toBeGreaterThan(0);
  });

  it('skips domains with alerts disabled', async () => {
    await sync();
    await db.update(domains).set({ alertsEnabled: false });
    const transport = new CapturingTransport();
    const result = await runAlerts(db, await context(), { transport });
    expect(result.candidates).toBe(0);
  });
});

describe('cost data', () => {
  it('prices a domain from the TLD table and leaves unknown TLDs unpriced', async () => {
    await sync();
    const settings = await getSettings(db);
    const ctx = await loadDomainContext(db, settings);
    const { toDomainDTO } = await import('./domainService.js');

    const priced = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.de') });
    expect(toDomainDTO(priced!, ctx).effectivePrice).toMatchObject({ source: 'tld', renewalCents: 1200 });

    const unpriced = await db.query.domains.findFirst({ where: eq(domains.name, 'unpriced-tld.bayern') });
    expect(toDomainDTO(unpriced!, ctx).effectivePrice.source).toBe('unknown');
  });

  it('rejects a price override without a currency at the database level', async () => {
    await sync();
    const domain = await db.query.domains.findFirst({ where: eq(domains.name, 'vetpal.de') });
    await expect(
      db.update(domains).set({ priceOverrideCents: 1000, priceCurrency: null }).where(eq(domains.id, domain!.id)),
    ).rejects.toThrow();
  });

  it('keeps one price row per TLD', async () => {
    await expect(
      db.insert(tldPrices).values({ tld: 'de', renewalCents: 999, currency: 'EUR' }),
    ).rejects.toThrow();
  });
});

/**
 * The undefined-vs-null contract on `RegistrarDomainSummary`.
 *
 * A registrar whose list endpoint is rich enough (GoDaddy) reports these in
 * phase one; one whose list endpoint is not (IONOS) leaves them `undefined`.
 * Conflating the two would make a quick IONOS sync wipe every expiry in the
 * portfolio, which is why it is asserted directly rather than only through the
 * end-to-end quick-sync case above.
 */
describe('toRegistrarOwnedValues', () => {
  const base: RegistrarDomainSummary = {
    registrarDomainId: 'id-1',
    name: 'example.com',
    tld: 'com',
    pendingProvisioning: false,
  };

  it('omits fields the summary does not mention, so the stored value survives', () => {
    const values = toRegistrarOwnedValues(base, null) as Record<string, unknown>;
    expect('expirationDate' in values).toBe(false);
    expect('autoRenew' in values).toBe(false);
    expect('domainLock' in values).toBe(false);
  });

  it('writes fields a rich summary does supply, with no detail fetch', () => {
    const expires = new Date('2027-04-02T07:17:45.000Z');
    const values = toRegistrarOwnedValues(
      { ...base, expirationDate: expires, autoRenew: true, domainLock: false },
      null,
    ) as Record<string, unknown>;

    expect(values.expirationDate).toEqual(expires);
    expect(values.autoRenew).toBe(true);
    expect(values.domainLock).toBe(false);
  });

  it('writes an explicit null from a summary, because that is an answer', () => {
    const values = toRegistrarOwnedValues({ ...base, expirationDate: null }, null) as Record<string, unknown>;
    expect('expirationDate' in values).toBe(true);
    expect(values.expirationDate).toBeNull();
  });

  it('lets an authoritative detail override what the summary said', () => {
    const fromList = new Date('2027-01-01T00:00:00.000Z');
    const fromDetail = new Date('2028-01-01T00:00:00.000Z');
    const values = toRegistrarOwnedValues(
      { ...base, expirationDate: fromList, autoRenew: true },
      { ...base, expirationDate: fromDetail, autoRenew: false, raw: {} },
    ) as Record<string, unknown>;

    expect(values.expirationDate).toEqual(fromDetail);
    expect(values.autoRenew).toBe(false);
  });

  it('never emits a user-owned column, whatever the summary carries', () => {
    const values = toRegistrarOwnedValues(
      { ...base, expirationDate: new Date() },
      { ...base, raw: { priceOverrideCents: 9999, notes: 'from the registrar' } },
    ) as Record<string, unknown>;

    for (const field of ['priceOverrideCents', 'priceCurrency', 'notes', 'tags', 'isFavorite']) {
      expect(values).not.toHaveProperty(field);
    }
  });
});
