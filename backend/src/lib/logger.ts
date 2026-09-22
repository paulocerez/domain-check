import { pino } from 'pino';
import { errWithCause } from 'pino-std-serializers';
import { env, isProduction } from '../env.js';

/**
 * Redaction is not cosmetic here: the IONOS key travels as a request header and
 * axios attaches the full request config to every error it throws. Without
 * these paths a single 500 would print the key into the logs — and, via
 * `sync_runs.error_detail`, into the database and the sync-history UI.
 *
 * Exported so the test can assert the real paths rather than a copy of them.
 */
export const redact = {
  paths: [
    'req.headers["x-api-key"]',
    'req.headers["X-Api-Key"]',
    'headers["x-api-key"]',
    'config.headers["X-Api-Key"]',
    'config.headers["x-api-key"]',
    'err.config.headers["X-Api-Key"]',
    'err.config.headers["x-api-key"]',
    // Now that `cause` chains are serialized (below), the same secret can ride
    // one or two levels down — Drizzle wraps once, and a registrar error inside
    // a Drizzle error inside ours is the worst case. `fast-redact` has no
    // recursive wildcard, so the depths are spelled out rather than globbed.
    'err.cause.config.headers["X-Api-Key"]',
    'err.cause.config.headers["x-api-key"]',
    'err.cause.cause.config.headers["X-Api-Key"]',
    'err.cause.cause.config.headers["x-api-key"]',
    'err.cause.apiKey',
    'err.cause.cause.apiKey',
    '*.apiKey',
    'apiKey',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact,
  /**
   * pino's default error serializer copies enumerable own properties, which
   * drops a `cause` set through `new Error(msg, { cause })`. That is exactly
   * where Drizzle puts the Postgres error, so without this a failing query
   * logged its SQL and never its SQLSTATE.
   */
  serializers: { err: errWithCause },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

export type Logger = typeof logger;
