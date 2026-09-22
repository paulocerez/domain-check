import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { errWithCause } from 'pino-std-serializers';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { redact } from './logger.js';

/**
 * pino's *default* error serializer copies a known set of properties and drops
 * `cause`. Drizzle puts the Postgres error there, so before `errWithCause` a
 * failing query logged its SQL and never its SQLSTATE — the logs were as silent
 * as the HTTP response.
 *
 * Builds its own instance because `vitest.config.ts` sets LOG_LEVEL=silent for
 * the shared logger.
 */
function capture(): { lines: unknown[]; log: ReturnType<typeof pino> } {
  const lines: unknown[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)));
      callback();
    },
  });
  return { lines, log: pino({ level: 'info', redact, serializers: { err: errWithCause } }, stream) };
}

describe('logger', () => {
  it('serializes the Postgres error hiding under a Drizzle error', () => {
    const { lines, log } = capture();
    log.error(
      {
        err: new DrizzleQueryError(
          'insert into "sync_runs"',
          ['a'],
          Object.assign(new Error('permission denied'), { code: '42501', table: 'sync_runs' }),
        ),
      },
      'request failed',
    );

    const entry = lines[0] as { err: { cause: { code: string; table: string } } };
    expect(entry.err.cause.code).toBe('42501');
    expect(entry.err.cause.table).toBe('sync_runs');
  });

  it('still redacts the registrar key when it rides inside a cause', () => {
    const { lines, log } = capture();
    const inner = Object.assign(new Error('401'), {
      config: { headers: { 'X-Api-Key': 'publicprefix.secret' } },
    });
    log.error({ err: new Error('wrapped', { cause: inner }) }, 'request failed');

    expect(JSON.stringify(lines[0])).not.toContain('publicprefix.secret');
    expect(JSON.stringify(lines[0])).toContain('[redacted]');
  });
});
