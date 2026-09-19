import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { appSettings, registrarAccounts, tldPrices } from '../db/schema.js';
import { databaseUrl, env } from '../env.js';

/**
 * Integration-test harness.
 *
 * Runs against a real Postgres (TEST_DATABASE_URL), because the behaviours
 * worth testing here — the ON CONFLICT alert dedupe, advisory locks, array
 * columns, CHECK constraints — are precisely the ones an in-memory fake would
 * not reproduce.
 */

export interface TestHarness {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function testDatabaseUrl(): string {
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run integration tests');
  // These tests TRUNCATE. Pointing them at a database holding a real portfolio
  // would destroy it, so check every URL the app might actually be using —
  // both endpoints of a pooled provider, not just DATABASE_URL.
  for (const [name, candidate] of [
    ['DATABASE_URL', env.DATABASE_URL],
    ['DATABASE_URL_UNPOOLED', env.DATABASE_URL_UNPOOLED],
    ['the effective connection', databaseUrl],
  ] as const) {
    if (candidate && sameDatabase(url, candidate)) {
      throw new Error(`TEST_DATABASE_URL points at the same database as ${name} — these tests truncate tables`);
    }
  }
  return url;
}

/** Compares host+database, so a pooled and direct URL to one database still match. */
function sameDatabase(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.pathname === right.pathname &&
      left.hostname.replace('-pooler', '') === right.hostname.replace('-pooler', '')
    );
  } catch {
    return false;
  }
}

export async function createHarness(): Promise<TestHarness> {
  const url = testDatabaseUrl();
  await runMigrations(url);
  const pool = createPool(url);
  const db = createDb(pool);
  return { db, pool, close: () => pool.end() };
}

/** Truncating is far faster than re-migrating between cases. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table sync_changes, alert_log, sync_runs, domains, registrar_accounts, tld_prices, app_settings restart identity cascade`,
  );
}

export async function seedBaseline(db: Database) {
  await db.insert(appSettings).values({ id: 1, baseCurrency: 'EUR', timezone: 'Europe/Berlin' });
  await db.insert(tldPrices).values([
    { tld: 'de', renewalCents: 1200, currency: 'EUR', termMonths: 12, source: 'seed' },
    { tld: 'com', renewalCents: 1500, currency: 'EUR', termMonths: 12, source: 'seed' },
    { tld: 'io', renewalCents: 4900, currency: 'EUR', termMonths: 12, source: 'seed' },
  ]);
  const [account] = await db
    .insert(registrarAccounts)
    .values({ kind: 'mock', label: 'Fixtures', credentialRef: 'IONOS_API_KEY' })
    .returning();
  return account!;
}
