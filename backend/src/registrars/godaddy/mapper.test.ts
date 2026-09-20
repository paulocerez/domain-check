import { describe, expect, it } from 'vitest';
import { normalizeGodaddyError } from './errors.js';
import { mapAvailability, mapAvailabilityError, mapDetail, mapSummary } from './mapper.js';
import type { GodaddyDomainDetail, GodaddyDomainSummary } from './types.js';

const listItem: GodaddyDomainSummary = {
  domainId: 123456789,
  domain: 'vetpal.com',
  status: 'ACTIVE',
  expires: '2027-04-02T07:17:45.000Z',
  renewDeadline: '2027-05-02T07:17:45.000Z',
  renewAuto: true,
  locked: true,
  transferProtected: false,
  privacy: true,
  nameServers: ['ns1.example.com'],
  createdAt: '2020-04-02T07:17:45.000Z',
};

describe('mapSummary', () => {
  it('maps a list entry, including the expiry the list call already carries', () => {
    expect(mapSummary(listItem)).toMatchObject({
      registrarDomainId: 'vetpal.com',
      name: 'vetpal.com',
      encodedName: null,
      tld: 'com',
      provisioningStatus: 'ACTIVE',
      pendingProvisioning: false,
      expirationDate: new Date('2027-04-02T07:17:45.000Z'),
      setToRenewOn: new Date('2027-05-02T07:17:45.000Z'),
      autoRenew: true,
      domainLock: true,
      transferLock: false,
      privacyEnabled: true,
    });
  });

  it('keys on the name, not the numeric domainId', () => {
    // GET /v1/domains/{domain} is keyed by name, and getDomainDetail only ever
    // receives registrarDomainId — so the numeric id would be unusable there.
    expect(mapSummary(listItem).registrarDomainId).toBe('vetpal.com');
  });

  it('lowercases the name', () => {
    expect(mapSummary({ domain: 'MiXeD.COM' }).name).toBe('mixed.com');
  });

  it('recovers the unicode form of an IDN and keeps the punycode', () => {
    const summary = mapSummary({ domain: 'xn--example-zone-kln-zwb.de' });
    expect(summary.name).toBe('example-zone-köln.de');
    expect(summary.encodedName).toBe('xn--example-zone-kln-zwb.de');
    // The registrar id stays the ASCII form, because that is what the URL needs.
    expect(summary.registrarDomainId).toBe('xn--example-zone-kln-zwb.de');
  });

  it('derives the TLD, since GoDaddy reports none', () => {
    expect(mapSummary({ domain: 'petrecords.io' }).tld).toBe('io');
  });

  it.each(['PENDING_DNS_ACTIVE', 'AWAITING_PAYMENT', 'AWAITING_VERIFICATION'])(
    'treats %s as pending provisioning',
    (status) => {
      expect(mapSummary({ domain: 'x.com', status }).pendingProvisioning).toBe(true);
    },
  );

  it.each(['ACTIVE', 'EXPIRED', 'CANCELLED', 'TRANSFERRED_OUT'])(
    'does not treat %s as pending provisioning',
    (status) => {
      expect(mapSummary({ domain: 'x.com', status }).pendingProvisioning).toBe(false);
    },
  );

  it('survives an entry with nothing but a name', () => {
    const summary = mapSummary({ domain: 'bare.com' });
    expect(summary.expirationDate).toBeNull();
    expect(summary.autoRenew).toBeNull();
    expect(summary.provisioningStatus).toBeNull();
  });

  it('maps deletedAt to the cancellation date', () => {
    const summary = mapSummary({ domain: 'gone.com', deletedAt: '2026-01-05T00:00:00.000Z' });
    expect(summary.cancellationDate).toEqual(new Date('2026-01-05T00:00:00.000Z'));
  });

  it('leaves fields the API does not report undecided rather than guessing', () => {
    const summary = mapSummary(listItem);
    expect(summary.dnsSecEnabled).toBeNull();
    expect(summary.setToExpireOn).toBeNull();
    expect(summary.complianceStatus).toBeNull();
  });
});

describe('mapDetail', () => {
  const detail: GodaddyDomainDetail = {
    ...listItem,
    authCode: 'SUPER-SECRET-TRANSFER-CODE',
    contactRegistrant: { email: 'registrant@example.com', nameFirst: 'Ada' },
    contactAdmin: { email: 'admin@example.com' },
    contactBilling: { email: 'billing@example.com' },
    contactTech: { email: 'tech@example.com' },
    subaccountId: 'sub-1',
  };

  it('never persists the transfer auth code', () => {
    const raw = mapDetail(detail).raw as Record<string, unknown>;
    expect(raw).not.toHaveProperty('authCode');
    expect(JSON.stringify(raw)).not.toContain('SUPER-SECRET-TRANSFER-CODE');
  });

  it('never persists registrant PII', () => {
    const raw = mapDetail(detail).raw as Record<string, unknown>;
    for (const key of ['contactRegistrant', 'contactAdmin', 'contactBilling', 'contactTech']) {
      expect(raw).not.toHaveProperty(key);
    }
    expect(JSON.stringify(raw)).not.toContain('@example.com');
  });

  it('keeps the rest of the payload, including the numeric id', () => {
    const raw = mapDetail(detail).raw as Record<string, unknown>;
    expect(raw.domainId).toBe(123456789);
    expect(raw.subaccountId).toBe('sub-1');
  });

  it('carries the summary fields through unchanged', () => {
    expect(mapDetail(detail)).toMatchObject({
      registrarDomainId: 'vetpal.com',
      expirationDate: new Date('2027-04-02T07:17:45.000Z'),
      autoRenew: true,
    });
  });
});

describe('mapAvailability', () => {
  it('converts micro-units to minor units', () => {
    // 11_990_000 micro-units == 11.99 == 1199 cents.
    const result = mapAvailability({
      domain: 'free.com',
      available: true,
      definitive: true,
      price: 11_990_000,
      currency: 'EUR',
      period: 1,
    });
    expect(result).toEqual({
      name: 'free.com',
      available: true,
      definitive: true,
      priceCents: 1199,
      currency: 'EUR',
      periodYears: 1,
      error: null,
    });
  });

  it('reports no currency when there is no price', () => {
    const result = mapAvailability({ domain: 'taken.com', available: false, currency: 'EUR' });
    expect(result.priceCents).toBeNull();
    expect(result.currency).toBeNull();
  });

  it('treats an absent definitive flag as definitive', () => {
    expect(mapAvailability({ domain: 'x.com', available: true }).definitive).toBe(true);
  });

  it('turns a per-name error into an unusable row rather than an available one', () => {
    const result = mapAvailabilityError({
      domain: 'weird.zzz',
      code: 'UNSUPPORTED_TLD',
      message: 'TLD is not supported',
    });
    expect(result.available).toBe(false);
    expect(result.definitive).toBe(false);
    expect(result.error).toBe('TLD is not supported');
  });
});

/** Builds the shape axios throws, without needing a server. */
function axiosError(status: number | null, data?: unknown, headers?: Record<string, string>) {
  return {
    isAxiosError: true,
    message: 'Request failed',
    code: status === null ? 'ECONNRESET' : undefined,
    response:
      status === null
        ? undefined
        : { status, statusText: 'Error', data, headers: headers ?? {} },
  };
}

describe('normalizeGodaddyError', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [422, 'bad_request'],
    [400, 'bad_request'],
    [429, 'rate_limit'],
    [500, 'server'],
    [503, 'server'],
  ])('maps %i to %s', (status, kind) => {
    const err = normalizeGodaddyError(axiosError(status, { code: 'X', message: 'nope' }), 'ctx');
    expect(err.kind).toBe(kind);
    expect(err.httpStatus).toBe(status);
    expect(err.registrarCode).toBe('X');
    expect(err.message).toContain('ctx');
    expect(err.message).toContain('nope');
  });

  it('reads Retry-After from the header', () => {
    const err = normalizeGodaddyError(axiosError(429, {}, { 'retry-after': '30' }), 'ctx');
    expect((err.raw as { retryAfter?: string }).retryAfter).toBe('30');
  });

  it('falls back to the body retryAfterSec when the header is missing', () => {
    const err = normalizeGodaddyError(axiosError(429, { code: 'TOO_MANY_REQUESTS', retryAfterSec: 12 }), 'ctx');
    // Stringified so withRetry's single Retry-After parser handles both sources.
    expect((err.raw as { retryAfter?: string }).retryAfter).toBe('12');
  });

  it('never carries the request config, which holds the sso-key header', () => {
    const err = normalizeGodaddyError(axiosError(401, { message: 'denied' }), 'ctx');
    expect(JSON.stringify(err.raw)).not.toContain('sso-key');
    expect(err.raw).not.toHaveProperty('config');
  });

  it('does not throw on an HTML body from a proxy', () => {
    const err = normalizeGodaddyError(axiosError(502, '<html><body>Bad Gateway</body></html>'), 'ctx');
    expect(err.kind).toBe('server');
    expect(err.registrarCode).toBeNull();
  });

  it('classifies a response-less failure as a network error', () => {
    expect(normalizeGodaddyError(axiosError(null), 'ctx').kind).toBe('network');
  });

  it('passes an existing RegistrarError straight through', () => {
    const original = normalizeGodaddyError(axiosError(404), 'ctx');
    expect(normalizeGodaddyError(original, 'other')).toBe(original);
  });

  it('keeps the field-level validation detail a 422 carries', () => {
    const err = normalizeGodaddyError(
      axiosError(422, { code: 'INVALID', message: 'bad', fields: [{ path: 'domain', code: 'REQUIRED' }] }),
      'ctx',
    );
    expect((err.raw as { fields?: unknown[] }).fields).toHaveLength(1);
  });
});
