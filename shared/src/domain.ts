/**
 * The domain model, split along the line that matters most in this app:
 * fields the registrar owns (overwritten on every sync) and fields the user
 * owns (cost, notes, alert preferences) which sync must never touch.
 *
 * No adapter reports renewal pricing for domains you already own — IONOS has no
 * price field anywhere, and GoDaddy prices registrations rather than renewals —
 * so everything financial lives on our side permanently. See `pricing.ts`.
 */

export type RegistrarKind = 'ionos' | 'godaddy' | 'mock';

export type SyncState = 'active' | 'missing' | 'archived';

/** IONOS `status.provisioningStatus.type` */
export type IonosProvisioningStatus = 'REGISTRATION_IN_PROGRESS' | 'ACTIVE' | 'EXPIRING';

/** GoDaddy `DomainSummary.status`. A different vocabulary for the same column. */
export type GodaddyDomainStatus =
  | 'ACTIVE'
  | 'AWAITING_DOCUMENT_UPLOAD'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_VERIFICATION'
  | 'CANCELLED'
  | 'CANCELLED_HELD'
  | 'CANCELLED_REDEEMABLE'
  | 'CONFISCATED'
  | 'DISABLED'
  | 'EXPIRED'
  | 'EXPIRED_REASSIGNED'
  | 'FAILED'
  | 'HELD'
  | 'PENDING'
  | 'PENDING_DNS_ACTIVE'
  | 'RESERVED'
  | 'TRANSFERRED_OUT'
  | 'UNKNOWN'
  | 'UNLOCKED';

/**
 * The union of every registrar's status vocabulary.
 *
 * `domains.provisioning_status` is a plain `text` column, so this is a
 * type-level concern only — but keeping the per-registrar unions named means a
 * `switch` in the UI still narrows, and it documents which value came from where.
 */
export type ProvisioningStatus = IonosProvisioningStatus | GodaddyDomainStatus;

/** IONOS `status.provisioningStatus.registrationType` */
export type RegistrationType = 'CREATE' | 'TRANSFER' | 'SEDO_TRANSFER' | 'RESTORE';

/** IONOS `status.complianceStatus.type` */
export type ComplianceStatus =
  | 'EMAIL_VERIFICATION_RUNNING'
  | 'DATA_QUALITY_RUNNING'
  | 'NOMINET_LOCKED'
  | 'EMAIL_VERIFICATION_LOCK';

/** IONOS `status.processStatus.type` */
export type ProcessStatus =
  | 'UPDATE_IN_PROGRESS'
  | 'TRANSFER_OUT_IN_PROGRESS'
  | 'TRANSFER_IN_IN_PROGRESS'
  | 'DELETE_IN_PROGRESS'
  | 'UPDATE_FAILED';

export type DomainType = 'DOMAIN' | 'X_DOMAIN' | 'GENERIC_DOMAIN';

/** Urgency bucket derived from days remaining; drives every colour in the UI. */
export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'ok' | 'unknown';

export const URGENCY_THRESHOLDS = {
  /** <= this many days remaining is `critical` (red). */
  critical: 7,
  /** <= this many days remaining is `warning` (amber). */
  warning: 30,
} as const;

export function urgencyForDaysLeft(daysLeft: number | null): ExpiryUrgency {
  if (daysLeft === null) return 'unknown';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= URGENCY_THRESHOLDS.critical) return 'critical';
  if (daysLeft <= URGENCY_THRESHOLDS.warning) return 'warning';
  return 'ok';
}

/** All dates cross the wire as ISO-8601 strings. */
export interface DomainDTO {
  id: string;
  registrarAccountId: string;
  registrarKind: RegistrarKind;
  registrarLabel: string;

  // --- identity ---
  registrarDomainId: string;
  /** Always lowercased. Unicode form for IDNs. */
  name: string;
  /** Punycode; present only for IDNs. */
  encodedName: string | null;
  /** Lowercased, no leading dot. Joins to `TldPriceDTO.tld`. */
  tld: string;

  // --- registrar-owned (overwritten every sync) ---
  expirationDate: string | null;
  setToExpireOn: string | null;
  setToRenewOn: string | null;
  cancellationDate: string | null;
  autoRenew: boolean | null;
  cancelOnExpire: boolean | null;
  domainLock: boolean | null;
  transferLock: boolean | null;
  privacyEnabled: boolean | null;
  dnsSecEnabled: boolean | null;
  domainType: DomainType | null;
  registrationType: RegistrationType | null;
  provisioningStatus: ProvisioningStatus | null;
  complianceStatus: ComplianceStatus | null;
  processStatus: ProcessStatus | null;
  transferStatus: string | null;
  pendingProvisioning: boolean;
  isAutorenewSwitchable: boolean | null;
  revivePossibleUntil: string | null;
  detailFetchedAt: string | null;

  // --- user-owned (sync never writes these) ---
  priceOverrideCents: number | null;
  priceCurrency: string | null;
  termMonthsOverride: number | null;
  notes: string | null;
  tags: string[];
  project: string | null;
  alertsEnabled: boolean;
  alertLeadDays: number[] | null;
  isFavorite: boolean;

  // --- bookkeeping ---
  syncState: SyncState;
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;

  // --- derived server-side ---
  /** COALESCE(expirationDate, setToExpireOn) — what the whole app sorts on. */
  effectiveExpiry: string | null;
  /** Calendar days from today (in the configured timezone) to effectiveExpiry. */
  daysLeft: number | null;
  urgency: ExpiryUrgency;
  effectivePrice: import('./pricing.js').EffectivePrice;
}

export interface DomainDetailDTO extends DomainDTO {
  /**
   * True when `expirationDate` and `setToExpireOn` disagree by more than a day.
   * Real signal rather than noise: it usually means the domain is mid-cancellation.
   */
  expiryMismatch: boolean;
  recentChanges: import('./sync.js').SyncChangeDTO[];
  recentAlerts: import('./alerts.js').AlertLogDTO[];
  rawDetail: unknown;
}
