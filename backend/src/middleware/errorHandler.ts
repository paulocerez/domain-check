import type { ApiErr, ApiErrorCode } from '@domain-check/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { explainDbFailure, findDbFailure, stripQueryParams, type DbFailure } from '../lib/dbError.js';
import { logger } from '../lib/logger.js';
import { NoRegistrarConfiguredError } from '../db/provision.js';
import { RegistrarError } from '../registrars/types.js';
import { SyncInProgressError } from '../services/syncService.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);

  const { status, body } = translate(err);
  // The structured failure rides alongside the error so a SQLSTATE is greppable
  // in the deployment log without parsing prose out of a message.
  if (status >= 500) logger.error({ err, db: findDbFailure(err) ?? undefined }, 'request failed');
  else logger.warn({ code: body.error.code, message: body.error.message }, 'request rejected');

  res.status(status).json(body);
}

/** Exported for tests: the whole mapping is worth asserting without Express. */
export function translate(err: unknown): { status: number; body: ApiErr } {
  if (err instanceof HttpError) {
    return fail(err.status, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return fail(400, 'VALIDATION_ERROR', 'Request validation failed', err.issues);
  }

  if (err instanceof SyncInProgressError) {
    return fail(409, 'SYNC_IN_PROGRESS', err.message);
  }

  if (err instanceof NoRegistrarConfiguredError) {
    // Reuses REGISTRAR_AUTH, which already means "a credential or configuration
    // problem that is yours to fix" — the same code `RegistrarError` kind
    // 'config' maps to below. `details` carries the variable names so the UI can
    // name them without parsing the sentence.
    return fail(400, 'REGISTRAR_AUTH', err.message, { missingEnv: err.missingEnv });
  }

  if (err instanceof RegistrarError) {
    // Credential and configuration problems are the user's to fix and deserve a
    // 4xx with the actual reason, not a generic 500.
    if (err.kind === 'auth' || err.kind === 'config') {
      return fail(400, 'REGISTRAR_AUTH', err.message);
    }
    if (err.kind === 'not_found') return fail(404, 'NOT_FOUND', err.message);
    return fail(502, 'REGISTRAR_UNAVAILABLE', err.message);
  }

  // Last, and after RegistrarError, so a registrar failure that happens to wrap
  // a database error keeps the meaning it chose for itself.
  const dbFailure = findDbFailure(err);
  if (dbFailure) return translateDbFailure(dbFailure);

  const message = err instanceof Error ? stripQueryParams(err.message) : 'Unexpected error';
  return fail(500, 'INTERNAL', message);
}

/**
 * Turns a Postgres failure into an answer the reader can act on.
 *
 * The distinction that matters is 503 `DB_NOT_READY` — something about this
 * deployment's database has to be changed — versus 503 `DB_UNAVAILABLE`, where
 * retrying is the right response. Everything used to be a 500 `INTERNAL` whose
 * message was Drizzle's query dump.
 */
function translateDbFailure(failure: DbFailure): { status: number; body: ApiErr } {
  // Never `failure.detail`: it quotes the offending row's values. Never the
  // Drizzle message either — `explainDbFailure` speaks, or we fall back to the
  // driver's own sentence, which has no params tail.
  const details = {
    sqlstate: failure.code,
    ...(failure.table ? { table: failure.table } : {}),
    ...(failure.constraint ? { constraint: failure.constraint } : {}),
  };
  const say = (status: number, code: ApiErrorCode) =>
    fail(status, code, explainDbFailure(failure) ?? failure.message, details);

  switch (failure.code) {
    case '25006': // read_only_sql_transaction
    case '25P02': // in_failed_sql_transaction
    case '42P01': // undefined_table
    case '42703': // undefined_column
    case '3F000': // invalid_schema_name
    case '42501': // insufficient_privilege
      return say(503, 'DB_NOT_READY');

    case '23503': // foreign_key_violation
    case '23505': // unique_violation
      return say(409, 'CONFLICT');

    case '23502': // not_null_violation
    case '22P02': // invalid_text_representation
    case '22001': // string_data_right_truncation
      // Reached only when validation let something through; a 400 is honest.
      return say(400, 'VALIDATION_ERROR');

    case '53300': // too_many_connections
    case '57P03': // cannot_connect_now
      return say(503, 'DB_UNAVAILABLE');

    default:
      if (failure.code.startsWith('08') || !/^[0-9A-Z]{5}$/.test(failure.code)) {
        // Class 08 is connection exceptions; a non-SQLSTATE code is a socket
        // error, which means the same thing from the caller's side.
        return say(503, 'DB_UNAVAILABLE');
      }
      return say(500, 'INTERNAL');
  }
}

function fail(status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return { status, body: { ok: false as const, error: { code, message, ...(details ? { details } : {}) } } };
}
