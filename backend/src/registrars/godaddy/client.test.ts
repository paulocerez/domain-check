import { AxiosError, type AxiosAdapter, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { GodaddyRegistrar } from './client.js';
import type { GodaddyDomainSummary } from './types.js';

/**
 * A recording axios adapter.
 *
 * Stubbing at the adapter seam rather than mocking the module means the real
 * axios instance, its params serialiser and the client's own pagination all run
 * — which is the part worth testing.
 */
function stub(respond: (config: AxiosRequestConfig) => { status?: number; data: unknown }) {
  const calls: AxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const { status = 200, data } = respond(config);
    const response = {
      data,
      status,
      statusText: 'OK',
      headers: {},
      config: config as never,
    } as AxiosResponse;
    // An adapter owns the status check, so a stub that always resolves would
    // quietly turn every 4xx test into a success. 203 must still resolve here —
    // that is the partial-availability case the client depends on.
    if (status < 200 || status >= 300) {
      throw new AxiosError('Request failed', String(status), config as never, null, response);
    }
    return response;
  };
  return { adapter, calls };
}

function client(adapter: AxiosAdapter, options: Record<string, unknown> = {}) {
  const registrar = new GodaddyRegistrar({ apiKey: 'k', apiSecret: 's', ...options });
  // The constructor builds the instance; swapping the adapter keeps everything
  // else — baseURL, headers, interceptors — exactly as production has it.
  (registrar as unknown as { http: { defaults: { adapter: AxiosAdapter } } }).http.defaults.adapter =
    adapter;
  return registrar;
}

function page(from: number, count: number): GodaddyDomainSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    domainId: from + i,
    domain: `d${String(from + i).padStart(4, '0')}.com`,
    status: 'ACTIVE',
    expires: '2027-01-01T00:00:00.000Z',
  }));
}

describe('constructor', () => {
  it('refuses to build without both halves of the credential', () => {
    expect(() => new GodaddyRegistrar({ apiKey: 'k', apiSecret: '' })).toThrow(/API secret|key and an API secret/);
    expect(() => new GodaddyRegistrar({ apiKey: '', apiSecret: 's' })).toThrow();
  });
});

describe('listDomains', () => {
  it('walks pages by marker and stops on a short page', async () => {
    const { adapter, calls } = stub((config) => {
      const marker = config.params?.marker as string | undefined;
      if (!marker) return { data: page(1, 3) };
      if (marker === 'd0003.com') return { data: page(4, 3) };
      if (marker === 'd0006.com') return { data: page(7, 1) };
      throw new Error(`unexpected marker ${marker}`);
    });

    const domains = await client(adapter, { pageSize: 3 }).listDomains();

    expect(domains).toHaveLength(7);
    expect(domains.map((d) => d.name)).toEqual([
      'd0001.com', 'd0002.com', 'd0003.com', 'd0004.com', 'd0005.com', 'd0006.com', 'd0007.com',
    ]);
    // The marker is the last name of the previous page, not an offset.
    expect(calls.map((c) => c.params?.marker)).toEqual([undefined, 'd0003.com', 'd0006.com']);
  });

  it('makes exactly one request when the first page is short', async () => {
    const { adapter, calls } = stub(() => ({ data: page(1, 2) }));
    await client(adapter, { pageSize: 100 }).listDomains();
    expect(calls).toHaveLength(1);
  });

  it('does not filter by status, so expired and cancelled domains still arrive', async () => {
    const { adapter, calls } = stub(() => ({ data: page(1, 1) }));
    await client(adapter, { pageSize: 100 }).listDomains();
    expect(calls[0]!.params).not.toHaveProperty('statuses');
  });

  it('stops at the page cap instead of looping forever on a stuck marker', async () => {
    // A server that ignores `marker` and keeps returning full pages.
    const { adapter, calls } = stub(() => ({ data: page(1, 2) }));
    const domains = await client(adapter, { pageSize: 2, maxPages: 3 }).listDomains();
    // The second request repeats the marker, which the client refuses to follow.
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(domains).toHaveLength(2);
  });

  it('deduplicates a name seen on two pages', async () => {
    let call = 0;
    const { adapter } = stub(() => {
      call++;
      if (call === 1) return { data: page(1, 2) };
      // Overlapping window: d0002 appears again.
      return { data: [...page(2, 1)] };
    });
    const domains = await client(adapter, { pageSize: 2 }).listDomains();
    expect(domains).toHaveLength(2);
  });

  it('tolerates a non-array body without throwing', async () => {
    const { adapter } = stub(() => ({ data: { message: 'unexpected' } }));
    await expect(client(adapter).listDomains()).resolves.toEqual([]);
  });

  it('honours an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, calls } = stub(() => ({ data: page(1, 1) }));
    await expect(client(adapter).listDomains({ signal: controller.signal })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('getDomainDetail', () => {
  it('addresses the domain by name and maps the response', async () => {
    const { adapter, calls } = stub(() => ({
      data: { domainId: 1, domain: 'vetpal.com', status: 'ACTIVE', expires: '2027-01-01T00:00:00.000Z' },
    }));

    const detail = await client(adapter).getDomainDetail('vetpal.com');

    expect(calls[0]!.url).toBe('/v1/domains/vetpal.com');
    expect(detail.name).toBe('vetpal.com');
    expect(detail.expirationDate).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('normalises a 404 into a not_found RegistrarError', async () => {
    const { adapter } = stub(() => ({ status: 404, data: { code: 'NOT_FOUND', message: 'gone' } }));
    await expect(client(adapter).getDomainDetail('missing.com')).rejects.toMatchObject({
      kind: 'not_found',
      httpStatus: 404,
    });
  });
});

describe('checkAvailability', () => {
  it('asks the registry rather than the cache', async () => {
    const { adapter, calls } = stub(() => ({ data: { domains: [{ domain: 'a.com', available: true }] } }));
    await client(adapter).checkAvailability(['a.com']);
    expect(calls[0]!.params?.checkType).toBe('FULL');
    expect(calls[0]!.method).toBe('post');
  });

  it('chunks the request and merges every chunk', async () => {
    const { adapter, calls } = stub((config) => {
      const names = JSON.parse(config.data as string) as string[];
      return { data: { domains: names.map((domain) => ({ domain, available: true, price: 1_000_000, currency: 'EUR' })) } };
    });

    const names = Array.from({ length: 250 }, (_, i) => `d${i}.com`);
    const results = await client(adapter, { availabilityChunkSize: 100 }).checkAvailability(names);

    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0]!.data as string)).toHaveLength(100);
    expect(JSON.parse(calls[2]!.data as string)).toHaveLength(50);
    expect(results).toHaveLength(250);
    expect(results.every((r) => r.priceCents === 100)).toBe(true);
  });

  it('keeps both halves of a 203 partial response', async () => {
    // 203 is how GoDaddy signals "some of these failed" — treating it as an
    // error would discard the names it did answer for.
    const { adapter } = stub(() => ({
      status: 203,
      data: {
        domains: [{ domain: 'good.com', available: true, price: 9_990_000, currency: 'USD', period: 2 }],
        errors: [{ domain: 'bad.zzz', code: 'UNSUPPORTED_TLD', message: 'not supported' }],
      },
    }));

    const results = await client(adapter).checkAvailability(['good.com', 'bad.zzz']);

    expect(results).toEqual([
      { name: 'good.com', available: true, definitive: true, priceCents: 999, currency: 'USD', periodYears: 2, error: null },
      { name: 'bad.zzz', available: false, definitive: false, priceCents: null, currency: null, periodYears: null, error: 'not supported' },
    ]);
  });

  it('returns one row per input name, in input order', async () => {
    // GoDaddy answered for neither name; the UI still needs a stable table.
    const { adapter } = stub(() => ({ data: { domains: [{ domain: 'b.com', available: true }] } }));
    const results = await client(adapter).checkAvailability(['a.com', 'b.com', 'c.com']);
    expect(results.map((r) => r.name)).toEqual(['a.com', 'b.com', 'c.com']);
    expect(results[0]!.error).toMatch(/no answer/);
    expect(results[1]!.available).toBe(true);
    expect(results[2]!.error).toMatch(/no answer/);
  });

  it('makes no request for an empty list', async () => {
    const { adapter, calls } = stub(() => ({ data: {} }));
    await expect(client(adapter).checkAvailability([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('normalises a 429 into a retryable rate_limit error', async () => {
    const { adapter } = stub(() => ({ status: 429, data: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } }));
    // A 429 is retryable, so this walks the full backoff before giving up.
    await expect(
      client(adapter).checkAvailability(['a.com']),
    ).rejects.toMatchObject({ kind: 'rate_limit', httpStatus: 429 });
  }, 30_000);
});
