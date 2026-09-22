import pg from 'pg';

/**
 * Finds the Postgres error that a Drizzle error is hiding.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message is
 * `Failed query: <sql>\nparams: <values>` and whose `cause` holds the real
 * error — the one carrying the SQLSTATE, the constraint and the table. Nothing
 * in this app used to read that cause, so the single most likely deployment
 * failure (a database that is not what the code assumes) surfaced as a 500
 * quoting the statement and saying nothing about why it failed. A read-only
 * connection string, an unmigrated schema and a missing GRANT were all the same
 * opaque sentence.
 *
 * Everything here is pure and dependency-light on purpose: `db/client.ts` and
 * `db/provision.ts` import it, so it must not import them, nor the logger.
 */

/** A driver error recovered from an error's `cause` chain. */
export interface DbFailure {
  /** SQLSTATE ('42P01'), or a socket error code ('ECONNREFUSED'). */
  code: string;
  message: string;
  /**
   * Postgres' elaboration — e.g. `Key (registrar_account_id)=(5c3c…) is not
   * present in table "registrar_accounts"`. It quotes row values, so it belongs
   * in a log and never in an HTTP response.
   */
  detail?: string;
  table?: string;
  constraint?: string;
  schema?: string;
  routine?: string;
}

/** Socket-level failures, which carry a code but no SQLSTATE. */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
]);

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * How far to follow `cause`. Drizzle nests exactly one level today; the loop
 * exists so that a future wrapper — theirs or ours — cannot silently put this
 * back to square one.
 */
const MAX_DEPTH = 8;

function toFailure(node: object): DbFailure | null {
  const candidate = node as Partial<pg.DatabaseError> & { code?: unknown; message?: unknown };
  const code = candidate.code;
  if (typeof code !== 'string') return null;

  // `instanceof` is the exact test and is tried first, but it fails whenever two
  // copies of `pg` end up installed in a workspace — so the shape is also
  // accepted on its own terms. A five-character SQLSTATE or a known socket code
  // is specific enough that nothing else in this app collides with it.
  if (!(node instanceof pg.DatabaseError) && !SQLSTATE.test(code) && !CONNECTION_CODES.has(code)) {
    return null;
  }

  return {
    code,
    message: typeof candidate.message === 'string' ? candidate.message : '',
    ...(candidate.detail ? { detail: candidate.detail } : {}),
    ...(candidate.table ? { table: candidate.table } : {}),
    ...(candidate.constraint ? { constraint: candidate.constraint } : {}),
    ...(candidate.schema ? { schema: candidate.schema } : {}),
    ...(candidate.routine ? { routine: candidate.routine } : {}),
  };
}

/** Walks `cause`, cycle- and depth-guarded, for the underlying driver error. */
export function findDbFailure(err: unknown): DbFailure | null {
  const seen = new Set<object>();
  let node: unknown = err;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (typeof node !== 'object' || node === null) return null;
    // A cause cycle is pathological but cheap to survive, and an infinite loop
    // inside an error handler would replace a bad error message with a hang.
    if (seen.has(node)) return null;
    seen.add(node);

    const failure = toFailure(node);
    if (failure) return failure;

    node = (node as { cause?: unknown }).cause;
  }
  return null;
}

/** The SQLSTATE alone, for call sites that only branch on it. */
export function sqlState(err: unknown): string | null {
  return findDbFailure(err)?.code ?? null;
}

/**
 * Removes Drizzle's `params:` tail.
 *
 * Those are the literal bound values. Harmless in a log, wrong in an HTTP body
 * and wrong in `sync_runs.error_message`, which the sync-history UI renders.
 */
export function stripQueryParams(message: string): string {
  return message.replace(/\n\s*params:[\s\S]*$/, '');
}

/**
 * One actionable sentence per SQLSTATE we can actually act on.
 *
 * Lives here rather than in the HTTP layer because `db:check` and the
 * provisioning log want the same words; three copies would drift.
 */
export function explainDbFailure(failure: DbFailure): string | null {
  const where = failure.table ? ` on "${failure.table}"` : '';

  switch (failure.code) {
    case '25006':
    case '25P02':
      return (
        'The database connection is read-only, so nothing can be written. ' +
        'Check that DATABASE_URL (and DATABASE_URL_UNPOOLED, which takes precedence) ' +
        'points at the primary endpoint rather than a read replica.'
      );
    case '42P01':
    case '42703':
    case '3F000':
      return (
        `The schema is not migrated for this database (${failure.message}). ` +
        'Point DATABASE_URL at it and run `npm run db:migrate`.'
      );
    case '42501':
      return (
        `The database role lacks the privileges it needs${where}. ` +
        'Run `npm run db:check` against this DATABASE_URL — it names the missing grants.'
      );
    case '23503':
      return `A referenced row does not exist (${failure.constraint ?? 'foreign key'}${where}).`;
    case '23505':
      return `That already exists (${failure.constraint ?? 'unique constraint'}${where}).`;
    case '53300':
    case '57P03':
      return 'The database is not accepting connections right now. Retry shortly.';
    default:
      if (CONNECTION_CODES.has(failure.code) || failure.code.startsWith('08')) {
        return `Could not reach the database (${failure.code}).`;
      }
      return null;
  }
}
