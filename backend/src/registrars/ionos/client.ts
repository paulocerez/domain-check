import axios, { type AxiosInstance } from 'axios';
import type { RegistrarCapabilities } from '@domain-check/shared';
import { withRetry } from '../../lib/httpRetry.js';
import { logger } from '../../lib/logger.js';
import type { CredentialCheck, Registrar, RegistrarDomainDetail, RegistrarDomainSummary } from '../types.js';
import { RegistrarError } from '../types.js';
import { normalizeIonosError } from './errors.js';
import { mapDetail, mapSummary } from './mapper.js';
import type { IonosDomainLarge, IonosDomainsResponse } from './types.js';

export interface IonosClientOptions {
  apiKey: string;
  tenantId?: string | null;
  baseUrl?: string;
  pageSize?: number;
  /** Stops a server that ignores `offset` from looping forever. */
  maxPages?: number;
  timeoutMs?: number;
  debug?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.hosting.ionos.com/domains';

export class IonosRegistrar implements Registrar {
  readonly kind = 'ionos' as const;
  readonly capabilities: RegistrarCapabilities = {
    // The IONOS Domains API exposes no price, cost or currency field anywhere.
    // This is why every number in the cost dashboard is user-maintained.
    pricing: false,
    detailFetch: true,
    nameservers: true,
    // The Domains API has no availability or price-check endpoint either; it
    // only ever talks about domains the tenant already holds.
    availability: false,
  };

  private readonly http: AxiosInstance;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly debug: boolean;

  constructor(options: IonosClientOptions) {
    if (!options.apiKey) {
      throw new RegistrarError('config', 'IONOS API key is not configured');
    }

    this.pageSize = options.pageSize ?? 100;
    this.maxPages = options.maxPages ?? 200;
    this.debug = options.debug ?? false;

    this.http = axios.create({
      baseURL: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: options.timeoutMs ?? 30_000,
      headers: {
        // IONOS keys have the shape "<publicprefix>.<secret>" and are sent verbatim.
        'X-Api-Key': options.apiKey,
        Accept: 'application/json',
        ...(options.tenantId ? { 'X-Tenant-Id': options.tenantId } : {}),
      },
    });

    if (this.debug) {
      this.http.interceptors.response.use(
        (response) => {
          logger.debug(
            { url: response.config.url, status: response.status, params: response.config.params },
            'ionos response',
          );
          return response;
        },
        (error) => Promise.reject(error),
      );
    }
  }

  async verifyCredentials(): Promise<CredentialCheck> {
    try {
      // One-item page: the cheapest call that still proves auth and routing.
      await this.http.get('/v1/domainitems', { params: { limit: 1, offset: 0 } });
      return { ok: true };
    } catch (err) {
      const normalized = normalizeIonosError(err, 'verifyCredentials');
      return { ok: false, reason: normalized.message };
    }
  }

  /**
   * Walks every page of the portfolio.
   *
   * Results accumulate into a Map keyed by the registrar id. Offset pagination
   * over a mutable collection can show the same item on two pages (or skip one)
   * if the ordering shifts mid-walk; sorting by DOMAIN_NAME rather than by a
   * provisioning timestamp minimises that, and the Map absorbs what's left.
   */
  async listDomains(opts: { signal?: AbortSignal } = {}): Promise<RegistrarDomainSummary[]> {
    const collected = new Map<string, RegistrarDomainSummary>();
    let offset = 0;
    let expectedCount: number | null = null;

    for (let page = 0; page < this.maxPages; page++) {
      opts.signal?.throwIfAborted();

      const response = await withRetry(
        async () => {
          try {
            const result = await this.http.get<IonosDomainsResponse>('/v1/domainitems', {
              params: {
                limit: this.pageSize,
                offset,
                // Yields setToExpireOn for the whole portfolio without a
                // per-domain request — the cheap half of a two-phase sync.
                includeDomainStatus: true,
                sortBy: 'DOMAIN_NAME',
                direction: 'ASC',
              },
              signal: opts.signal,
            });
            return result.data;
          } catch (err) {
            throw normalizeIonosError(err, `listDomains(offset=${offset})`);
          }
        },
        { label: `ionos.listDomains[${offset}]`, signal: opts.signal },
      );

      const batch = response.domains ?? [];
      if (typeof response.count === 'number') expectedCount = response.count;

      for (const item of batch) {
        const summary = mapSummary(item);
        if (summary.registrarDomainId) collected.set(summary.registrarDomainId, summary);
      }

      if (batch.length < this.pageSize) break;
      offset += this.pageSize;
      if (expectedCount !== null && offset >= expectedCount) break;

      if (page === this.maxPages - 1) {
        logger.warn(
          { maxPages: this.maxPages, collected: collected.size, expectedCount },
          'listDomains hit the page cap — results may be incomplete',
        );
      }
    }

    return [...collected.values()];
  }

  async getDomainDetail(registrarDomainId: string): Promise<RegistrarDomainDetail> {
    return withRetry(
      async () => {
        try {
          const response = await this.http.get<IonosDomainLarge>(
            `/v1/domainitems/${encodeURIComponent(registrarDomainId)}`,
            { params: { includeDomainStatus: true } },
          );
          return mapDetail(response.data);
        } catch (err) {
          throw normalizeIonosError(err, `getDomainDetail(${registrarDomainId})`);
        }
      },
      { label: `ionos.getDomainDetail[${registrarDomainId}]` },
    );
  }
}
