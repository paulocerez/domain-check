import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Money is stored as an integer count of minor units plus an ISO-4217 code.
 * `numeric` is avoided deliberately: Drizzle hands it back as a string, which
 * would force every consumer — including the client-side total recomputation —
 * into string math.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const registrarAccounts = pgTable(
  'registrar_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'ionos' | 'godaddy' | 'mock' */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    /**
     * The NAME of the environment variable holding the API key, never the key
     * itself. Secrets stay entirely outside anything the HTTP surface can
     * address — which matters a lot given this app has no authentication.
     */
    credentialRef: text('credential_ref').notNull(),
    /**
     * The registrar's account discriminator: IONOS `X-Tenant-Id`, GoDaddy
     * `X-Shopper-Id`. Optional for both, and not a secret either way.
     */
    tenantId: text('tenant_id'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncStatus: text('last_sync_status'),
    ...timestamps,
  },
  (table) => [uniqueIndex('registrar_accounts_kind_label_key').on(table.kind, table.label)],
);

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrarAccountId: uuid('registrar_account_id')
      .notNull()
      .references(() => registrarAccounts.id, { onDelete: 'cascade' }),

    // ---- identity -------------------------------------------------------
    /** The registrar's own id (IONOS domainitem id). Primary reconcile key. */
    registrarDomainId: text('registrar_domain_id').notNull(),
    /** Always written lowercased. Unicode form for IDNs. */
    name: text('name').notNull(),
    /** Punycode; only present for IDNs. */
    encodedName: text('encoded_name'),
    /** Lowercased, no leading dot. Joins to tld_prices.tld. */
    tld: text('tld').notNull(),

    // ---- REGISTRAR-OWNED: overwritten on every sync ---------------------
    expirationDate: timestamp('expiration_date', { withTimezone: true }),
    /** From the list endpoint's status block; cheaper but less authoritative. */
    setToExpireOn: timestamp('set_to_expire_on', { withTimezone: true }),
    setToRenewOn: timestamp('set_to_renew_on', { withTimezone: true }),
    cancellationDate: timestamp('cancellation_date', { withTimezone: true }),
    autoRenew: boolean('auto_renew'),
    cancelOnExpire: boolean('cancel_on_expire'),
    domainLock: boolean('domain_lock'),
    transferLock: boolean('transfer_lock'),
    privacyEnabled: boolean('privacy_enabled'),
    dnsSecEnabled: boolean('dns_sec_enabled'),
    domainType: text('domain_type'),
    registrationType: text('registration_type'),
    provisioningStatus: text('provisioning_status'),
    complianceStatus: text('compliance_status'),
    processStatus: text('process_status'),
    transferStatus: text('transfer_status'),
    pendingProvisioning: boolean('pending_provisioning').notNull().default(false),
    isAutorenewSwitchable: boolean('is_autorenew_switchable'),
    revivePossibleUntil: timestamp('revive_possible_until', { withTimezone: true }),
    /** Last full detail payload — debugging, plus fields we don't model yet. */
    rawDetail: jsonb('raw_detail'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),

    // ---- USER-OWNED: sync must NEVER write these -------------------------
    priceOverrideCents: integer('price_override_cents'),
    priceCurrency: char('price_currency', { length: 3 }),
    termMonthsOverride: integer('term_months_override'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    project: text('project'),
    alertsEnabled: boolean('alerts_enabled').notNull().default(true),
    /** null = inherit app_settings.alert_lead_days */
    alertLeadDays: integer('alert_lead_days').array(),
    isFavorite: boolean('is_favorite').notNull().default(false),

    // ---- sync bookkeeping ------------------------------------------------
    /** 'active' | 'missing' | 'archived'. Rows are never hard-deleted by sync. */
    syncState: text('sync_state').notNull().default('active'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenSyncRunId: uuid('last_seen_sync_run_id'),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('domains_account_registrar_id_key').on(table.registrarAccountId, table.registrarDomainId),
    uniqueIndex('domains_account_name_key').on(table.registrarAccountId, table.name),
    index('domains_expiration_date_idx').on(table.expirationDate),
    index('domains_state_expiry_idx').on(table.syncState, table.expirationDate),
    index('domains_tld_idx').on(table.tld),
    index('domains_account_idx').on(table.registrarAccountId),
    check(
      'domains_price_currency_required',
      sql`${table.priceOverrideCents} IS NULL OR ${table.priceCurrency} IS NOT NULL`,
    ),
  ],
);

/**
 * One current price per TLD. Deliberately not effective-dated: this tool
 * forecasts forward spend, it does not do retrospective accounting, and an
 * `effective_from` column would turn every cost query into a lateral subquery
 * for no present benefit.
 */
export const tldPrices = pgTable(
  'tld_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tld: text('tld').notNull(),
    renewalCents: integer('renewal_cents').notNull(),
    registrationCents: integer('registration_cents'),
    transferCents: integer('transfer_cents'),
    currency: char('currency', { length: 3 }).notNull(),
    /** Term the renewal price covers. Almost always 12. */
    termMonths: integer('term_months').notNull().default(12),
    source: text('source').notNull().default('manual'),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [uniqueIndex('tld_prices_tld_key').on(table.tld)],
);

/** Single-row app configuration. */
export const appSettings = pgTable(
  'app_settings',
  {
    id: integer('id').primaryKey().default(1),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('EUR'),
    alertLeadDays: integer('alert_lead_days')
      .array()
      .notNull()
      .default(sql`'{60,30,14,7,1}'::integer[]`),
    alertEmailTo: text('alert_email_to'),
    alertEmailFrom: text('alert_email_from'),
    alertsEnabled: boolean('alerts_enabled').notNull().default(true),
    syncCron: text('sync_cron').notNull().default('0 6 * * *'),
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('app_settings_singleton', sql`${table.id} = 1`)],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrarAccountId: uuid('registrar_account_id')
      .notNull()
      .references(() => registrarAccounts.id, { onDelete: 'cascade' }),
    /** 'full' | 'quick' | 'single' */
    mode: text('mode').notNull(),
    /** 'cron' | 'manual' | 'startup' */
    trigger: text('trigger').notNull(),
    /** 'running' | 'success' | 'partial' | 'failed' */
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    domainsSeen: integer('domains_seen').notNull().default(0),
    domainsCreated: integer('domains_created').notNull().default(0),
    domainsUpdated: integer('domains_updated').notNull().default(0),
    domainsUnchanged: integer('domains_unchanged').notNull().default(0),
    domainsMissing: integer('domains_missing').notNull().default(0),
    detailCalls: integer('detail_calls').notNull().default(0),
    apiErrors: integer('api_errors').notNull().default(0),
    errorMessage: text('error_message'),
    errorDetail: jsonb('error_detail'),
  },
  (table) => [index('sync_runs_account_started_idx').on(table.registrarAccountId, table.startedAt)],
);

/** Audit of what actually changed. Only TRACKED_CHANGE_FIELDS produce rows. */
export const syncChanges = pgTable(
  'sync_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    syncRunId: uuid('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    /** 'created' | 'updated' | 'missing' | 'reappeared' */
    changeType: text('change_type').notNull(),
    field: text('field'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sync_changes_domain_created_idx').on(table.domainId, table.createdAt),
    index('sync_changes_run_idx').on(table.syncRunId),
  ],
);

/**
 * Dedupe ledger for alerts.
 *
 * The unique constraint below is the whole mechanism. Keying on the expiry the
 * alert was *about* makes each notification idempotent per renewal cycle: the
 * job can run hourly and the process can crash mid-send, and you still get
 * exactly one "30 days left" mail per domain per expiry. When the domain
 * renews, the date moves and the same kind becomes eligible again on its own.
 */
export const alertLog = pgTable(
  'alert_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    alertKind: text('alert_kind').notNull(),
    /** Date-only on purpose: the dedupe key must not shift with clock time. */
    expirationDate: date('expiration_date').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    resendMessageId: text('resend_message_id'),
    status: text('status').notNull().default('sent'),
    error: text('error'),
  },
  (table) => [
    uniqueIndex('alert_log_dedupe_key').on(table.domainId, table.alertKind, table.expirationDate),
    index('alert_log_sent_at_idx').on(table.sentAt),
  ],
);

export type RegistrarAccountRow = typeof registrarAccounts.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
export type NewDomainRow = typeof domains.$inferInsert;
export type TldPriceRow = typeof tldPrices.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type SyncChangeRow = typeof syncChanges.$inferSelect;
export type AlertLogRow = typeof alertLog.$inferSelect;

/**
 * The explicit allow-list of columns a sync is permitted to write.
 *
 * Sync builds its UPDATE object by picking these keys rather than by spreading
 * the mapped registrar payload. That distinction is the single most important
 * invariant in this codebase — a spread would silently clobber the user's price
 * overrides and notes the first time the mapper gained a field — and it has a
 * dedicated test in sync.test.ts.
 */
export const REGISTRAR_OWNED_FIELDS = [
  'name',
  'encodedName',
  'tld',
  'expirationDate',
  'setToExpireOn',
  'setToRenewOn',
  'cancellationDate',
  'autoRenew',
  'cancelOnExpire',
  'domainLock',
  'transferLock',
  'privacyEnabled',
  'dnsSecEnabled',
  'domainType',
  'registrationType',
  'provisioningStatus',
  'complianceStatus',
  'processStatus',
  'transferStatus',
  'pendingProvisioning',
  'isAutorenewSwitchable',
  'revivePossibleUntil',
  'rawDetail',
  'detailFetchedAt',
] as const satisfies readonly (keyof NewDomainRow)[];

export type RegistrarOwnedField = (typeof REGISTRAR_OWNED_FIELDS)[number];

/** Columns the user owns. Listed so a test can assert the two sets are disjoint. */
export const USER_OWNED_FIELDS = [
  'priceOverrideCents',
  'priceCurrency',
  'termMonthsOverride',
  'notes',
  'tags',
  'project',
  'alertsEnabled',
  'alertLeadDays',
  'isFavorite',
] as const satisfies readonly (keyof NewDomainRow)[];
