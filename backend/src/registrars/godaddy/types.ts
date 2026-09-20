/**
 * Wire shapes for the GoDaddy Domains API (api.godaddy.com / api.ote-godaddy.com).
 *
 * Optional throughout, for the same reason as the IONOS types: the published
 * schema marks fields required that real responses omit — `expires` is absent
 * on a domain that never completed registration, and the contact blocks vanish
 * for a privacy-protected name.
 */

import type { GodaddyDomainStatus } from '@domain-check/shared';

/** One entry of GET /v1/domains. */
export interface GodaddyDomainSummary {
  /** GoDaddy's numeric id. Kept in `raw`; not used as our reconcile key — see mapper. */
  domainId?: number;
  /** The name itself, punycode for IDNs. This is our `registrarDomainId`. */
  domain?: string;
  status?: GodaddyDomainStatus | string;
  /** ISO-8601. The authoritative expiry — GoDaddy reports it on the list call. */
  expires?: string;
  /** Last moment a renewal is still accepted. Maps to our `setToRenewOn`. */
  renewDeadline?: string;
  renewAuto?: boolean;
  renewable?: boolean;
  /** Registrar lock. */
  locked?: boolean;
  transferProtected?: boolean;
  expirationProtected?: boolean;
  holdRegistrar?: boolean;
  privacy?: boolean;
  exposeWhois?: boolean;
  nameServers?: string[];
  createdAt?: string;
  /** Set once the domain leaves the account. Maps to our `cancellationDate`. */
  deletedAt?: string;
  transferAwayEligibleAt?: string;
}

/** A registrant/admin/tech/billing contact. Dropped before anything persists. */
export interface GodaddyContact {
  nameFirst?: string;
  nameLast?: string;
  email?: string;
  phone?: string;
  organization?: string;
  addressMailing?: Record<string, unknown>;
  [key: string]: unknown;
}

/** GET /v1/domains/{domain}. */
export interface GodaddyDomainDetail extends GodaddyDomainSummary {
  /**
   * The transfer authorisation code. Secret — the mapper drops it and it is
   * never persisted in `raw_detail` or returned by any endpoint.
   */
  authCode?: string;
  /** Registrant PII. Dropped for the same reason: this app has no use for it
   *  and no authentication in front of the raw payload it would land in. */
  contactAdmin?: GodaddyContact;
  contactBilling?: GodaddyContact;
  contactRegistrant?: GodaddyContact;
  contactTech?: GodaddyContact;
  subaccountId?: string;
  verifications?: Record<string, unknown>;
}

/** One entry of the bulk availability response's `domains` array. */
export interface GodaddyAvailableDomain {
  domain?: string;
  available?: boolean;
  /** False when the answer came from GoDaddy's cache rather than the registry. */
  definitive?: boolean;
  /** Micro-units: 1_000_000 == one unit of `currency`. */
  price?: number;
  currency?: string;
  /** Registration term in years that `price` covers. */
  period?: number;
}

/** One entry of the bulk availability response's `errors` array. */
export interface GodaddyAvailabilityError {
  domain?: string;
  code?: string;
  message?: string;
  status?: number;
}

/**
 * POST /v1/domains/available.
 *
 * Answers 200 when every name resolved and **203** when some did not, with the
 * failures in `errors`. A client that treats 203 as an error throws away a
 * perfectly good page of results.
 */
export interface GodaddyAvailabilityBulkResponse {
  domains?: GodaddyAvailableDomain[];
  errors?: GodaddyAvailabilityError[];
}

/** GoDaddy errors are a single object, unlike the IONOS array. */
export interface GodaddyError {
  code?: string;
  message?: string;
  fields?: Array<{ path?: string; code?: string; message?: string }>;
  /** Present on 429 alongside (or instead of) the Retry-After header. */
  retryAfterSec?: number;
}
