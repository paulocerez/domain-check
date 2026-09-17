import type { ApiErr, ApiErrorCode } from '@domain-check/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
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
  if (status >= 500) logger.error({ err }, 'request failed');
  else logger.warn({ code: body.error.code, message: body.error.message }, 'request rejected');

  res.status(status).json(body);
}

function translate(err: unknown): { status: number; body: ApiErr } {
  if (err instanceof HttpError) {
    return fail(err.status, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return fail(400, 'VALIDATION_ERROR', 'Request validation failed', err.issues);
  }

  if (err instanceof SyncInProgressError) {
    return fail(409, 'SYNC_IN_PROGRESS', err.message);
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

  const message = err instanceof Error ? err.message : 'Unexpected error';
  return fail(500, 'INTERNAL', message);
}

function fail(status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return { status, body: { ok: false as const, error: { code, message, ...(details ? { details } : {}) } } };
}
