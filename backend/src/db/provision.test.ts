import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, createPool } from './client.js';
import {
  describeExpectedRegistrars,
  ensureRegistrarAccounts,
  PROVISION_RETRY_COOLDOWN_MS,
  provisionRegistrarAccounts,
  resetProvisioningCache,
} from './provision.js';
import { appSettings, registrarAccounts, tldPrices } from './schema.js';
import { createHarness, resetDatabase, type TestHarness } from '../test/helpers.js';

/**
 * These cover the bug that made a Vercel deployment sit empty with a valid
 * IONOS key: account rows only ever existed because someone ran `db:seed` on a
 * laptop. The concurrency case is the important one — it is what proves the ON
 * CONFLICT target matches the real unique index rather than merely compiling.
 */

let harness: TestHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

// Before as well as after: the database may hold rows from an earlier suite.
beforeEach(async () => {
  await resetDatabase(harness.db);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetProvisioningCache();
  await resetDatabase(harness.db);
});

/** The specs read `process.env` live, but `isMockMode` is an env.ts snapshot. */
function clearCredentials() {
  vi.stubEnv('IONOS_API_KEY', '');
  vi.stubEnv('IONOS_TENANT_ID', '');
  vi.stubEnv('GODADDY_API_KEY', '');
  vi.stubEnv('GODADDY_API_SECRET', '');
}

async function accountRows() {
  return harness.db.select().from(registrarAccounts);
}

describe('provisionRegistrarAccounts', () => {
  it('creates the IONOS account from the environment alone', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'prefix.secret');
    vi.stubEnv('IONOS_TENANT_ID', 'tenant-1');

    const summary = await provisionRegistrarAccounts(harness.db, { mockMode: false });

    expect(summary.created).toEqual([{ kind: 'ionos', label: 'IONOS' }]);
    const rows = await accountRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'ionos',
      credentialRef: 'IONOS_API_KEY',
      tenantId: 'tenant-1',
      isEnabled: true,
    });
    // The key itself must never reach the database.
    expect(JSON.stringify(rows)).not.toContain('prefix.secret');
  });

  it('is idempotent', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    await provisionRegistrarAccounts(harness.db, { mockMode: false });
    const second = await provisionRegistrarAccounts(harness.db, { mockMode: false });

    expect(second.created).toEqual([]);
    expect(second.accounts).toBe(1);
    expect(await accountRows()).toHaveLength(1);
  });

  it('creates exactly one row when instances race', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    // Three cold starts hitting the same database at once — the Vercel case.
    const results = await Promise.all([
      provisionRegistrarAccounts(harness.db, { mockMode: false }),
      provisionRegistrarAccounts(harness.db, { mockMode: false }),
      provisionRegistrarAccounts(harness.db, { mockMode: false }),
    ]);

    expect(await accountRows()).toHaveLength(1);
    expect(results.flatMap((result) => result.created)).toHaveLength(1);
  });

  it('creates nothing, and says what is missing, with no credentials', async () => {
    clearCredentials();

    const summary = await provisionRegistrarAccounts(harness.db, { mockMode: false });

    expect(await accountRows()).toHaveLength(0);
    expect(summary.skipped.map((entry) => entry.kind)).toEqual(['ionos', 'godaddy']);
    expect(summary.skipped[0]!.missingEnv).toEqual(['IONOS_API_KEY']);
  });

  it('refuses a half-configured GoDaddy account', async () => {
    clearCredentials();
    // The key without the secret would produce a row that reports red forever.
    vi.stubEnv('GODADDY_API_KEY', 'key-only');

    await provisionRegistrarAccounts(harness.db, { mockMode: false });

    expect(await accountRows()).toHaveLength(0);
    expect(describeExpectedRegistrars().find((entry) => entry.kind === 'godaddy')).toMatchObject({
      configured: false,
      missingEnv: ['GODADDY_API_SECRET'],
    });
  });

  it('still creates the IONOS row in mock mode with no key', async () => {
    clearCredentials();

    // Otherwise a developer running MOCK_REGISTRAR=1 without a real key gets
    // zero accounts and an app that cannot even sync fixtures.
    const summary = await provisionRegistrarAccounts(harness.db, { mockMode: true });

    expect(summary.created).toEqual([{ kind: 'ionos', label: 'IONOS' }]);
    expect(await accountRows()).toHaveLength(1);
  });

  it('leaves app_settings and tld_prices alone', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    await provisionRegistrarAccounts(harness.db, { mockMode: false });

    // Those rows are opinionated content, not structure; only `db:seed` writes
    // them, so provisioning on a request can never surprise a user with prices
    // that are not theirs.
    expect(await harness.db.select().from(tldPrices)).toHaveLength(0);
    expect(await harness.db.select().from(appSettings)).toHaveLength(0);
  });
});

describe('ensureRegistrarAccounts', () => {
  it('resolves rather than throwing when the database is unreachable', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    const pool = createPool('postgres://nobody:nobody@127.0.0.1:1/nothing');
    const db = createDb(pool);
    try {
      // A provisioning failure must never turn a working request into a 500.
      await expect(ensureRegistrarAccounts(db, { mockMode: false })).resolves.toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('memoizes success, so later requests cost nothing', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    await ensureRegistrarAccounts(harness.db, { mockMode: false });
    // Deleting behind its back: a second call that queried would recreate the
    // row, so an unchanged empty table proves the result was cached.
    await harness.db.execute(sql`delete from registrar_accounts`);
    await ensureRegistrarAccounts(harness.db, { mockMode: false });

    expect(await accountRows()).toHaveLength(0);
  });

  it('holds off after a failure, then retries past the cooldown', async () => {
    clearCredentials();
    vi.stubEnv('IONOS_API_KEY', 'k');

    const pool = createPool('postgres://nobody:nobody@127.0.0.1:1/nothing');
    const failing = createDb(pool);
    const attempt = vi.spyOn(failing, 'insert');
    try {
      await ensureRegistrarAccounts(failing, { mockMode: false });
      expect(attempt).toHaveBeenCalledTimes(1);

      // Inside the cooldown: no connection attempt at all, so an unreachable
      // database is not dialled once per page load.
      await ensureRegistrarAccounts(failing, { mockMode: false });
      expect(attempt).toHaveBeenCalledTimes(1);

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PROVISION_RETRY_COOLDOWN_MS + 1);
      await ensureRegistrarAccounts(failing, { mockMode: false });
      expect(attempt).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      await pool.end();
    }
  });
});
