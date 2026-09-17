import { pino } from 'pino';
import { env, isProduction } from '../env.js';

/**
 * Redaction is not cosmetic here: the IONOS key travels as a request header and
 * axios attaches the full request config to every error it throws. Without
 * these paths a single 500 would print the key into the logs — and, via
 * `sync_runs.error_detail`, into the database and the sync-history UI.
 */
const redact = {
  paths: [
    'req.headers["x-api-key"]',
    'req.headers["X-Api-Key"]',
    'headers["x-api-key"]',
    'config.headers["X-Api-Key"]',
    'config.headers["x-api-key"]',
    'err.config.headers["X-Api-Key"]',
    'err.config.headers["x-api-key"]',
    '*.apiKey',
    'apiKey',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact,
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

export type Logger = typeof logger;
