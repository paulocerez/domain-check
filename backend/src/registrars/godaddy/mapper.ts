import { domainToUnicode } from 'node:url';
import type { DomainAvailability, RegistrarDomainDetail, RegistrarDomainSummary } from '../types.js';
import { tldFromName } from '../types.js';
import { parseDate } from '../ionos/mapper.js';
import type {
  GodaddyAvailabilityError,
  GodaddyAvailableDomain,
  GodaddyDomainDetail,
  GodaddyDomainSummary,
} from './types.js';

/**
 * GoDaddy quotes money in micro-units: 1_000_000 == one unit of the currency.
 * Everything in this app is minor units, so the conversion is /10_000.
 */
const MICRO_UNITS_PER_MINOR_UNIT = 10_000;

/**
 * Statuses that mean "not finished arriving yet".
 *
 * `PENDING_DNS_ACTIVE`, `AWAITING_PAYMENT`, `AWAITING_VERIFICATION` and friends
 * all describe a domain the account has claimed but does not fully hold, which
 * is exactly what IONOS's `pendingProvisioning` flag marks.
 */
function isPending(status: string | undefined): boolean {
  if (!status) return false;
  return status.startsWith('PENDING') || status.startsWith('AWAITING');
}

/**
 * Splits GoDaddy's single `domain` field into our unicode/punycode pair.
 *
 * GoDaddy returns the ASCII (punycode) form for IDNs and nothing else, whereas
 * IONOS returns both. `domainToUnicode` recovers the display form so the two
 * adapters agree on what `name` means: what the user would recognise.
 */
function normalizeName(domain: string): { name: string; encodedName: string | null } {
  const ascii = domain.trim().toLowerCase();
  if (!ascii.includes('xn--')) return { name: ascii, encodedName: null };
  const unicode = domainToUnicode(ascii);
  // domainToUnicode returns '' for input it cannot parse; fall back to the ASCII.
  return { name: unicode || ascii, encodedName: ascii };
}

export function mapSummary(item: GodaddyDomainSummary): RegistrarDomainSummary {
  const { name, encodedName } = normalizeName(item.domain ?? '');
  const status = typeof item.status === 'string' ? item.status : null;

  return {
    // The *name*, not `item.domainId`. GET /v1/domains/{domain} is keyed by
    // name, and `getDomainDetail` receives only this id — using the numeric id
    // would need a name lookup that a freshly-constructed client does not have,
    // which is precisely the case when refreshing one domain outside a sync.
    // `domainId` survives in `raw`.
    registrarDomainId: encodedName ?? name,
    name,
    encodedName,
    // GoDaddy reports no TLD field, so this is always derived. Note the caveat
    // on `tldFromName`: "example.co.uk" yields "uk".
    tld: tldFromName(encodedName ?? name),
    pendingProvisioning: isPending(status ?? undefined),
    provisioningStatus: status,
    // The list call already carries the authoritative expiry, unlike IONOS.
    expirationDate: parseDate(item.expires),
    setToRenewOn: parseDate(item.renewDeadline),
    cancellationDate: parseDate(item.deletedAt),
    autoRenew: item.renewAuto ?? null,
    domainLock: item.locked ?? null,
    transferLock: item.transferProtected ?? null,
    privacyEnabled: item.privacy ?? null,
    // GoDaddy models "don't renew me" as renewAuto=false rather than as a
    // separate flag, so there is nothing distinct to report here.
    cancelOnExpire: null,
    // Not exposed by the Domains API at all.
    setToExpireOn: null,
    dnsSecEnabled: null,
    domainType: null,
    registrationType: null,
    complianceStatus: null,
    processStatus: null,
    transferStatus: null,
    isAutorenewSwitchable: null,
    revivePossibleUntil: null,
  };
}

export function mapDetail(item: GodaddyDomainDetail): RegistrarDomainDetail {
  // authCode is the transfer auth code and the contact blocks are registrant
  // PII. Both are stripped before anything persists `raw` — this app stores it
  // in `raw_detail` and has no authentication in front of the detail endpoint.
  const {
    authCode: _authCode,
    contactAdmin: _contactAdmin,
    contactBilling: _contactBilling,
    contactRegistrant: _contactRegistrant,
    contactTech: _contactTech,
    ...safeRaw
  } = item;

  return { ...mapSummary(item), raw: safeRaw };
}

function toMinorUnits(price: number | undefined): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  return Math.round(price / MICRO_UNITS_PER_MINOR_UNIT);
}

export function mapAvailability(item: GodaddyAvailableDomain): DomainAvailability {
  const priceCents = toMinorUnits(item.price);
  return {
    name: (item.domain ?? '').trim().toLowerCase(),
    available: item.available ?? false,
    // Absent `definitive` means GoDaddy did not claim the answer was cached;
    // treating that as definitive matches how their own UI reads the field.
    definitive: item.definitive ?? true,
    priceCents,
    currency: priceCents === null ? null : (item.currency ?? null),
    periodYears: typeof item.period === 'number' ? item.period : null,
    error: null,
  };
}

/** A name the registry could not answer for — unsupported TLD, malformed name. */
export function mapAvailabilityError(item: GodaddyAvailabilityError): DomainAvailability {
  return {
    name: (item.domain ?? '').trim().toLowerCase(),
    available: false,
    definitive: false,
    priceCents: null,
    currency: null,
    periodYears: null,
    error: item.message ?? item.code ?? 'The registrar could not check this name',
  };
}
