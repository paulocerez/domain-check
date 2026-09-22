import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { translate } from './errorHandler.js';

/**
 * Every row here used to be a 500 `INTERNAL` whose message was the SQL that
 * failed. The distinction that matters is `DB_NOT_READY` — this deployment has
 * to be changed — against `DB_UNAVAILABLE`, where retrying is the answer.
 */

function wrapped(code: string, message = 'boom', extra: Record<string, unknown> = {}) {
  return new DrizzleQueryError(
    'insert into "sync_runs" ("registrar_account_id") values ($1)',
    ['5c3c9d19-a6ec-4ac4-a184-e004e7784435'],
    Object.assign(new pg.DatabaseError(message, 0, 'error'), { code, ...extra }),
  );
}

describe('translate, on a database failure', () => {
  it.each([
    ['25006', 503, 'DB_NOT_READY'],
    ['25P02', 503, 'DB_NOT_READY'],
    ['42P01', 503, 'DB_NOT_READY'],
    ['42703', 503, 'DB_NOT_READY'],
    ['42501', 503, 'DB_NOT_READY'],
    ['23503', 409, 'CONFLICT'],
    ['23505', 409, 'CONFLICT'],
    ['23502', 400, 'VALIDATION_ERROR'],
    ['22P02', 400, 'VALIDATION_ERROR'],
    ['53300', 503, 'DB_UNAVAILABLE'],
    ['57P03', 503, 'DB_UNAVAILABLE'],
    ['08006', 503, 'DB_UNAVAILABLE'],
    ['22012', 500, 'INTERNAL'],
  ])('maps %s to %i %s', (code, status, apiCode) => {
    const { status: got, body } = translate(wrapped(code));
    expect(got).toBe(status);
    expect(body.error.code).toBe(apiCode);
    expect((body.error.details as { sqlstate: string }).sqlstate).toBe(code);
  });

  it('maps a socket failure to DB_UNAVAILABLE', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { status, body } = translate(err);
    expect(status).toBe(503);
    expect(body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('never leaks bound parameters or the offending row', () => {
    const err = wrapped('23503', 'insert violates foreign key', {
      detail: 'Key (registrar_account_id)=(5c3c9d19) is not present in table "registrar_accounts".',
      constraint: 'sync_runs_registrar_account_id_registrar_accounts_id_fk',
      table: 'sync_runs',
    });
    const serialized = JSON.stringify(translate(err).body);

    expect(serialized).not.toContain('params:');
    expect(serialized).not.toContain('is not present in table');
    // The identifiers a reader needs do survive.
    expect(serialized).toContain('sync_runs_registrar_account_id_registrar_accounts_id_fk');
  });

  it('strips the params dump even from an unclassifiable Drizzle error', () => {
    const bare = new DrizzleQueryError('select 1', ['secret-ish'], new Error('no code here'));
    const { status, body } = translate(bare);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('params:');
  });
});

describe('translate, otherwise', () => {
  it('leaves non-database errors alone', () => {
    const { status, body } = translate(new Error('something else'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('something else');
  });
});
