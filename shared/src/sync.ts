import type { RegistrarKind } from './domain.js';

export type SyncMode = 'full' | 'quick' | 'single';
export type SyncTrigger = 'cron' | 'manual' | 'startup';
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed';

export type SyncChangeType = 'created' | 'updated' | 'missing' | 'reappeared';

/**
 * Only these registrar fields produce audit rows. Everything else changes too
 * often (or too meaninglessly) to be worth showing in an activity feed.
 */
export const TRACKED_CHANGE_FIELDS = [
  'expirationDate',
  'autoRenew',
  'cancelOnExpire',
  'provisioningStatus',
  'processStatus',
  'complianceStatus',
  'domainLock',
  'transferLock',
] as const;

export type TrackedChangeField = (typeof TRACKED_CHANGE_FIELDS)[number];

export interface SyncChangeDTO {
  id: string;
  syncRunId: string;
  domainId: string;
  domainName: string;
  changeType: SyncChangeType;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface SyncRunDTO {
  id: string;
  registrarAccountId: string;
  registrarLabel: string;
  mode: SyncMode;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  domainsSeen: number;
  domainsCreated: number;
  domainsUpdated: number;
  domainsUnchanged: number;
  domainsMissing: number;
  detailCalls: number;
  apiErrors: number;
  errorMessage: string | null;
}

export interface SyncStatusDTO {
  running: boolean;
  currentRun: SyncRunDTO | null;
  lastRun: SyncRunDTO | null;
}

export interface RegistrarAccountDTO {
  id: string;
  kind: RegistrarKind;
  label: string;
  /** The *name* of the env var holding the key, e.g. "IONOS_API_KEY". */
  credentialRef: string;
  /** Whether that env var is actually set. The key itself is never sent. */
  credentialConfigured: boolean;
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
  domainCount: number;
  capabilities: RegistrarCapabilities;
}

export interface RegistrarCapabilities {
  /**
   * Whether the registrar reports renewal pricing for domains you already own.
   * False for every adapter so far, which is why prices are user-maintained;
   * the UI reads this to explain that. Note this is a different number from the
   * *registration* price an availability check returns — see `availability`.
   */
  pricing: boolean;
  detailFetch: boolean;
  nameservers: boolean;
  /**
   * Whether the registrar can answer "is this name free, and what would it
   * cost to register?". False for IONOS; the availability page is gated on at
   * least one configured account reporting true.
   */
  availability: boolean;
}
