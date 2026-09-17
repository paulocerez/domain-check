export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REGISTRAR_AUTH'
  | 'REGISTRAR_UNAVAILABLE'
  | 'SYNC_IN_PROGRESS'
  | 'INTERNAL';

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ApiOk<T, M = undefined> {
  ok: true;
  data: T;
  meta?: M;
}

export interface ApiErr {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T, M = undefined> = ApiOk<T, M> | ApiErr;

export interface AppSettingsDTO {
  baseCurrency: string;
  alertLeadDays: number[];
  alertEmailTo: string | null;
  alertEmailFrom: string | null;
  alertsEnabled: boolean;
  syncCron: string;
  timezone: string;
  updatedAt: string;
}

export interface HealthDTO {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  registrarMode: 'live' | 'mock';
  lastSyncAt: string | null;
  version: string;
}

// --- stats -----------------------------------------------------------------

export interface SummaryStatsDTO {
  baseCurrency: string;
  activeDomains: number;
  missingDomains: number;
  archivedDomains: number;
  expiringWithin30Days: number;
  expiringWithin7Days: number;
  expired: number;
  autoRenewOff: number;
  annualSpendCents: number;
  annualSpendExcludedForCurrency: number;
  next30DaysSpendCents: number;
  pricedDomains: number;
  unpricedDomains: number;
  lastSyncAt: string | null;
}

export interface CostByTldDTO {
  tld: string;
  domainCount: number;
  annualizedCents: number;
  unpricedCount: number;
  currency: string;
}

export interface RenewalCalendarEntryDTO {
  /** "2026-03" */
  month: string;
  domainCount: number;
  totalCents: number;
  /** Renewals in this month whose price is unknown — shown, never summed as 0. */
  unknownCount: number;
}

export interface ExpiryBucketsDTO {
  expired: number;
  within7: number;
  within30: number;
  within90: number;
  later: number;
  unknown: number;
}

/** One tick per domain on the dashboard's 365-day expiry track. */
export interface ExpiryTimelinePointDTO {
  domainId: string;
  name: string;
  daysLeft: number;
  urgency: import('./domain.js').ExpiryUrgency;
  renewalCents: number | null;
  currency: string | null;
}
