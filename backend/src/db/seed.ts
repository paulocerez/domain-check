import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { appSettings, registrarAccounts, tldPrices } from './schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

/**
 * Indicative list prices so a fresh install shows real numbers immediately.
 * Marked `source: 'seed'` so the prices page can nudge you to replace them with
 * what you actually pay — these are not your invoice.
 */
const SEED_TLD_PRICES: Array<[tld: string, renewalCents: number]> = [
  ['com', 1500],
  ['de', 1200],
  ['net', 1800],
  ['org', 1800],
  ['io', 4900],
  ['dev', 1800],
  ['app', 2000],
  ['eu', 1000],
  ['co', 3200],
  ['ai', 9900],
  ['at', 1800],
  ['ch', 1800],
  ['nl', 1000],
  ['info', 2400],
  ['biz', 2200],
  ['shop', 3200],
  ['online', 3900],
  ['cloud', 2400],
  ['me', 2400],
  ['co.uk', 1200],
];

export async function seed() {
  await db
    .insert(appSettings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: appSettings.id });

  await db
    .insert(tldPrices)
    .values(
      SEED_TLD_PRICES.map(([tld, renewalCents]) => ({
        tld,
        renewalCents,
        currency: 'EUR',
        termMonths: 12,
        source: 'seed' as const,
        notes: 'Indicative list price — replace with what you actually pay.',
      })),
    )
    // Never clobber a price the user has already set.
    .onConflictDoNothing({ target: tldPrices.tld });

  await db
    .insert(registrarAccounts)
    .values({
      kind: 'ionos',
      label: 'IONOS',
      credentialRef: 'IONOS_API_KEY',
      tenantId: env.IONOS_TENANT_ID ?? null,
    })
    .onConflictDoNothing({ target: [registrarAccounts.kind, registrarAccounts.label] });

  // Only seeded once a key exists. An unconditional row would leave every
  // IONOS-only install staring at a permanently unconfigured account it never
  // asked for, and would make `/api/registrar-accounts` report a warning state
  // that is not actually a problem.
  if (env.GODADDY_API_KEY) {
    await db
      .insert(registrarAccounts)
      .values({
        kind: 'godaddy',
        label: 'GoDaddy',
        credentialRef: 'GODADDY_API_KEY',
        tenantId: env.GODADDY_SHOPPER_ID ?? null,
      })
      .onConflictDoNothing({ target: [registrarAccounts.kind, registrarAccounts.label] });
  }

  const counts = await db
    .select({
      tlds: sql<number>`(select count(*)::int from ${tldPrices})`,
      accounts: sql<number>`(select count(*)::int from ${registrarAccounts})`,
    })
    .from(appSettings);

  return counts[0] ?? { tlds: 0, accounts: 0 };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  seed()
    .then((counts) => {
      logger.info(counts, 'seed complete');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'seed failed');
      process.exit(1);
    });
}
