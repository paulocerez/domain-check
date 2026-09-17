import { describe, expect, it } from 'vitest';
import { REGISTRAR_OWNED_FIELDS, USER_OWNED_FIELDS } from '../../db/schema.js';
import { mapDetail, mapSummary, parseBoolish, parseDate } from './mapper.js';
import { normalizeIonosError } from './errors.js';
import type { IonosDomainLarge, IonosDomainSmall } from './types.js';

describe('mapSummary', () => {
  it('maps the spec example verbatim', () => {
    const input: IonosDomainSmall = {
      id: '50e3475a-6dd7-4486-bca9-4ec9c42bae1c',
      name: 'example-zone-köln.de',
      tld: 'de',
      encodedName: 'xn--example-zone-kln-zwb.de',
      status: {
        provisioningStatus: {
          type: 'ACTIVE',
          setToExpireOn: '2027-04-02T07:17:45.862Z',
          // The published spec example really does send a string here.
          isAutorenewSwitchable: 'true' as unknown as boolean,
        },
        processStatus: { type: 'UPDATE_IN_PROGRESS' },
      },
    };

    expect(mapSummary(input)).toMatchObject({
      registrarDomainId: '50e3475a-6dd7-4486-bca9-4ec9c42bae1c',
      name: 'example-zone-köln.de',
      encodedName: 'xn--example-zone-kln-zwb.de',
      tld: 'de',
      provisioningStatus: 'ACTIVE',
      processStatus: 'UPDATE_IN_PROGRESS',
      isAutorenewSwitchable: true,
      pendingProvisioning: false,
    });
  });

  it('survives a missing status block', () => {
    const summary = mapSummary({ id: 'x', name: 'plain.com', tld: 'com' });
    expect(summary.setToExpireOn).toBeNull();
    expect(summary.provisioningStatus).toBeNull();
  });

  it('lowercases the name', () => {
    expect(mapSummary({ id: 'x', name: 'MiXeD.COM', tld: 'COM' }).name).toBe('mixed.com');
  });

  it('keeps a multi-label TLD the registrar reports', () => {
    expect(mapSummary({ id: 'x', name: 'vetpal.co.uk', tld: 'co.uk' }).tld).toBe('co.uk');
  });

  it('ignores a reported TLD the name does not end with', () => {
    // The spec's own Domain example pairs "…köln.de" with tld "com".
    expect(mapSummary({ id: 'x', name: 'example.de', tld: 'com' }).tld).toBe('de');
  });
});

describe('mapDetail', () => {
  const large: IonosDomainLarge = {
    id: 'abc',
    name: 'secret.com',
    tld: 'com',
    authInfo: 'ADs123#a!',
    autoRenew: true,
    expirationDate: '2027-03-02T15:27:02.000Z',
    cancelOnExpire: false,
    domainLock: false,
    transferLock: true,
    privacyEnabled: false,
    dnsSecEnabled: false,
    domainType: 'DOMAIN',
  };

  it('maps the detail fields', () => {
    const detail = mapDetail(large);
    expect(detail.expirationDate?.toISOString()).toBe('2027-03-02T15:27:02.000Z');
    expect(detail).toMatchObject({ autoRenew: true, transferLock: true, domainType: 'DOMAIN' });
  });

  it('strips authInfo from the payload we persist', () => {
    // authInfo is the transfer auth code. It must never reach raw_detail, which
    // is returned by the detail endpoint and rendered in the UI.
    const detail = mapDetail(large);
    expect(JSON.stringify(detail.raw)).not.toContain('ADs123');
    expect(detail.raw).not.toHaveProperty('authInfo');
  });
});

describe('parse helpers', () => {
  it('treats unparseable dates as absent rather than Invalid Date', () => {
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('coerces the string booleans IONOS sends', () => {
    expect(parseBoolish('true')).toBe(true);
    expect(parseBoolish('false')).toBe(false);
    expect(parseBoolish(true)).toBe(true);
    expect(parseBoolish(undefined)).toBeNull();
  });
});

describe('normalizeIonosError', () => {
  const axiosError = (status: number, data: unknown, headers: Record<string, string> = {}) => ({
    isAxiosError: true,
    message: 'Request failed',
    response: { status, data, statusText: 'Error', headers },
    config: { headers: { 'X-Api-Key': 'prefix.SUPERSECRET' } },
  });

  it('reads the documented array error shape', () => {
    const err = normalizeIonosError(
      axiosError(400, [{ code: 'BAD_REQUEST', parameters: ['limit'], message: 'Must be positive' }]),
      'listDomains',
    );
    expect(err.kind).toBe('bad_request');
    expect(err.registrarCode).toBe('BAD_REQUEST');
    expect(err.message).toContain('Must be positive');
  });

  it('does not throw on an HTML 502 from a proxy', () => {
    // A parser that throws while handling an error turns a clear upstream
    // outage into an opaque stack trace.
    const err = normalizeIonosError(axiosError(502, '<html><body>Bad Gateway</body></html>'), 'listDomains');
    expect(err.kind).toBe('server');
    expect(err.isRetryable).toBe(true);
  });

  it('classifies auth failures as non-retryable', () => {
    const err = normalizeIonosError(axiosError(401, [{ code: 'UNAUTHORIZED', message: 'Bad key' }]), 'x');
    expect(err.kind).toBe('auth');
    expect(err.isRetryable).toBe(false);
  });

  it('marks 429 retryable and carries Retry-After', () => {
    const err = normalizeIonosError(axiosError(429, [], { 'retry-after': '5' }), 'x');
    expect(err.kind).toBe('rate_limit');
    expect(err.isRetryable).toBe(true);
    expect((err.raw as { retryAfter?: string }).retryAfter).toBe('5');
  });

  it('never carries the API key into the error payload', () => {
    // RegistrarError.raw ends up in sync_runs.error_detail and the sync UI.
    const err = normalizeIonosError(axiosError(500, [{ message: 'boom' }]), 'x');
    expect(JSON.stringify(err.raw ?? {})).not.toContain('SUPERSECRET');
  });
});

describe('field ownership', () => {
  it('keeps registrar-owned and user-owned columns disjoint', () => {
    // If these ever overlap, a sync would clobber the user's cost data.
    const overlap = REGISTRAR_OWNED_FIELDS.filter((field) =>
      (USER_OWNED_FIELDS as readonly string[]).includes(field),
    );
    expect(overlap).toEqual([]);
  });

  it('does not let sync write any pricing or annotation column', () => {
    for (const field of ['priceOverrideCents', 'priceCurrency', 'notes', 'tags', 'alertLeadDays']) {
      expect(REGISTRAR_OWNED_FIELDS as readonly string[]).not.toContain(field);
    }
  });
});
