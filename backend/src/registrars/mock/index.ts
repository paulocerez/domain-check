import type { RegistrarCapabilities } from '@domain-check/shared';
import { mapDetail, mapSummary } from '../ionos/mapper.js';
import type { Registrar, RegistrarDomainDetail, RegistrarDomainSummary, CredentialCheck } from '../types.js';
import { RegistrarError } from '../types.js';
import { FIXTURE_SPECS, buildLarge, buildSmall, findSpec } from './fixtures.js';

export type MockFailureMode = '429' | '401' | 'partial' | 'slow' | '';

export interface MockRegistrarOptions {
  failureMode?: MockFailureMode;
  /** Ids to omit from listDomains — drives the missing/reappeared sweep in tests. */
  hiddenIds?: Set<string>;
  /** Fixed clock so tests get deterministic relative expiries. */
  now?: () => number;
  pageSize?: number;
}

/**
 * Fixture-backed registrar.
 *
 * It emits raw IONOS wire JSON and runs it through the production mapper, so
 * every layer above the adapter — sync, costing, alerting, the whole UI — is
 * exercised for real without credentials or network.
 */
export class MockRegistrar implements Registrar {
  readonly kind = 'mock' as const;
  readonly capabilities: RegistrarCapabilities = {
    // Mirrors IONOS: no registrar supplies pricing, so prices stay user-owned.
    pricing: false,
    detailFetch: true,
    nameservers: false,
  };

  private readonly failureMode: MockFailureMode;
  private readonly hiddenIds: Set<string>;
  private readonly now: () => number;
  private readonly pageSize: number;
  /** Counts list calls so the 429 mode can fail once and then succeed. */
  private listAttempts = 0;

  constructor(options: MockRegistrarOptions = {}) {
    this.failureMode = options.failureMode ?? '';
    this.hiddenIds = options.hiddenIds ?? new Set();
    this.now = options.now ?? (() => Date.now());
    this.pageSize = options.pageSize ?? 100;
  }

  async verifyCredentials(): Promise<CredentialCheck> {
    if (this.failureMode === '401') return { ok: false, reason: 'Mock credentials rejected (MOCK_FAILURE_MODE=401)' };
    return { ok: true };
  }

  async listDomains(): Promise<RegistrarDomainSummary[]> {
    this.listAttempts += 1;

    if (this.failureMode === '401') {
      throw new RegistrarError('auth', 'Mock auth failure (MOCK_FAILURE_MODE=401)', { httpStatus: 401 });
    }
    if (this.failureMode === '429' && this.listAttempts === 1) {
      // Fails once so the caller's retry path is genuinely traversed.
      throw new RegistrarError('rate_limit', 'Mock rate limit (MOCK_FAILURE_MODE=429)', { httpStatus: 429 });
    }
    if (this.failureMode === 'slow') await delay(2000);

    const now = this.now();
    const visible = FIXTURE_SPECS.filter((spec) => !this.hiddenIds.has(spec.id));

    // Page the fixtures the way the real client will see them, so pagination
    // assembly is exercised rather than short-circuited.
    const summaries: RegistrarDomainSummary[] = [];
    for (let offset = 0; offset < visible.length; offset += this.pageSize) {
      for (const spec of visible.slice(offset, offset + this.pageSize)) {
        summaries.push(mapSummary(buildSmall(spec, now, true)));
      }
    }
    return summaries;
  }

  async getDomainDetail(registrarDomainId: string): Promise<RegistrarDomainDetail> {
    if (this.failureMode === '401') {
      throw new RegistrarError('auth', 'Mock auth failure (MOCK_FAILURE_MODE=401)', { httpStatus: 401 });
    }
    if (this.failureMode === 'slow') await delay(250);

    const spec = findSpec(registrarDomainId);
    if (!spec || this.hiddenIds.has(registrarDomainId)) {
      throw new RegistrarError('not_found', `No fixture domain ${registrarDomainId}`, { httpStatus: 404 });
    }
    // In 'partial' mode every fourth fixture fails, so a run ends up with a mix
    // of fresh and stale detail rather than failing wholesale.
    const partialFailure =
      this.failureMode === 'partial' && FIXTURE_SPECS.indexOf(spec) % 4 === 0;
    if (spec.detailFails || partialFailure) {
      throw new RegistrarError('server', `Mock detail failure for ${spec.name}`, { httpStatus: 500 });
    }
    return mapDetail(buildLarge(spec, this.now()));
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
