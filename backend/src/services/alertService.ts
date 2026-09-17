import {
  AUTORENEW_OFF_WINDOW_DAYS,
  describeAlertKind,
  formatMoney,
  selectExpiryAlertKind,
  type AlertKind,
  type DomainDTO,
} from '@domain-check/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { alertLog, domains } from '../db/schema.js';
import { env } from '../env.js';
import { dateKeyInZone } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { toDomainDTO, type DomainContext } from './domainService.js';
import { createEmailTransport, type EmailTransport } from './emailTransport.js';
import { renderDigest } from './alertTemplate.js';

export interface AlertCandidate {
  domain: DomainDTO;
  kind: AlertKind;
  /** The expiry this alert is about — part of the dedupe key. */
  expirationDateKey: string;
}

export interface AlertRunResult {
  evaluated: number;
  candidates: number;
  claimed: number;
  sent: boolean;
  transport: 'resend' | 'console';
  messageId: string | null;
  skippedReason?: string;
}

/**
 * Works out which alerts a domain is currently eligible for.
 *
 * Only the *tightest* expiry threshold is emitted: a domain five days from
 * expiry produces one "7 days" alert, not one for each of 60/30/14/7 it has
 * crossed. Condition alerts (auto-renew off, cancel-on-expire) are independent
 * of that and can accompany it.
 */
export function candidatesForDomain(
  domain: DomainDTO,
  defaultLeadDays: number[],
  timezone: string,
): AlertCandidate[] {
  if (!domain.alertsEnabled) return [];
  // A 'missing' domain's expiry cannot be trusted — the UI flags it instead.
  if (domain.syncState !== 'active') return [];
  if (!domain.effectiveExpiry || domain.daysLeft === null) return [];

  const expirationDateKey = dateKeyInZone(new Date(domain.effectiveExpiry), timezone);
  const leadDays = domain.alertLeadDays ?? defaultLeadDays;
  const candidates: AlertCandidate[] = [];

  const expiryKind = selectExpiryAlertKind(domain.daysLeft, leadDays);
  if (expiryKind) candidates.push({ domain, kind: expiryKind, expirationDateKey });

  if (domain.cancelOnExpire) {
    candidates.push({ domain, kind: 'cancel_on_expire', expirationDateKey });
  } else if (
    domain.autoRenew === false &&
    domain.daysLeft >= 0 &&
    domain.daysLeft <= AUTORENEW_OFF_WINDOW_DAYS
  ) {
    candidates.push({ domain, kind: 'autorenew_off', expirationDateKey });
  }

  return candidates;
}

/**
 * Evaluates the portfolio and sends at most one digest.
 *
 * Claim-then-send: each `(domain, kind, expiry)` is inserted with
 * `ON CONFLICT DO NOTHING RETURNING id` *before* the mail goes out, and only
 * claimed rows are included. A crash between claim and send costs one missed
 * notification; the reverse order would cost a duplicate storm every time the
 * job ran. On send failure the claims are released so the next run retries.
 */
export async function runAlerts(
  db: Database,
  context: DomainContext,
  options: { transport?: EmailTransport; overrideTo?: string } = {},
): Promise<AlertRunResult> {
  const transport = options.transport ?? createEmailTransport();
  const settings = context.settings;

  const rows = await db.select().from(domains).where(eq(domains.syncState, 'active'));
  const dtos = rows.map((row) => toDomainDTO(row, context));

  const candidates = dtos.flatMap((domain) =>
    candidatesForDomain(domain, settings.alertLeadDays, settings.timezone),
  );

  const base: AlertRunResult = {
    evaluated: dtos.length,
    candidates: candidates.length,
    claimed: 0,
    sent: false,
    transport: transport.name,
    messageId: null,
  };

  if (!settings.alertsEnabled) return { ...base, skippedReason: 'Alerts are disabled in settings' };
  if (candidates.length === 0) return base;

  const to = options.overrideTo ?? settings.alertEmailTo ?? env.ALERT_EMAIL_TO;
  const from = settings.alertEmailFrom ?? env.ALERT_EMAIL_FROM;
  if (!to || !from) {
    return { ...base, skippedReason: 'No alert sender/recipient configured — set them in Settings' };
  }

  const claimed = await claimAlerts(db, candidates);
  if (claimed.length === 0) return base;

  const message = renderDigest(claimed, { to, from, baseCurrency: settings.baseCurrency });

  try {
    const { messageId } = await transport.send(message);
    await db
      .update(alertLog)
      .set({ resendMessageId: messageId, status: 'sent' })
      .where(inArray(alertLog.id, claimed.map((entry) => entry.logId)));
    logger.info({ claimed: claimed.length, transport: transport.name, messageId }, 'alert digest sent');
    return { ...base, claimed: claimed.length, sent: true, messageId };
  } catch (err) {
    // Release the claims so the next run retries rather than the alert being
    // permanently swallowed by a transient mail outage.
    await db.delete(alertLog).where(inArray(alertLog.id, claimed.map((entry) => entry.logId)));
    logger.error({ err, claimed: claimed.length }, 'alert digest failed — claims released for retry');
    throw err;
  }
}

export interface ClaimedAlert extends AlertCandidate {
  logId: number;
}

async function claimAlerts(db: Database, candidates: AlertCandidate[]): Promise<ClaimedAlert[]> {
  const claimed: ClaimedAlert[] = [];

  for (const candidate of candidates) {
    const [row] = await db
      .insert(alertLog)
      .values({
        domainId: candidate.domain.id,
        alertKind: candidate.kind,
        expirationDate: candidate.expirationDateKey,
        status: 'sent',
      })
      .onConflictDoNothing({
        target: [alertLog.domainId, alertLog.alertKind, alertLog.expirationDate],
      })
      .returning({ id: alertLog.id });

    // No row back means this exact alert already went out for this expiry.
    if (row) claimed.push({ ...candidate, logId: row.id });
  }

  return claimed;
}

/** Sample digest for the Settings page. Writes nothing to alert_log. */
export async function sendTestAlert(
  db: Database,
  context: DomainContext,
  to: string | undefined,
): Promise<{ messageId: string | null; transport: 'resend' | 'console'; to: string }> {
  const transport = createEmailTransport();
  const recipient = to ?? context.settings.alertEmailTo ?? env.ALERT_EMAIL_TO;
  const from = context.settings.alertEmailFrom ?? env.ALERT_EMAIL_FROM;
  if (!recipient || !from) throw new Error('Configure an alert sender and recipient first');

  const rows = await db
    .select()
    .from(domains)
    .where(eq(domains.syncState, 'active'))
    .orderBy(sql`coalesce(${domains.expirationDate}, ${domains.setToExpireOn}) asc nulls last`)
    .limit(5);

  const sample: ClaimedAlert[] = rows.map((row, index) => {
    const domain = toDomainDTO(row, context);
    return {
      domain,
      kind: (domain.daysLeft !== null && domain.daysLeft < 0 ? 'expired' : 'expiry_30') as AlertKind,
      expirationDateKey: domain.effectiveExpiry ?? 'unknown',
      logId: -1 - index,
    };
  });

  const message = renderDigest(sample, {
    to: recipient,
    from,
    baseCurrency: context.settings.baseCurrency,
    isTest: true,
  });
  const { messageId } = await transport.send(message);
  return { messageId, transport: transport.name, to: recipient };
}

/** Raises the `disappeared` alert for domains a clean sync stopped seeing. */
export async function claimDisappearedAlerts(db: Database, domainIds: string[]): Promise<number> {
  if (domainIds.length === 0) return 0;
  const rows = await db.select().from(domains).where(inArray(domains.id, domainIds));
  let claimedCount = 0;

  for (const row of rows) {
    const expiry = row.expirationDate ?? row.setToExpireOn;
    const [claimed] = await db
      .insert(alertLog)
      .values({
        domainId: row.id,
        alertKind: 'disappeared',
        expirationDate: expiry ? expiry.toISOString().slice(0, 10) : '1970-01-01',
      })
      .onConflictDoNothing({
        target: [alertLog.domainId, alertLog.alertKind, alertLog.expirationDate],
      })
      .returning({ id: alertLog.id });
    if (claimed) claimedCount++;
  }

  return claimedCount;
}

export function summarizeAlert(candidate: AlertCandidate, baseCurrency: string): string {
  const price = candidate.domain.effectivePrice;
  const cost =
    price.renewalCents !== null ? formatMoney(price.renewalCents, price.currency) : 'no price set';
  return `${candidate.domain.name} — ${describeAlertKind(candidate.kind)} (${cost}, ${baseCurrency} portfolio)`;
}

export { and };
