import axios, { type AxiosInstance } from 'axios';
import type { RegistrarCapabilities } from '@domain-check/shared';
import { withRetry } from '../../lib/httpRetry.js';
import { logger } from '../../lib/logger.js';
import type {
  CredentialCheck,
  DomainAvailability,
  Registrar,
  RegistrarDomainDetail,
  RegistrarDomainSummary,
} from '../types.js';
import { RegistrarError } from '../types.js';
import { normalizeGodaddyError } from './errors.js';
import { mapAvailability, mapAvailabilityError, mapDetail, mapSummary } from './mapper.js';
import type {
  GodaddyAvailabilityBulkResponse,
  GodaddyDomainDetail,
  GodaddyDomainSummary,
} from './types.js';

export interface GodaddyClientOptions {
  apiKey: string;
  apiSecret: string;
  /** X-Shopper-Id, for a reseller acting on a subaccount. Not a secret. */
  shopperId?: string | null;
  baseUrl?: string;
  pageSize?: number;
  /** Stops a server that ignores `marker` from looping forever. */
  maxPages?: number;
  /** Names per availability request. The API caps at 500; see checkAvailability. */
  availabilityChunkSize?: number;
  timeoutMs?: number;
  debug?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.godaddy.com';

export class GodaddyRegistrar implements Registrar {
  readonly kind = 'godaddy' as const;
  readonly capabilities: RegistrarCapabilities = {
    // The Domains API reports no renewal price for a domain you already own.
    // The availability endpoint does quote a *registration* price, but that is
    // a different number — so costs here stay user-maintained, as with IONOS.
    pricing: false,
    detailFetch: true,
    nameservers: true,
    availability: true,
  };

  private readonly http: AxiosInstance;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly availabilityChunkSize: number;
  private readonly debug: boolean;

  constructor(options: GodaddyClientOptions) {
    if (!options.apiKey || !options.apiSecret) {
      throw new RegistrarError(
        'config',
        'GoDaddy needs both an API key and an API secret (GODADDY_API_KEY, GODADDY_API_SECRET)',
      );
    }

    this.pageSize = options.pageSize ?? 100;
    this.maxPages = options.maxPages ?? 200;
    this.availabilityChunkSize = options.availabilityChunkSize ?? 100;
    this.debug = options.debug ?? false;

    this.http = axios.create({
      baseURL: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: options.timeoutMs ?? 30_000,
      headers: {
        // GoDaddy's scheme is the key and secret joined by a colon, prefixed
        // with the literal "sso-key". Both halves are secret.
        Authorization: `sso-key ${options.apiKey}:${options.apiSecret}`,
        Accept: 'application/json',
        ...(options.shopperId ? { 'X-Shopper-Id': options.shopperId } : {}),
      },
    });

    if (this.debug) {
      this.http.interceptors.response.use(
        (response) => {
          logger.debug(
            { url: response.config.url, status: response.status, params: response.config.params },
            'godaddy response',
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
      await this.http.get('/v1/domains', { params: { limit: 1 } });
      return { ok: true };
    } catch (err) {
      const normalized = normalizeGodaddyError(err, 'verifyCredentials');
      return { ok: false, reason: normalized.message };
    }
  }

  /**
   * Walks every page of the portfolio.
   *
   * GoDaddy pages by *marker*, not offset: each request asks for the names
   * after the last one already seen. That is sturdier than IONOS's offset walk
   * — a domain added mid-walk cannot shift a window and hide its neighbour —
   * but the Map is kept anyway, both for the duplicate a retried page could
   * produce and to match the IONOS adapter's shape.
   *
   * `statuses` is deliberately not sent: the default includes expired and
   * cancelled domains, and those are exactly the ones this app must not lose
   * sight of.
   */
  async listDomains(opts: { signal?: AbortSignal } = {}): Promise<RegistrarDomainSummary[]> {
    const collected = new Map<string, RegistrarDomainSummary>();
    let marker: string | undefined;

    for (let page = 0; page < this.maxPages; page++) {
      opts.signal?.throwIfAborted();

      const batch = await withRetry(
        async () => {
          try {
            const result = await this.http.get<GodaddyDomainSummary[]>('/v1/domains', {
              params: { limit: this.pageSize, ...(marker ? { marker } : {}) },
              signal: opts.signal,
            });
            return Array.isArray(result.data) ? result.data : [];
          } catch (err) {
            throw normalizeGodaddyError(err, `listDomains(marker=${marker ?? 'start'})`);
          }
        },
        { label: `godaddy.listDomains[${marker ?? 'start'}]`, signal: opts.signal },
      );

      for (const item of batch) {
        const summary = mapSummary(item);
        if (summary.registrarDomainId) collected.set(summary.registrarDomainId, summary);
      }

      if (batch.length < this.pageSize) break;

      const nextMarker = batch[batch.length - 1]?.domain;
      // No usable marker means the next request would repeat this page forever.
      if (!nextMarker || nextMarker === marker) break;
      marker = nextMarker;

      if (page === this.maxPages - 1) {
        logger.warn(
          { maxPages: this.maxPages, collected: collected.size },
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
          const response = await this.http.get<GodaddyDomainDetail>(
            `/v1/domains/${encodeURIComponent(registrarDomainId)}`,
          );
          return mapDetail(response.data);
        } catch (err) {
          throw normalizeGodaddyError(err, `getDomainDetail(${registrarDomainId})`);
        }
      },
      { label: `godaddy.getDomainDetail[${registrarDomainId}]` },
    );
  }

  /**
   * Checks a batch of names.
   *
   * `checkType=FULL` asks the registry rather than GoDaddy's cache, which is
   * the only answer worth showing someone about to spend money.
   *
   * The response is merged back into the caller's order, and any name the
   * registrar answered for neither way gets a synthetic error row — one result
   * per input name is a contract the UI depends on to render a stable table.
   */
  async checkAvailability(
    names: string[],
    opts: { signal?: AbortSignal } = {},
  ): Promise<DomainAvailability[]> {
    const byName = new Map<string, DomainAvailability>();

    for (const chunk of chunked(names, this.availabilityChunkSize)) {
      opts.signal?.throwIfAborted();

      const data = await withRetry(
        async () => {
          try {
            // 203 is how GoDaddy reports a partial result, with the failures in
            // `errors`. It is a 2xx, so axios resolves rather than throws and
            // both halves of the payload survive.
            const response = await this.http.post<GodaddyAvailabilityBulkResponse>(
              '/v1/domains/available',
              chunk,
              {
                params: { checkType: 'FULL' },
                headers: { 'content-type': 'application/json' },
                signal: opts.signal,
              },
            );
            return response.data ?? {};
          } catch (err) {
            throw normalizeGodaddyError(err, `checkAvailability(${chunk.length} names)`);
          }
        },
        { label: `godaddy.checkAvailability[${chunk[0]}]`, signal: opts.signal },
      );

      for (const item of data.domains ?? []) {
        const mapped = mapAvailability(item);
        if (mapped.name) byName.set(mapped.name, mapped);
      }
      for (const item of data.errors ?? []) {
        const mapped = mapAvailabilityError(item);
        if (mapped.name) byName.set(mapped.name, mapped);
      }
    }

    return names.map(
      (name) =>
        byName.get(name) ?? {
          name,
          available: false,
          definitive: false,
          priceCents: null,
          currency: null,
          periodYears: null,
          error: 'The registrar returned no answer for this name',
        },
    );
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
