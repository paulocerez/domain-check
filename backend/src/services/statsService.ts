import {
  sumAnnualized,
  type CostByTldDTO,
  type ExpiryBucketsDTO,
  type ExpiryTimelinePointDTO,
  type RenewalCalendarEntryDTO,
  type SummaryStatsDTO,
} from '@domain-check/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { domains, registrarAccounts } from '../db/schema.js';
import { monthKeyInZone, upcomingMonthKeys } from '../lib/dates.js';
import { toDomainDTO, type DomainContext } from './domainService.js';

/**
 * Stats are computed in application code over the active portfolio rather than
 * in SQL.
 *
 * The price resolution chain (override -> TLD table -> unknown, with term
 * annualisation and currency exclusion) already exists as a pure function
 * shared with the client. Reimplementing it as a CASE expression would mean two
 * definitions of "what this costs" that can disagree. Portfolios here are in the
 * tens-to-hundreds, so loading them is cheap.
 */
async function activeDomains(db: Database, context: DomainContext) {
  const rows = await db
    .select()
    .from(domains)
    .where(sql`${domains.syncState} = 'active'`);
  return rows.map((row) => toDomainDTO(row, context));
}

export async function getSummary(db: Database, context: DomainContext): Promise<SummaryStatsDTO> {
  const active = await activeDomains(db, context);
  const baseCurrency = context.settings.baseCurrency;

  const [stateCounts] = await db
    .select({
      missing: sql<number>`count(*) filter (where ${domains.syncState} = 'missing')::int`,
      archived: sql<number>`count(*) filter (where ${domains.syncState} = 'archived')::int`,
    })
    .from(domains);

  const [lastSync] = await db
    .select({ lastSyncAt: sql<Date | null>`max(${registrarAccounts.lastSyncAt})` })
    .from(registrarAccounts);

  const annual = sumAnnualized(
    active.map((domain) => domain.effectivePrice),
    baseCurrency,
  );

  const next30DaysSpendCents = active.reduce((total, domain) => {
    if (domain.daysLeft === null || domain.daysLeft < 0 || domain.daysLeft > 30) return total;
    // A domain set to cancel on expiry will not be billed.
    if (domain.cancelOnExpire) return total;
    const price = domain.effectivePrice;
    if (price.renewalCents === null || price.currency !== baseCurrency) return total;
    return total + price.renewalCents;
  }, 0);

  return {
    baseCurrency,
    activeDomains: active.length,
    missingDomains: stateCounts?.missing ?? 0,
    archivedDomains: stateCounts?.archived ?? 0,
    expiringWithin30Days: active.filter((d) => d.daysLeft !== null && d.daysLeft >= 0 && d.daysLeft <= 30).length,
    expiringWithin7Days: active.filter((d) => d.daysLeft !== null && d.daysLeft >= 0 && d.daysLeft <= 7).length,
    expired: active.filter((d) => d.daysLeft !== null && d.daysLeft < 0).length,
    // The single highest-signal risk metric the registrar API gives us.
    autoRenewOff: active.filter((d) => d.autoRenew === false && (d.daysLeft === null || d.daysLeft >= 0)).length,
    annualSpendCents: annual.totalCents,
    annualSpendExcludedForCurrency: annual.excludedForCurrency,
    next30DaysSpendCents,
    pricedDomains: active.filter((d) => d.effectivePrice.source !== 'unknown').length,
    unpricedDomains: active.filter((d) => d.effectivePrice.source === 'unknown').length,
    lastSyncAt: lastSync?.lastSyncAt ? new Date(lastSync.lastSyncAt).toISOString() : null,
  };
}

export async function getCostByTld(db: Database, context: DomainContext): Promise<CostByTldDTO[]> {
  const active = await activeDomains(db, context);
  const baseCurrency = context.settings.baseCurrency;
  const byTld = new Map<string, CostByTldDTO>();

  for (const domain of active) {
    const entry = byTld.get(domain.tld) ?? {
      tld: domain.tld,
      domainCount: 0,
      annualizedCents: 0,
      unpricedCount: 0,
      currency: baseCurrency,
    };
    entry.domainCount++;
    const price = domain.effectivePrice;
    if (price.annualizedCents === null) entry.unpricedCount++;
    else if (price.currency === baseCurrency) entry.annualizedCents += price.annualizedCents;
    byTld.set(domain.tld, entry);
  }

  return [...byTld.values()].sort(
    (a, b) => b.annualizedCents - a.annualizedCents || a.tld.localeCompare(b.tld),
  );
}

export async function getRenewalCalendar(
  db: Database,
  context: DomainContext,
  months = 12,
): Promise<RenewalCalendarEntryDTO[]> {
  const active = await activeDomains(db, context);
  const baseCurrency = context.settings.baseCurrency;
  const timezone = context.settings.timezone;

  // Pre-seed every month so the chart has a continuous axis; a month with no
  // renewals must render as an empty slot, not vanish and compress the scale.
  const buckets = new Map<string, RenewalCalendarEntryDTO>(
    upcomingMonthKeys(months, timezone).map((month) => [
      month,
      { month, domainCount: 0, totalCents: 0, unknownCount: 0 },
    ]),
  );

  for (const domain of active) {
    if (!domain.effectiveExpiry || domain.cancelOnExpire) continue;
    const month = monthKeyInZone(new Date(domain.effectiveExpiry), timezone);
    const bucket = buckets.get(month);
    if (!bucket) continue;

    bucket.domainCount++;
    const price = domain.effectivePrice;
    if (price.renewalCents === null || price.currency !== baseCurrency) {
      // Counted and shown separately — never summed as zero, which would make
      // a month of unpriced renewals look free.
      bucket.unknownCount++;
    } else {
      bucket.totalCents += price.renewalCents;
    }
  }

  return [...buckets.values()];
}

export async function getExpiryBuckets(db: Database, context: DomainContext): Promise<ExpiryBucketsDTO> {
  const active = await activeDomains(db, context);
  const buckets: ExpiryBucketsDTO = { expired: 0, within7: 0, within30: 0, within90: 0, later: 0, unknown: 0 };

  for (const domain of active) {
    const days = domain.daysLeft;
    if (days === null) buckets.unknown++;
    else if (days < 0) buckets.expired++;
    else if (days <= 7) buckets.within7++;
    else if (days <= 30) buckets.within30++;
    else if (days <= 90) buckets.within90++;
    else buckets.later++;
  }

  return buckets;
}

export async function getExpiryTimeline(
  db: Database,
  context: DomainContext,
  horizonDays = 365,
): Promise<ExpiryTimelinePointDTO[]> {
  const active = await activeDomains(db, context);
  return active
    .filter((domain) => domain.daysLeft !== null && domain.daysLeft <= horizonDays)
    .map((domain) => ({
      domainId: domain.id,
      name: domain.name,
      daysLeft: domain.daysLeft!,
      urgency: domain.urgency,
      renewalCents: domain.effectivePrice.renewalCents,
      currency: domain.effectivePrice.currency,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
