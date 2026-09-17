import type { RegistrarDomainDetail, RegistrarDomainSummary } from '../types.js';
import { tldFromName } from '../types.js';
import type { IonosDomainLarge, IonosDomainSmall, IonosItemStatus } from './types.js';

/** Tolerates undefined, empty strings and unparseable values. */
export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The spec's own example has `"isAutorenewSwitchable": "true"` — a string where
 * the schema says boolean. Coerce rather than trust.
 */
export function parseBoolish(value: boolean | string | undefined | null): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function mapStatus(status: IonosItemStatus | undefined) {
  const provisioning = status?.provisioningStatus;
  return {
    setToExpireOn: parseDate(provisioning?.setToExpireOn),
    setToRenewOn: parseDate(provisioning?.setToRenewOn),
    provisioningStatus: provisioning?.type ?? null,
    registrationType: provisioning?.registrationType ?? null,
    isAutorenewSwitchable: parseBoolish(provisioning?.isAutorenewSwitchable),
    revivePossibleUntil: parseDate(provisioning?.revivePossibleUntilDate),
    complianceStatus: status?.complianceStatus?.type ?? null,
    processStatus: status?.processStatus?.type ?? null,
    transferStatus: status?.processStatus?.transferStatus ?? null,
  };
}

/**
 * IONOS reports `name` in unicode and `encodedName` in punycode for IDNs. We
 * key on the lowercased unicode name, matching what the user sees.
 */
function normalizeName(item: IonosDomainSmall): string {
  return (item.name ?? item.encodedName ?? '').trim().toLowerCase();
}

function normalizeTld(item: IonosDomainSmall, name: string): string {
  const reported = item.tld?.trim().toLowerCase().replace(/^\./, '');
  // The spec's own Domain example has name "…köln.de" alongside tld "com", so a
  // reported TLD that the name does not end with is not trustworthy.
  if (reported && (name.endsWith(`.${reported}`) || name === reported)) return reported;
  return tldFromName(name);
}

export function mapSummary(item: IonosDomainSmall): RegistrarDomainSummary {
  const name = normalizeName(item);
  return {
    registrarDomainId: item.id ?? '',
    name,
    encodedName: item.encodedName?.toLowerCase() ?? null,
    tld: normalizeTld(item, name),
    pendingProvisioning: item.pendingProvisioning ?? false,
    ...mapStatus(item.status),
  };
}

export function mapDetail(item: IonosDomainLarge): RegistrarDomainDetail {
  // authInfo is the transfer auth code. Strip it before anything persists `raw`.
  const { authInfo: _authInfo, ...safeRaw } = item;
  return {
    ...mapSummary(item),
    expirationDate: parseDate(item.expirationDate),
    cancellationDate: parseDate(item.cancellationDate),
    autoRenew: item.autoRenew ?? null,
    cancelOnExpire: item.cancelOnExpire ?? null,
    domainLock: item.domainLock ?? null,
    transferLock: item.transferLock ?? null,
    privacyEnabled: item.privacyEnabled ?? null,
    dnsSecEnabled: item.dnsSecEnabled ?? null,
    domainType: item.domainType ?? null,
    raw: safeRaw,
  };
}
