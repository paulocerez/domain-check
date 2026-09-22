import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrl, isServerless } from '../env.js';
import { findDbFailure } from '../lib/dbError.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

/**
 * node-postgres parses `timestamptz` into a JS Date using the process timezone,
 * which is correct, but it parses bare `date` (OID 1082) into a Date at local
 * midnight — turning alert_log.expiration_date into an off-by-one landmine
 * depending on TZ. Keep dates as strings; the app treats them as 'YYYY-MM-DD'.
 */
pg.types.setTypeParser(1082, (value) => value);

export function createPool(connectionString = databaseUrl) {
  const pool = new pg.Pool({
    connectionString,
    // Every serverless instance opens its own pool, so a generous max here
    // multiplies into the database's connection limit. One user's traffic does
    // not need more than a couple per instance.
    max: isServerless ? 2 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
  return pool;
}

export type Database = ReturnType<typeof createDb>;

/** The handle Drizzle passes to a `db.transaction(...)` callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Accepts either the pool-backed database or an open transaction, so query
 * helpers can be called from inside or outside a transaction unchanged.
 */
export type DbOrTx = Database | Transaction;

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export const pool = createPool();
export const db = createDb(pool);

export async function checkDbHealth(): Promise<'up' | 'down'> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch (err) {
    // The structured failure is what distinguishes "refused", "authentication
    // failed" and "no such database" — all of which reduce to 'down' here.
    logger.error({ err, db: findDbFailure(err) ?? undefined }, 'database health check failed');
    return 'down';
  }
}

export { schema };
