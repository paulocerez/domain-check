import type { IonosDomainLarge, IonosDomainSmall } from '../ionos/types.js';

/**
 * Fixture portfolio, emitted as verbatim IONOS wire JSON and fed through the
 * real mapper — so the mapper is exercised against the shape the API actually
 * sends, not an idealised one.
 *
 * Expiries are declared as offsets from "now" and materialised at read time.
 * Absolute dates rot silently: six months on, your "expiring in 30 days" case
 * has quietly become an "expired 150 days ago" case and the test still passes.
 */

interface FixtureSpec {
  id: string;
  name: string;
  tld: string;
  encodedName?: string;
  /** Days from now until expiry. Negative = already expired. */
  expiresInDays?: number | null;
  autoRenew?: boolean;
  cancelOnExpire?: boolean;
  cancelledInDays?: number;
  domainLock?: boolean;
  transferLock?: boolean;
  privacyEnabled?: boolean;
  dnsSecEnabled?: boolean;
  domainType?: 'DOMAIN' | 'X_DOMAIN' | 'GENERIC_DOMAIN';
  pendingProvisioning?: boolean;
  provisioningStatus?: 'REGISTRATION_IN_PROGRESS' | 'ACTIVE' | 'EXPIRING';
  registrationType?: 'CREATE' | 'TRANSFER' | 'SEDO_TRANSFER' | 'RESTORE';
  complianceStatus?: 'EMAIL_VERIFICATION_RUNNING' | 'DATA_QUALITY_RUNNING' | 'NOMINET_LOCKED';
  processStatus?:
    | 'UPDATE_IN_PROGRESS'
    | 'TRANSFER_OUT_IN_PROGRESS'
    | 'TRANSFER_IN_IN_PROGRESS'
    | 'DELETE_IN_PROGRESS'
    | 'UPDATE_FAILED';
  transferStatus?: string;
  /** Simulates a detail endpoint that 500s for this one domain. */
  detailFails?: boolean;
  /** Omits the `status` block entirely, as IONOS does without includeDomainStatus. */
  noStatus?: boolean;
}

export const FIXTURE_SPECS: FixtureSpec[] = [
  // --- the ordinary bulk of a portfolio ---
  { id: 'a1b2c3d4-0001-4000-8000-000000000001', name: 'vetpal.de', tld: 'de', expiresInDays: 284, autoRenew: true },
  { id: 'a1b2c3d4-0002-4000-8000-000000000002', name: 'vetpal.com', tld: 'com', expiresInDays: 201, autoRenew: true },
  { id: 'a1b2c3d4-0003-4000-8000-000000000003', name: 'vetpal.eu', tld: 'eu', expiresInDays: 158, autoRenew: true },
  { id: 'a1b2c3d4-0004-4000-8000-000000000004', name: 'praxisassistent.de', tld: 'de', expiresInDays: 342, autoRenew: true },
  { id: 'a1b2c3d4-0005-4000-8000-000000000005', name: 'tierarztpraxis.app', tld: 'app', expiresInDays: 97, autoRenew: true },
  { id: 'a1b2c3d4-0006-4000-8000-000000000006', name: 'petrecords.io', tld: 'io', expiresInDays: 133, autoRenew: true },
  { id: 'a1b2c3d4-0007-4000-8000-000000000007', name: 'clinicflow.dev', tld: 'dev', expiresInDays: 246, autoRenew: true },
  { id: 'a1b2c3d4-0008-4000-8000-000000000008', name: 'petportal.net', tld: 'net', expiresInDays: 312, autoRenew: true },
  { id: 'a1b2c3d4-0009-4000-8000-000000000009', name: 'vetbooking.org', tld: 'org', expiresInDays: 175, autoRenew: true },
  { id: 'a1b2c3d4-0010-4000-8000-000000000010', name: 'vetpal.at', tld: 'at', expiresInDays: 220, autoRenew: true },
  { id: 'a1b2c3d4-0011-4000-8000-000000000011', name: 'vetpal.ch', tld: 'ch', expiresInDays: 265, autoRenew: true },
  { id: 'a1b2c3d4-0012-4000-8000-000000000012', name: 'vetpal.nl', tld: 'nl', expiresInDays: 301, autoRenew: true },

  // --- urgency ladder: one per colour band the dashboard renders ---
  { id: 'a1b2c3d4-0013-4000-8000-000000000013', name: 'expiring-tomorrow.de', tld: 'de', expiresInDays: 1, autoRenew: false },
  { id: 'a1b2c3d4-0014-4000-8000-000000000014', name: 'expiring-this-week.com', tld: 'com', expiresInDays: 5, autoRenew: true },
  { id: 'a1b2c3d4-0015-4000-8000-000000000015', name: 'expiring-in-two-weeks.io', tld: 'io', expiresInDays: 13, autoRenew: true },
  { id: 'a1b2c3d4-0016-4000-8000-000000000016', name: 'expiring-in-a-month.net', tld: 'net', expiresInDays: 29, autoRenew: true },
  { id: 'a1b2c3d4-0017-4000-8000-000000000017', name: 'expiring-in-two-months.org', tld: 'org', expiresInDays: 58, autoRenew: false },

  // --- risk cases the UI must call out loudly ---
  {
    id: 'a1b2c3d4-0018-4000-8000-000000000018',
    name: 'already-expired.biz',
    tld: 'biz',
    expiresInDays: -12,
    autoRenew: false,
    provisioningStatus: 'EXPIRING',
  },
  {
    id: 'a1b2c3d4-0019-4000-8000-000000000019',
    name: 'set-to-cancel.shop',
    tld: 'shop',
    expiresInDays: 44,
    autoRenew: false,
    cancelOnExpire: true,
    cancelledInDays: 44,
  },
  {
    id: 'a1b2c3d4-0020-4000-8000-000000000020',
    name: 'autorenew-off.online',
    tld: 'online',
    expiresInDays: 51,
    autoRenew: false,
  },

  // --- in-flight registry processes ---
  {
    id: 'a1b2c3d4-0021-4000-8000-000000000021',
    name: 'transferring-out.cloud',
    tld: 'cloud',
    expiresInDays: 190,
    autoRenew: true,
    processStatus: 'TRANSFER_OUT_IN_PROGRESS',
    transferStatus: 'REGISTRY_PENDING',
  },
  {
    id: 'a1b2c3d4-0022-4000-8000-000000000022',
    name: 'being-registered.me',
    tld: 'me',
    expiresInDays: null,
    pendingProvisioning: true,
    provisioningStatus: 'REGISTRATION_IN_PROGRESS',
    registrationType: 'CREATE',
  },
  {
    id: 'a1b2c3d4-0023-4000-8000-000000000023',
    name: 'needs-email-verification.info',
    tld: 'info',
    expiresInDays: 120,
    autoRenew: true,
    complianceStatus: 'EMAIL_VERIFICATION_RUNNING',
  },

  // --- shapes that break naive parsers ---
  {
    // IDN: unicode `name` plus punycode `encodedName`.
    id: 'a1b2c3d4-0024-4000-8000-000000000024',
    name: 'tierärzte-köln.de',
    encodedName: 'xn--tierrzte-kln-9hbc.de',
    tld: 'de',
    expiresInDays: 88,
    autoRenew: true,
  },
  {
    // Multi-label TLD — the domains.tld -> tld_prices.tld join's hard case.
    id: 'a1b2c3d4-0025-4000-8000-000000000025',
    name: 'vetpal.co.uk',
    tld: 'co.uk',
    expiresInDays: 233,
    autoRenew: true,
  },
  {
    // No status block at all, as returned without includeDomainStatus.
    id: 'a1b2c3d4-0026-4000-8000-000000000026',
    name: 'no-status-block.com',
    tld: 'com',
    expiresInDays: 150,
    autoRenew: true,
    noStatus: true,
  },
  {
    // Detail endpoint fails for this one: the run must degrade to 'partial'
    // and keep every other domain's update rather than aborting.
    id: 'a1b2c3d4-0027-4000-8000-000000000027',
    name: 'detail-fetch-fails.dev',
    tld: 'dev',
    expiresInDays: 77,
    autoRenew: true,
    detailFails: true,
  },
  {
    // TLD with no seeded price — drives the "unpriced" path end to end.
    id: 'a1b2c3d4-0028-4000-8000-000000000028',
    name: 'unpriced-tld.bayern',
    tld: 'bayern',
    expiresInDays: 199,
    autoRenew: true,
  },
];

const DAY_MS = 86_400_000;

/**
 * Offsets are measured from midnight UTC, not from the exact call time.
 *
 * Anchoring to `now` directly would shift every date by a few milliseconds
 * between calls, so a second identical sync would report all 28 domains as
 * "updated" and fill the activity feed with phantom expiry changes — which
 * makes idempotency impossible to verify. Quantising to the day keeps repeated
 * syncs genuinely identical while still letting the fixtures age day to day.
 */
function isoOffsetDays(days: number, now: number): string {
  const midnightUtc = Math.floor(now / DAY_MS) * DAY_MS;
  // Noon rather than midnight so a timezone shift can't move the calendar day.
  return new Date(midnightUtc + days * DAY_MS + DAY_MS / 2).toISOString();
}

function buildStatus(spec: FixtureSpec, now: number) {
  if (spec.noStatus) return undefined;

  const provisioningType =
    spec.provisioningStatus ?? (spec.pendingProvisioning ? 'REGISTRATION_IN_PROGRESS' : 'ACTIVE');

  const provisioningStatus: Record<string, unknown> = { type: provisioningType };
  if (spec.expiresInDays !== null && spec.expiresInDays !== undefined) {
    provisioningStatus.setToExpireOn = isoOffsetDays(spec.expiresInDays, now);
    if (spec.autoRenew !== false && !spec.cancelOnExpire) {
      provisioningStatus.setToRenewOn = isoOffsetDays(spec.expiresInDays - 30, now);
    }
  }
  if (spec.registrationType) provisioningStatus.registrationType = spec.registrationType;
  if (provisioningType === 'ACTIVE') {
    // Deliberately the string "true": the published spec example does this and
    // the mapper has to cope.
    provisioningStatus.isAutorenewSwitchable = 'true';
  }
  if (provisioningType === 'EXPIRING' && spec.expiresInDays !== null && spec.expiresInDays !== undefined) {
    provisioningStatus.revivePossibleUntilDate = isoOffsetDays(spec.expiresInDays + 30, now);
  }

  return {
    provisioningStatus,
    ...(spec.complianceStatus
      ? {
          complianceStatus: {
            type: spec.complianceStatus,
            ...(spec.complianceStatus === 'EMAIL_VERIFICATION_RUNNING'
              ? { registrantEmail: 'owner@example.com', domainOnHoldAfterTimeout: true }
              : {}),
          },
        }
      : {}),
    ...(spec.processStatus
      ? {
          processStatus: {
            type: spec.processStatus,
            ...(spec.transferStatus ? { transferStatus: spec.transferStatus } : {}),
          },
        }
      : {}),
  };
}

export function buildSmall(spec: FixtureSpec, now: number, includeStatus: boolean): IonosDomainSmall {
  return {
    id: spec.id,
    name: spec.name,
    ...(spec.encodedName ? { encodedName: spec.encodedName } : {}),
    tld: spec.tld,
    ...(spec.pendingProvisioning ? { pendingProvisioning: true } : {}),
    ...(includeStatus ? { status: buildStatus(spec, now) } : {}),
  };
}

export function buildLarge(spec: FixtureSpec, now: number): IonosDomainLarge {
  return {
    ...buildSmall(spec, now, true),
    pendingProvisioning: spec.pendingProvisioning ?? false,
    // Present so tests can prove the mapper strips it before anything persists.
    authInfo: 'MOCK-AUTH-CODE-DO-NOT-STORE',
    privacyEnabled: spec.privacyEnabled ?? false,
    domainLock: spec.domainLock ?? false,
    transferLock: spec.transferLock ?? true,
    autoRenew: spec.autoRenew ?? true,
    ...(spec.expiresInDays !== null && spec.expiresInDays !== undefined
      ? { expirationDate: isoOffsetDays(spec.expiresInDays, now) }
      : {}),
    ...(spec.cancelledInDays !== undefined
      ? { cancellationDate: isoOffsetDays(spec.cancelledInDays, now) }
      : {}),
    dnsSecEnabled: spec.dnsSecEnabled ?? false,
    domainType: spec.domainType ?? 'DOMAIN',
    cancelOnExpire: spec.cancelOnExpire ?? false,
  };
}

export function findSpec(id: string): FixtureSpec | undefined {
  return FIXTURE_SPECS.find((spec) => spec.id === id);
}
