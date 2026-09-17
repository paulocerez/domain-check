import {
  resolveEffectivePrice,
  urgencyForDaysLeft,
  type DomainDTO,
  type DomainDetailDTO,
  type DomainQuery,
  type TldPriceDTO,
  type UpdateDomainBody,
} from '@domain-check/shared';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  alertLog,
  domains,
  registrarAccounts,
  syncChanges,
  tldPrices,
  type AppSettingsRow,
  type DomainRow,
  type RegistrarAccountRow,
  type TldPriceRow,
} from '../db/schema.js';
import { daysUntil, startOfDayInZone } from '../lib/dates.js';
import { toTldPriceDTO } from './priceService.js';

export interface DomainContext {
  settings: AppSettingsRow;
  pricesByTld: Map<string, TldPriceDTO>;
  accountsById: Map<string, RegistrarAccountRow>;
}

/**
 * The expiry the whole app sorts and alerts on.
 *
 * `expirationDate` comes from the per-domain detail call and is authoritative;
 * `set_to_expire_on` comes free with the list call. Coalescing means a quick
 * sync still produces a usable dashboard.
 */
export const effectiveExpirySql = sql<Date | null>`coalesce(${domains.expirationDate}, ${domains.setToExpireOn})`;

export async function loadDomainContext(db: Database, settings: AppSettingsRow): Promise<DomainContext> {
  const [prices, accounts] = await Promise.all([
    db.select().from(tldPrices),
    db.select().from(registrarAccounts),
  ]);
  return {
    settings,
    pricesByTld: new Map(prices.map((price) => [price.tld, toTldPriceDTO(price)])),
    accountsById: new Map(accounts.map((account) => [account.id, account])),
  };
}

export function toDomainDTO(row: DomainRow, context: DomainContext): DomainDTO {
  const account = context.accountsById.get(row.registrarAccountId);
  const effectiveExpiry = row.expirationDate ?? row.setToExpireOn;
  // Calendar days in the configured timezone, not UTC: a domain expiring at
  // 01:00 Berlin time must read as "tomorrow" to someone in Berlin.
  const daysLeft = effectiveExpiry ? daysUntil(effectiveExpiry, context.settings.timezone) : null;

  return {
    id: row.id,
    registrarAccountId: row.registrarAccountId,
    registrarKind: (account?.kind ?? 'ionos') as DomainDTO['registrarKind'],
    registrarLabel: account?.label ?? 'Unknown',

    registrarDomainId: row.registrarDomainId,
    name: row.name,
    encodedName: row.encodedName,
    tld: row.tld,

    expirationDate: iso(row.expirationDate),
    setToExpireOn: iso(row.setToExpireOn),
    setToRenewOn: iso(row.setToRenewOn),
    cancellationDate: iso(row.cancellationDate),
    autoRenew: row.autoRenew,
    cancelOnExpire: row.cancelOnExpire,
    domainLock: row.domainLock,
    transferLock: row.transferLock,
    privacyEnabled: row.privacyEnabled,
    dnsSecEnabled: row.dnsSecEnabled,
    domainType: row.domainType as DomainDTO['domainType'],
    registrationType: row.registrationType as DomainDTO['registrationType'],
    provisioningStatus: row.provisioningStatus as DomainDTO['provisioningStatus'],
    complianceStatus: row.complianceStatus as DomainDTO['complianceStatus'],
    processStatus: row.processStatus as DomainDTO['processStatus'],
    transferStatus: row.transferStatus,
    pendingProvisioning: row.pendingProvisioning,
    isAutorenewSwitchable: row.isAutorenewSwitchable,
    revivePossibleUntil: iso(row.revivePossibleUntil),
    detailFetchedAt: iso(row.detailFetchedAt),

    priceOverrideCents: row.priceOverrideCents,
    priceCurrency: row.priceCurrency,
    termMonthsOverride: row.termMonthsOverride,
    notes: row.notes,
    tags: row.tags,
    project: row.project,
    alertsEnabled: row.alertsEnabled,
    alertLeadDays: row.alertLeadDays,
    isFavorite: row.isFavorite,

    syncState: row.syncState as DomainDTO['syncState'],
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    missingSince: iso(row.missingSince),

    effectiveExpiry: iso(effectiveExpiry),
    daysLeft,
    urgency: urgencyForDaysLeft(daysLeft),
    effectivePrice: resolveEffectivePrice(
      row,
      context.pricesByTld.get(row.tld),
      context.settings.baseCurrency,
    ),
  };
}

export function buildDomainFilters(query: DomainQuery, timezone: string): SQL[] {
  const filters: SQL[] = [];

  if (query.state !== 'all') filters.push(eq(domains.syncState, query.state));

  if (query.q) {
    const pattern = `%${query.q.trim()}%`;
    const clause = or(
      ilike(domains.name, pattern),
      ilike(domains.encodedName, pattern),
      ilike(domains.notes, pattern),
      ilike(domains.project, pattern),
    );
    if (clause) filters.push(clause);
  }

  const tlds = toArray(query.tld);
  if (tlds.length > 0) filters.push(inArray(domains.tld, tlds));

  const tags = toArray(query.tag);
  if (tags.length > 0) filters.push(sql`${domains.tags} && ${tags}::text[]`);

  if (query.project) filters.push(eq(domains.project, query.project));

  if (query.expiringWithinDays !== undefined) {
    const horizon = new Date(
      startOfDayInZone(new Date(), timezone).getTime() + (query.expiringWithinDays + 1) * 86_400_000,
    );
    filters.push(sql`${effectiveExpirySql} is not null and ${effectiveExpirySql} <= ${horizon}`);
  }

  if (query.autoRenew) filters.push(eq(domains.autoRenew, query.autoRenew === 'true'));
  if (query.favorite) filters.push(eq(domains.isFavorite, query.favorite === 'true'));

  if (query.priceKnown) {
    // "Known" means an override exists, or the TLD has a price row.
    const known = sql`(${domains.priceOverrideCents} is not null or exists (select 1 from ${tldPrices} tp where tp.tld = ${domains.tld}))`;
    filters.push(query.priceKnown === 'true' ? known : sql`not ${known}`);
  }

  return filters;
}

export function buildDomainOrder(query: DomainQuery): SQL[] {
  const direction = query.dir === 'desc' ? desc : asc;
  switch (query.sort) {
    case 'name':
      return [direction(domains.name)];
    case 'tld':
      return [direction(domains.tld), asc(domains.name)];
    case 'created':
      return [direction(domains.firstSeenAt)];
    case 'cost':
      // Sorting by cost in SQL would have to duplicate the whole override ->
      // TLD -> unknown chain; the API returns every match in one page and the
      // table re-sorts client-side using the shared resolver instead.
      return [asc(domains.name)];
    case 'expiry':
    default:
      // NULLS LAST in both directions: domains with no known expiry are noise
      // at the top of an urgency-ordered list.
      return [
        query.dir === 'desc'
          ? sql`${effectiveExpirySql} desc nulls last`
          : sql`${effectiveExpirySql} asc nulls last`,
        asc(domains.name),
      ];
  }
}

export async function listDomains(
  db: Database,
  query: DomainQuery,
  context: DomainContext,
): Promise<{ rows: DomainDTO[]; total: number }> {
  const filters = buildDomainFilters(query, context.settings.timezone);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(domains)
      .where(where)
      .orderBy(...buildDomainOrder(query))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(domains).where(where),
  ]);

  return { rows: rows.map((row) => toDomainDTO(row, context)), total: totals[0]?.count ?? 0 };
}

export async function getDomainDetail(
  db: Database,
  id: string,
  context: DomainContext,
): Promise<DomainDetailDTO | null> {
  const row = await db.query.domains.findFirst({ where: eq(domains.id, id) });
  if (!row) return null;

  const [changes, alerts] = await Promise.all([
    db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.domainId, id))
      .orderBy(desc(syncChanges.createdAt))
      .limit(25),
    db.select().from(alertLog).where(eq(alertLog.domainId, id)).orderBy(desc(alertLog.sentAt)).limit(25),
  ]);

  const base = toDomainDTO(row, context);
  return {
    ...base,
    // Flagged when the two expiry sources disagree by more than a day. Usually
    // means the domain is mid-cancellation — worth surfacing, not noise.
    expiryMismatch:
      row.expirationDate !== null &&
      row.setToExpireOn !== null &&
      Math.abs(row.expirationDate.getTime() - row.setToExpireOn.getTime()) > 86_400_000,
    recentChanges: changes.map((change) => ({
      id: String(change.id),
      syncRunId: change.syncRunId,
      domainId: change.domainId,
      domainName: row.name,
      changeType: change.changeType as 'created' | 'updated' | 'missing' | 'reappeared',
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      createdAt: change.createdAt.toISOString(),
    })),
    recentAlerts: alerts.map((alert) => ({
      id: String(alert.id),
      domainId: alert.domainId,
      domainName: row.name,
      alertKind: alert.alertKind as DomainDetailDTO['recentAlerts'][number]['alertKind'],
      expirationDate: alert.expirationDate,
      sentAt: alert.sentAt.toISOString(),
      resendMessageId: alert.resendMessageId,
      status: alert.status as 'sent' | 'failed',
      error: alert.error,
    })),
    rawDetail: row.rawDetail,
  };
}

/**
 * Applies a user edit.
 *
 * The patch has already been validated against a `.strict()` schema containing
 * only user-owned fields, so a request naming a registrar-owned column is a 400
 * rather than a write that the next sync would mysteriously undo.
 */
export async function updateDomain(
  db: Database,
  id: string,
  patch: UpdateDomainBody,
): Promise<DomainRow | null> {
  const [updated] = await db
    .update(domains)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .returning();
  return updated ?? null;
}

export async function setSyncState(
  db: Database,
  id: string,
  state: 'active' | 'missing' | 'archived',
): Promise<DomainRow | null> {
  const [updated] = await db
    .update(domains)
    .set({ syncState: state, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteDomain(db: Database, id: string): Promise<boolean> {
  const deleted = await db
    .delete(domains)
    // Guard rail: only archived rows are deletable, so an accidental DELETE on
    // a live domain cannot discard the user's cost data.
    .where(and(eq(domains.id, id), eq(domains.syncState, 'archived')))
    .returning({ id: domains.id });
  return deleted.length > 0;
}

export { isNotNull, isNull, gte, lte };

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
