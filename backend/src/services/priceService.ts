import type { TldPriceDTO, UpsertTldPriceBody } from '@domain-check/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { domains, tldPrices, type TldPriceRow } from '../db/schema.js';

export function toTldPriceDTO(row: TldPriceRow): TldPriceDTO {
  return {
    id: row.id,
    tld: row.tld,
    renewalCents: row.renewalCents,
    registrationCents: row.registrationCents,
    transferCents: row.transferCents,
    currency: row.currency,
    termMonths: row.termMonths,
    source: row.source as 'manual' | 'seed',
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface TldPriceListing {
  prices: Array<TldPriceDTO & { domainCount: number }>;
  /**
   * TLDs present in the portfolio with no price row. Surfaced first in the UI
   * so the shortest path is always "close the gaps" rather than "scroll".
   */
  missingTlds: Array<{ tld: string; domainCount: number }>;
}

export async function listTldPrices(db: Database): Promise<TldPriceListing> {
  const [rows, usage] = await Promise.all([
    db.select().from(tldPrices).orderBy(asc(tldPrices.tld)),
    db
      .select({ tld: domains.tld, domainCount: sql<number>`count(*)::int` })
      .from(domains)
      .where(sql`${domains.syncState} <> 'archived'`)
      .groupBy(domains.tld),
  ]);

  const usageByTld = new Map(usage.map((row) => [row.tld, row.domainCount]));
  const pricedTlds = new Set(rows.map((row) => row.tld));

  return {
    prices: rows.map((row) => ({ ...toTldPriceDTO(row), domainCount: usageByTld.get(row.tld) ?? 0 })),
    missingTlds: usage
      .filter((row) => !pricedTlds.has(row.tld))
      .sort((a, b) => b.domainCount - a.domainCount || a.tld.localeCompare(b.tld)),
  };
}

export async function upsertTldPrice(
  db: Database,
  tld: string,
  body: UpsertTldPriceBody,
): Promise<TldPriceDTO> {
  const values = {
    tld,
    renewalCents: body.renewalCents,
    registrationCents: body.registrationCents ?? null,
    transferCents: body.transferCents ?? null,
    currency: body.currency,
    termMonths: body.termMonths,
    notes: body.notes ?? null,
    // Any write through this endpoint is the user's own number, which the
    // prices page distinguishes from the indicative seeded defaults.
    source: 'manual' as const,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(tldPrices)
    .values(values)
    .onConflictDoUpdate({ target: tldPrices.tld, set: values })
    .returning();

  return toTldPriceDTO(row!);
}

export async function deleteTldPrice(db: Database, tld: string): Promise<boolean> {
  const deleted = await db.delete(tldPrices).where(eq(tldPrices.tld, tld)).returning({ id: tldPrices.id });
  return deleted.length > 0;
}

export async function bulkUpsertTldPrices(
  db: Database,
  entries: Array<{ tld: string; renewalCents: number }>,
  currency: string,
  termMonths: number,
): Promise<number> {
  if (entries.length === 0) return 0;

  // Last entry wins on duplicate TLDs — ON CONFLICT cannot touch the same row
  // twice within one statement.
  const deduped = new Map(entries.map((entry) => [entry.tld, entry]));
  const values = [...deduped.values()].map((entry) => ({
    tld: entry.tld,
    renewalCents: entry.renewalCents,
    currency,
    termMonths,
    source: 'manual' as const,
    updatedAt: new Date(),
  }));

  const written = await db
    .insert(tldPrices)
    .values(values)
    .onConflictDoUpdate({
      target: tldPrices.tld,
      set: {
        renewalCents: sql`excluded.renewal_cents`,
        currency: sql`excluded.currency`,
        termMonths: sql`excluded.term_months`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({ id: tldPrices.id });

  return written.length;
}
