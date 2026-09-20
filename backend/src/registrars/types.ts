import type { RegistrarCapabilities, RegistrarKind } from '@domain-check/shared';

/**
 * The registrar abstraction.
 *
 * Deliberately read-only: no renew, transfer or update methods. This app's job
 * is to observe a portfolio and cost it. Adding mutations later is purely
 * additive; designing for them now would mean designing against an API surface
 * we have not validated.
 */

/**
 * What the cheap list endpoint can tell us about a domain.
 *
 * How much that is varies sharply by registrar, which is why so much of this is
 * optional. IONOS's list yields identity plus a status block and nothing else,
 * so everything below `setToExpireOn` is `undefined` until the detail fetch.
 * A registrar whose list endpoint is richer fills them in phase one.
 *
 * `undefined` and `null` are *not* interchangeable here. `undefined` means "this
 * registrar did not tell us"; sync leaves the stored value alone. `null` means
 * "the registrar told us there is no value"; sync writes the null. See
 * `toRegistrarOwnedValues` in syncService.
 */
export interface RegistrarDomainSummary {
  registrarDomainId: string;
  /** Lowercased. Unicode form for IDNs. */
  name: string;
  encodedName?: string | null;
  /** Lowercased, no leading dot. */
  tld: string;
  pendingProvisioning: boolean;
  /**
   * IONOS `status.provisioningStatus.setToExpireOn`. Present only when the
   * caller asked for status. Less authoritative than `expirationDate` but
   * available for the whole portfolio in a handful of requests.
   */
  setToExpireOn?: Date | null;
  setToRenewOn?: Date | null;
  provisioningStatus?: string | null;
  registrationType?: string | null;
  complianceStatus?: string | null;
  processStatus?: string | null;
  transferStatus?: string | null;
  isAutorenewSwitchable?: boolean | null;
  revivePossibleUntil?: Date | null;

  // --- present only where the list endpoint is rich enough to answer ---
  /** The authoritative expiry, as opposed to `setToExpireOn`. */
  expirationDate?: Date | null;
  cancellationDate?: Date | null;
  autoRenew?: boolean | null;
  cancelOnExpire?: boolean | null;
  domainLock?: boolean | null;
  transferLock?: boolean | null;
  privacyEnabled?: boolean | null;
  dnsSecEnabled?: boolean | null;
  domainType?: string | null;
}

/**
 * Everything above, guaranteed complete for this registrar, plus the payload.
 *
 * The distinction from `RegistrarDomainSummary` is no longer about which fields
 * exist — it is that a detail is authoritative: sync writes every field it
 * carries, nulls included.
 */
export interface RegistrarDomainDetail extends RegistrarDomainSummary {
  /** Raw payload, minus anything secret. Stored for debugging and future fields. */
  raw: unknown;
}

export type CredentialCheck = { ok: true } | { ok: false; reason: string };

export interface Registrar {
  readonly kind: RegistrarKind;
  readonly capabilities: RegistrarCapabilities;
  /** Cheap probe that isolates auth failures from sync failures. */
  verifyCredentials(): Promise<CredentialCheck>;
  /** Paginates internally and returns the complete portfolio. */
  listDomains(opts?: { signal?: AbortSignal }): Promise<RegistrarDomainSummary[]>;
  getDomainDetail(registrarDomainId: string): Promise<RegistrarDomainDetail>;
}

/**
 * Normalised registrar failure.
 *
 * `kind` is what the rest of the app branches on; the HTTP status and the
 * registrar's own code are kept for diagnostics only.
 */
export type RegistrarErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'config';

export class RegistrarError extends Error {
  readonly kind: RegistrarErrorKind;
  readonly httpStatus: number | null;
  readonly registrarCode: string | null;
  readonly raw: unknown;

  constructor(
    kind: RegistrarErrorKind,
    message: string,
    options: { httpStatus?: number | null; registrarCode?: string | null; raw?: unknown } = {},
  ) {
    super(message);
    this.name = 'RegistrarError';
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.registrarCode = options.registrarCode ?? null;
    this.raw = options.raw;
  }

  /** Auth and config problems will never succeed on retry; everything else might. */
  get isRetryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network';
  }
}

/**
 * Splits a hostname into label + TLD.
 *
 * IONOS supplies `tld` directly and that value is preferred; this is the
 * fallback. It intentionally does not consult a public-suffix list — for
 * "example.co.uk" it returns "uk", not "co.uk". Which of the two IONOS actually
 * reports is the one thing fixtures cannot settle, and it decides whether the
 * domains.tld -> tld_prices.tld join lands. See docs in README.
 */
export function tldFromName(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1]! : name.toLowerCase();
}
