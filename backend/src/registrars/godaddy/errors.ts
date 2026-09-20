import axios from 'axios';
import { RegistrarError, type RegistrarErrorKind } from '../types.js';
import type { GodaddyError } from './types.js';

/**
 * Turns anything axios can throw into a `RegistrarError`.
 *
 * Shaped like `normalizeIonosError`, with three real differences: the body is a
 * single object rather than an array, 422 is GoDaddy's usual validation status,
 * and the rate-limit hint can arrive in the body as `retryAfterSec` when the
 * `Retry-After` header is missing. As there, everything is defensive on purpose
 * — a 502 from a proxy in front of GoDaddy arrives as HTML, and a parser that
 * throws while handling an error turns an outage into an opaque stack trace.
 */
export function normalizeGodaddyError(err: unknown, context: string): RegistrarError {
  if (err instanceof RegistrarError) return err;

  if (!axios.isAxiosError(err)) {
    return new RegistrarError('network', `${context}: ${describe(err)}`, { raw: undefined });
  }

  const status = err.response?.status ?? null;
  const body = godaddyError(err.response?.data);
  const retryAfter = retryAfterFrom(err.response?.headers, body);

  if (status === null) {
    return new RegistrarError('network', `${context}: ${err.code ?? err.message}`, {
      raw: { code: err.code, retryAfter },
    });
  }

  const kind = kindForStatus(status);
  const detail = body?.message ?? err.response?.statusText ?? err.message;

  return new RegistrarError(kind, `${context}: ${detail}`, {
    httpStatus: status,
    registrarCode: body?.code ?? null,
    // Only the parsed fields are carried through — never the request config,
    // which holds the `Authorization: sso-key <key>:<secret>` header.
    raw: { message: body?.message, fields: body?.fields, retryAfter },
  });
}

function kindForStatus(status: number): RegistrarErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  // 422 is GoDaddy's workhorse validation status; 400 is comparatively rare.
  if (status >= 400) return 'bad_request';
  return 'server';
}

/**
 * `withRetry` reads `raw.retryAfter` as a string and accepts both the seconds
 * and HTTP-date forms, so the body's numeric hint is stringified to match
 * rather than given a second code path.
 */
function retryAfterFrom(headers: unknown, body: GodaddyError | null): string | undefined {
  const header = headerValue(headers, 'retry-after');
  if (header) return header;
  if (typeof body?.retryAfterSec === 'number' && Number.isFinite(body.retryAfterSec)) {
    return String(body.retryAfterSec);
  }
  return undefined;
}

/** Accepts the documented object; tolerates HTML, plain text and arrays. */
function godaddyError(data: unknown): GodaddyError | null {
  if (!data) return null;
  // Not documented, but cheap to survive if GoDaddy ever wraps errors in a list.
  if (Array.isArray(data)) return isGodaddyError(data[0]) ? data[0] : null;
  if (isGodaddyError(data)) return data;
  return null;
}

function isGodaddyError(value: unknown): value is GodaddyError {
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
