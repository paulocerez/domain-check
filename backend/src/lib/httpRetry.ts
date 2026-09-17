import { RegistrarError } from '../registrars/types.js';
import { logger } from './logger.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  signal?: AbortSignal;
}

const DEFAULTS = { attempts: 4, baseDelayMs: 500, maxDelayMs: 8000 };

/**
 * Retries a registrar call on failures that could plausibly succeed later:
 * rate limits, 5xx and network errors.
 *
 * Client errors other than 429 are never retried — a 401 will not start working
 * on the third attempt, and retrying only delays a clear, actionable error by
 * several seconds per domain.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const retryable = err instanceof RegistrarError ? err.isRetryable : false;
      if (!retryable || attempt === attempts - 1) throw err;

      const delayMs = computeDelay(err, attempt, baseDelayMs, maxDelayMs);
      logger.warn(
        { label: options.label, attempt: attempt + 1, attempts, delayMs, kind: (err as RegistrarError).kind },
        'registrar call failed, retrying',
      );
      await sleep(delayMs, options.signal);
    }
  }

  throw lastError;
}

function computeDelay(err: unknown, attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const retryAfterMs = retryAfterFrom(err);
  if (retryAfterMs !== null) return Math.min(retryAfterMs, maxDelayMs);

  const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  // Jitter keeps a fan-out of concurrent detail fetches from retrying in lockstep.
  return backoff + Math.floor(Math.random() * 250);
}

/** Honours `Retry-After` in both its seconds and HTTP-date forms. */
function retryAfterFrom(err: unknown): number | null {
  if (!(err instanceof RegistrarError)) return null;
  const raw = (err.raw as { retryAfter?: string } | undefined)?.retryAfter;
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = new Date(raw).getTime();
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
