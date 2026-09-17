import axios from 'axios';
import { RegistrarError, type RegistrarErrorKind } from '../types.js';
import type { IonosError } from './types.js';

/**
 * Turns anything axios can throw into a `RegistrarError`.
 *
 * IONOS documents its error body as an *array* of `{code, parameters, message}`,
 * which no generic handler expects. Equally importantly, the body is often not
 * that at all: a 502 from a proxy in front of IONOS arrives as HTML, and a
 * parser that throws while handling an error turns a clear upstream outage into
 * an opaque stack trace. Everything below is defensive on purpose.
 */
export function normalizeIonosError(err: unknown, context: string): RegistrarError {
  if (err instanceof RegistrarError) return err;

  if (!axios.isAxiosError(err)) {
    return new RegistrarError('network', `${context}: ${describe(err)}`, { raw: undefined });
  }

  const status = err.response?.status ?? null;
  const first = firstIonosError(err.response?.data);
  const retryAfter = headerValue(err.response?.headers, 'retry-after');

  if (status === null) {
    return new RegistrarError('network', `${context}: ${err.code ?? err.message}`, {
      raw: { code: err.code, retryAfter },
    });
  }

  const kind = kindForStatus(status);
  const detail = first?.message ?? err.response?.statusText ?? err.message;

  return new RegistrarError(kind, `${context}: ${detail}`, {
    httpStatus: status,
    registrarCode: first?.code ?? null,
    // Only the parsed fields are carried through — never the request config,
    // which holds the X-Api-Key header.
    raw: { message: first?.message, parameters: first?.parameters, retryAfter },
  });
}

function kindForStatus(status: number): RegistrarErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'server';
}

/** Accepts the documented array, a bare object, or neither. */
function firstIonosError(data: unknown): IonosError | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    const candidate = data[0];
    return isIonosError(candidate) ? candidate : null;
  }
  if (isIonosError(data)) return data;
  // HTML, plain text, a Buffer — nothing useful, and definitely not a throw.
  return null;
}

function isIonosError(value: unknown): value is IonosError {
  return typeof value === 'object' && value !== null && ('message' in value || 'code' in value);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const record = headers as Record<string, unknown>;
  const raw = record[name] ?? record[name.toLowerCase()];
  return typeof raw === 'string' ? raw : undefined;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
