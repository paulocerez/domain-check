/**
 * Expiry alerting.
 *
 * Alerts are deduped by the triple (domain, kind, expirationDate). Including
 * the expiry date in the key is what makes them idempotent per renewal cycle:
 * you get exactly one "30 days left" mail per domain per expiry, and when the
 * domain renews and the date moves a year forward the same kind automatically
 * becomes eligible again — no cleanup job, no TTL.
 */

export type AlertKind =
  | `expiry_${number}`
  | 'expired'
  | 'autorenew_off'
  | 'cancel_on_expire'
  | 'disappeared';

export const DEFAULT_ALERT_LEAD_DAYS = [60, 30, 14, 7, 1] as const;

/** `autorenew_off` only fires once the domain is inside this window. */
export const AUTORENEW_OFF_WINDOW_DAYS = 60;

export interface AlertLogDTO {
  id: string;
  domainId: string;
  domainName: string;
  alertKind: AlertKind;
  /** The expiry this alert was *about* — part of the dedupe key. */
  expirationDate: string;
  sentAt: string;
  resendMessageId: string | null;
  status: 'sent' | 'failed';
  error: string | null;
}

export function expiryAlertKind(leadDays: number): AlertKind {
  return `expiry_${leadDays}`;
}

/**
 * Picks the single tightest matching threshold rather than every threshold the
 * domain has crossed. A domain at 5 days left should produce one "7 days"
 * alert, not four.
 */
export function selectExpiryAlertKind(
  daysLeft: number,
  leadDays: readonly number[],
): AlertKind | null {
  if (daysLeft < 0) return 'expired';
  const ascending = [...leadDays].sort((a, b) => a - b);
  for (const lead of ascending) {
    if (daysLeft <= lead) return expiryAlertKind(lead);
  }
  return null;
}

export function describeAlertKind(kind: AlertKind): string {
  if (kind === 'expired') return 'Expired';
  if (kind === 'autorenew_off') return 'Auto-renew is off';
  if (kind === 'cancel_on_expire') return 'Set to cancel on expiry';
  if (kind === 'disappeared') return 'No longer at registrar';
  const match = /^expiry_(\d+)$/.exec(kind);
  if (match) {
    const days = Number(match[1]);
    return days === 1 ? 'Expires tomorrow' : `Expires within ${days} days`;
  }
  return kind;
}
