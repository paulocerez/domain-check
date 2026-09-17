import { createHash } from 'node:crypto';
import type pg from 'pg';
import { logger } from './logger.js';

/**
 * Postgres advisory locks, used to keep two syncs of the same account from
 * interleaving.
 *
 * An in-process boolean is not sufficient: `tsx watch` restarts, a crash
 * mid-run, or a second server process would each believe they hold it. The lock
 * lives in the database — the one thing all of those share — and Postgres drops
 * it automatically if the holding session dies.
 *
 * Advisory locks are *session*-scoped, and a connection pool hands out an
 * arbitrary connection per statement, so acquiring on one connection and
 * releasing on another would leak the lock forever. Everything here therefore
 * pins a single client for the whole critical section.
 */

/** Maps an arbitrary key onto the signed 64-bit space advisory locks use. */
export function lockKeyFor(value: string): bigint {
  return createHash('sha256').update(value).digest().readBigInt64BE(0);
}

export interface AdvisoryLockHandle {
  release(): Promise<void>;
}

/**
 * Takes the lock, or returns `null` immediately if another session holds it.
 * Never waits.
 *
 * The caller owns the handle and MUST release it — the returned handle pins a
 * pooled connection for as long as it is held. Callers that can wrap the whole
 * critical section should prefer `withAdvisoryLock`; `acquireAdvisoryLock`
 * exists for the background-sync case, where the lock must be taken
 * synchronously (so the HTTP layer can answer 409) but released much later.
 */
export async function acquireAdvisoryLock(
  pool: pg.Pool,
  key: string,
): Promise<AdvisoryLockHandle | null> {
  const lockKey = lockKeyFor(key).toString();
  const client = await pool.connect();

  let acquired = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1::bigint) as locked',
      [lockKey],
    );
    acquired = Boolean(result.rows[0]?.locked);
  } catch (err) {
    client.release();
    throw err;
  }

  if (!acquired) {
    client.release();
    return null;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('select pg_advisory_unlock($1::bigint)', [lockKey]);
      } catch (err) {
        // Releasing the client closes the session, which drops the lock anyway
        // — worth a warning, not worth masking whatever the caller was doing.
        logger.warn({ err, key }, 'failed to release advisory lock explicitly');
      } finally {
        client.release();
      }
    },
  };
}

/** Runs `fn` under the lock; returns `null` if it was already held. */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  key: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const handle = await acquireAdvisoryLock(pool, key);
  if (!handle) return null;
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}
