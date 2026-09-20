import type { ApiResponse } from '@domain-check/shared';

/**
 * Thin fetch wrapper over the `{ok, data} | {ok, error}` envelope.
 *
 * Same-origin `/api/...` by default: the Vite dev server proxies it to the API
 * process, and when the backend serves this bundle itself there is no base URL
 * to configure and no CORS to get wrong.
 *
 * Set `VITE_API_URL` to point at a backend on a different origin — the case
 * when the frontend is on a CDN and the API lives elsewhere (e.g. reached over
 * a private tailnet). It must be an https:// origin: a page served over HTTPS
 * cannot call an http:// backend, the browser blocks it as mixed content.
 */

/** Trailing slash trimmed so `${API_BASE}/api` never becomes a double slash. */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T, M = undefined>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: M | undefined }> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (response.status === 204) return { data: undefined as T, meta: undefined };

  let payload: ApiResponse<T, M>;
  try {
    payload = (await response.json()) as ApiResponse<T, M>;
  } catch {
    // A non-JSON body means something upstream of the API answered — a proxy
    // error page, or the dev server with no backend running.
    throw new ApiError(
      'INTERNAL',
      `The server returned ${response.status} with a non-JSON body. Is the API running${
        API_BASE ? ` at ${API_BASE}` : ''
      }?`,
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ApiError(payload.error.code, payload.error.message, response.status, payload.error.details);
  }

  return { data: payload.data, meta: payload.meta };
}

export const api = {
  get: <T, M = undefined>(path: string, signal?: AbortSignal) => request<T, M>(path, { signal }),
  post: <T, M = undefined>(path: string, body?: unknown) => request<T, M>(path, { method: 'POST', body }),
  patch: <T, M = undefined>(path: string, body: unknown) => request<T, M>(path, { method: 'PATCH', body }),
  put: <T, M = undefined>(path: string, body: unknown) => request<T, M>(path, { method: 'PUT', body }),
  del: <T, M = undefined>(path: string) => request<T, M>(path, { method: 'DELETE' }),
};

/** Builds a query string, flattening array params into repeated keys. */
export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) if (entry !== undefined && entry !== null) search.append(key, String(entry));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
