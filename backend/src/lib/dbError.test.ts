import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { explainDbFailure, findDbFailure, sqlState, stripQueryParams } from './dbError.js';

/**
 * The bug these cover: a failing `insert into sync_runs` reached the client as
 * `Failed query: … params: …` with a 500 and no reason, because the Postgres
 * error sits on `cause` and nothing read it.
 */

function pgError(code: string, message = 'boom', extra: Record<string, unknown> = {}) {
  return Object.assign(new pg.DatabaseError(message, 0, 'error'), { code, ...extra });
}

describe('findDbFailure', () => {
  it('finds the driver error through the real Drizzle wrapper', () => {
    // Built with Drizzle's own class rather than a hand-rolled shape, so this
    // fails if a future version stops putting the driver error on `cause`.
    const wrapped = new DrizzleQueryError(
      'insert into "sync_runs" ("id") values (default)',
      ['5c3c9d19', 'full'],
      pgError('42501', 'permission denied for table sync_runs', { table: 'sync_runs' }),
    );

    expect(findDbFailure(wrapped)).toMatchObject({
      code: '42501',
      message: 'permission denied for table sync_runs',
      table: 'sync_runs',
    });
  });

  it('follows a chain several levels deep', () => {
    const deep = new Error('a', { cause: new Error('b', { cause: pgError('23503') }) });
    expect(sqlState(deep)).toBe('23503');
  });

  it('accepts a duck-typed driver error', () => {
    // Two copies of `pg` in a workspace break `instanceof`, and a diagnostic
    // that silently stops working is the thing being fixed here.
    expect(sqlState({ code: '42P01', message: 'nope' })).toBe('42P01');
  });

  it('recognises a socket failure, which has a code but no SQLSTATE', () => {
    expect(sqlState(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
  });

  it('returns null for anything that is not a driver error', () => {
    expect(findDbFailure(new Error('plain'))).toBeNull();
    expect(findDbFailure('a string')).toBeNull();
    expect(findDbFailure(null)).toBeNull();
    expect(findDbFailure(undefined)).toBeNull();
    // A code that is neither a SQLSTATE nor a known socket code.
    expect(findDbFailure({ code: 'nope' })).toBeNull();
  });

  it('terminates on a cause cycle', () => {
    const a: { cause?: unknown } = new Error('a');
    a.cause = a;
    expect(findDbFailure(a)).toBeNull();
  });
});

describe('stripQueryParams', () => {
  it('removes the bound values', () => {
    const message = 'Failed query: insert into "sync_runs"\nparams: 5c3c9d19,full,manual,running';
    expect(stripQueryParams(message)).toBe('Failed query: insert into "sync_runs"');
  });

  it('leaves a params-free message untouched', () => {
    expect(stripQueryParams('permission denied')).toBe('permission denied');
  });
});

describe('explainDbFailure', () => {
  it('names the remedy for each state we can act on', () => {
    expect(explainDbFailure({ code: '25006', message: '' })).toMatch(/read-only/i);
    expect(explainDbFailure({ code: '42P01', message: '' })).toMatch(/db:migrate/);
    expect(explainDbFailure({ code: '42501', message: '' })).toMatch(/db:check/);
    expect(explainDbFailure({ code: '23503', message: '', constraint: 'sync_runs_fk' })).toContain(
      'sync_runs_fk',
    );
  });

  it('says nothing rather than something vague', () => {
    expect(explainDbFailure({ code: '22012', message: 'division by zero' })).toBeNull();
  });
});
