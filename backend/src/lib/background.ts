import { isServerless } from '../env.js';
import { logger } from './logger.js';

/**
 * Keeps work alive after the response has been sent.
 *
 * On a long-lived server a detached promise simply keeps running. On a
 * serverless platform the instance can be frozen the instant the response is
 * flushed, so a detached promise is silently abandoned mid-sync — the run row
 * stays 'running' forever and the advisory lock is only released when the
 * connection eventually dies.
 *
 * `waitUntil` is the platform's contract for "do not freeze me yet". It is
 * imported lazily so the dependency is not required when running as a normal
 * server, and falls back to plain detachment if it is unavailable.
 */
export function runInBackground(work: () => Promise<unknown>, label: string): void {
  const promise = work().catch((err) => {
    logger.error({ err, label }, 'background task failed');
  });

  if (!isServerless) {
    void promise;
    return;
  }

  void (async () => {
    try {
      const { waitUntil } = await import('@vercel/functions');
      waitUntil(promise);
    } catch {
      // Older runtime or the package is absent — the work still runs, it just
      // has no protection against the instance being frozen early.
      logger.warn({ label }, 'waitUntil unavailable; background work may be cut short');
      void promise;
    }
  })();
}
