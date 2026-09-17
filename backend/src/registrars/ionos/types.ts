/**
 * Wire shapes for the IONOS Domains API, transcribed from the published
 * OpenAPI document (a copy lives at docs/ionos-domains-openapi.yaml).
 *
 * Everything is optional. The spec marks almost nothing as required, and a
 * mapper that assumes otherwise breaks the first time a domain is mid-transfer.
 */

export interface IonosProvisioningStatus {
  type?: 'REGISTRATION_IN_PROGRESS' | 'ACTIVE' | 'EXPIRING';
  registrationType?: 'CREATE' | 'TRANSFER' | 'SEDO_TRANSFER' | 'RESTORE';
  setToExpireOn?: string;
  setToRenewOn?: string;
  isAutorenewSwitchable?: boolean | string;
  revivePossibleUntilDate?: string;
}

export interface IonosComplianceStatus {
  type?:
    | 'EMAIL_VERIFICATION_RUNNING'
    | 'DATA_QUALITY_RUNNING'
    | 'NOMINET_LOCKED'
    | 'EMAIL_VERIFICATION_LOCK';
  registrantEmail?: string;
  reason?: string;
  verificationPossibleUntilDate?: string;
  domainOnHoldAfterTimeout?: boolean;
}

export interface IonosProcessStatus {
  type?:
    | 'UPDATE_IN_PROGRESS'
    | 'TRANSFER_OUT_IN_PROGRESS'
    | 'TRANSFER_IN_IN_PROGRESS'
    | 'DELETE_IN_PROGRESS'
    | 'UPDATE_FAILED';
  tenantTransferType?: 'EXTERNAL' | 'INTER_TENANT' | 'INTRA_TENANT';
  transferStatus?: string;
}

export interface IonosItemStatus {
  provisioningStatus?: IonosProvisioningStatus;
  complianceStatus?: IonosComplianceStatus;
  processStatus?: IonosProcessStatus;
}

/** GET /v1/domainitems — one entry of the `domains` array. */
export interface IonosDomainSmall {
  id?: string;
  name?: string;
  encodedName?: string;
  tld?: string;
  pendingProvisioning?: boolean;
  status?: IonosItemStatus;
}

/** GET /v1/domainitems */
export interface IonosDomainsResponse {
  count?: number;
  domains?: IonosDomainSmall[];
}

/** GET /v1/domainitems/{domainId} */
export interface IonosDomainLarge extends IonosDomainSmall {
  /**
   * The domain's transfer auth code. Secret — the mapper drops it and it is
   * never persisted in `raw_detail` or returned by any endpoint.
   */
  authInfo?: string;
  privacyEnabled?: boolean;
  domainLock?: boolean;
  transferLock?: boolean;
  autoRenew?: boolean;
  expirationDate?: string;
  cancellationDate?: string;
  dnsSecEnabled?: boolean;
  domainType?: 'DOMAIN' | 'X_DOMAIN' | 'GENERIC_DOMAIN';
  cancelOnExpire?: boolean;
}

/** Errors come back as an array, not an object. */
export interface IonosError {
  code?: string;
  parameters?: string[];
  message?: string;
}
