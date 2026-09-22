import type { ExpectedRegistrarDTO } from '@domain-check/shared';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { registrarAccounts } from './schema.js';
import { isMockMode } from '../env.js';
import { explainDbFailure, findDbFailure } from '../lib/dbError.js';
import { logger } from '../lib/logger.js';

/**
 * Creates the registrar account rows a deployment needs, from the credentials
 * present in its environment.
 *
 * This exists because `npm run db:seed` is a laptop command. A Vercel
 * deployment has no laptop: `IONOS_API_KEY` would be set in the project's
 * environment while the database held zero `registrar_accounts` rows, and with
 * no row the app is inert *and silent* — the account list is empty, the cron
 * loops over nothing and answers 200, and the Domains page advises running a
 * sync that cannot start. Setting a credential and redeploying now suffices.
 *
 * Deliberately narrow. It creates *structural* rows without which no feature
 * works; it does not seed `tld_prices` (opinionated content that is not the
 * user's real prices) and it does not run migrations (N instances racing
 * `drizzle migrate` is a worse hazard than the bug this fixes).
 */

export interface RegistrarAccountSpec {
  kind: 'ionos' | 'godaddy';
  label: string;
  /** The env var name stored on the row — never the value. */
  credentialRef: string;
  /** Every var that must be set. GoDaddy's secret is as required as its key. */
  requiredEnv: string[];
  /** Read at call time, not from the `env` snapshot. */
  tenantId(): string | null;
  /**
   * Whether mock mode alone is enough to justify the row. Without this, a dev
   * running MOCK_REGISTRAR=1 with no real key gets zero accounts and an app
   * that cannot sync fixtures either.
   */
  alsoWhenMock?: boolean;
}

export const REGISTRAR_ACCOUNT_SPECS: RegistrarAccountSpec[] = [
  {
    kind: 'ionos',
    label: 'IONOS',
    credentialRef: 'IONOS_API_KEY',
    requiredEnv: ['IONOS_API_KEY'],
    tenantId: () => trimmed('IONOS_TENANT_ID'),
    alsoWhenMock: true,
  },
  {
    kind: 'godaddy',
    label: 'GoDaddy',
    credentialRef: 'GODADDY_API_KEY',
    // Both halves, because a row created from the key alone is permanently
    // half-configured: `isCredentialConfigured` checks both and would report it
    // red forever, sending the user looking everywhere except at the secret.
    requiredEnv: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'],
    tenantId: () => trimmed('GODADDY_SHOPPER_ID'),
  },
];

function trimmed(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function missingEnvFor(spec: RegistrarAccountSpec): string[] {
  return spec.requiredEnv.filter((name) => !trimmed(name));
}

/**
 * What this build supports and what this environment has configured.
 *
 * Pure and DB-free, so the API can report it even when there is no row to
 * report about — which is exactly the state that used to render silence.
 */
export function describeExpectedRegistrars(): ExpectedRegistrarDTO[] {
  return REGISTRAR_ACCOUNT_SPECS.map((spec) => {
    const missingEnv = missingEnvFor(spec);
    return {
      kind: spec.kind,
      label: spec.label,
      requiredEnv: spec.requiredEnv,
      configured: missingEnv.length === 0,
      missingEnv,
    };
  });
}

export interface ProvisionSummary {
  created: Array<{ kind: string; label: string }>;
  skipped: Array<{ kind: string; label: string; missingEnv: string[] }>;
  /** Total account rows afterwards, including any the user seeded by hand. */
  accounts: number;
}

/**
 * Idempotent, and safe to race.
 *
 * `registrar_accounts_kind_label_key` is a real unique index, so
 * `on conflict do nothing` is the concurrency control — no advisory lock, which
 * would pin one of only two pooled connections per cold start on Vercel and
 * needs a session-mode endpoint besides.
 *
 * Throws on database failure. Callers decide what that means: the CLI should
 * fail loudly, a request should not.
 */
export interface ProvisionOptions {
  /**
   * Overrides the `MOCK_REGISTRAR` reading. `isMockMode` is a module-load
   * snapshot in env.ts, so `vi.stubEnv` cannot move it — tests need a seam to
   * exercise both branches deterministically.
   */
  mockMode?: boolean;
}

export async function provisionRegistrarAccounts(
  db: Database,
  options: ProvisionOptions = {},
): Promise<ProvisionSummary> {
  const mockMode = options.mockMode ?? isMockMode;
  const wanted: RegistrarAccountSpec[] = [];
  const skipped: ProvisionSummary['skipped'] = [];

  for (const spec of REGISTRAR_ACCOUNT_SPECS) {
    const missingEnv = missingEnvFor(spec);
    if (missingEnv.length === 0 || (spec.alsoWhenMock && mockMode)) wanted.push(spec);
    else skipped.push({ kind: spec.kind, label: spec.label, missingEnv });
  }

  let created: ProvisionSummary['created'] = [];
  if (wanted.length > 0) {
    // One statement for every spec, so a cold start costs a single round trip.
    const rows = await db
      .insert(registrarAccounts)
      .values(
        wanted.map((spec) => ({
          kind: spec.kind,
          label: spec.label,
          credentialRef: spec.credentialRef,
          tenantId: spec.tenantId(),
        })),
      )
      .onConflictDoNothing({ target: [registrarAccounts.kind, registrarAccounts.label] })
      .returning({ kind: registrarAccounts.kind, label: registrarAccounts.label });
    created = rows;
  }

  const [counted] = await db
    .select({ accounts: sql<number>`count(*)::int` })
    .from(registrarAccounts);

  const summary: ProvisionSummary = { created, skipped, accounts: counted?.accounts ?? 0 };
  if (created.length > 0 || skipped.length > 0) {
    // Logged on the first cold start of every instance, so the deployment log
    // reads `skipped: [{ godaddy, missingEnv: [...] }]` without anyone asking.
    logger.info({ created, skipped, accounts: summary.accounts }, 'registrar accounts provisioned');
  }
  return summary;
}

/**
 * How long to wait before retrying after a failure.
 *
 * Retrying per request would hammer an unreachable database once for every
 * page load; never retrying would need a redeploy to recover from a transient
 * outage. Exported so tests can assert the cooldown rather than sleep.
 */
export const PROVISION_RETRY_COOLDOWN_MS = 10_000;

let inFlight: Promise<ProvisionSummary> | null = null;
let lastFailureAt = 0;

/**
 * The request-path wrapper: memoized per process, cooldown-guarded, and it
 * never throws.
 *
 * A provisioning failure must not turn a working request into a 500 — the
 * feature is a convenience, and the diagnostics belong in the log.
 */
export async function ensureRegistrarAccounts(
  db: Database,
  options: ProvisionOptions = {},
): Promise<ProvisionSummary | null> {
  if (inFlight) return inFlight.catch(() => null);
  if (lastFailureAt > 0 && Date.now() - lastFailureAt < PROVISION_RETRY_COOLDOWN_MS) return null;

  const attempt = provisionRegistrarAccounts(db, options);
  inFlight = attempt;
  try {
    return await attempt;
  } catch (err) {
    // Drop the cache so the next request past the cooldown tries again.
    inFlight = null;
    lastFailureAt = Date.now();
    // Through `findDbFailure`, not `err.code`: Drizzle wraps the driver error,
    // so reading the code off the top-level error found `undefined` and this
    // hint never once fired.
    //
    // This is the first write of every cold start, and it is swallowed by
    // design — which means it is also the earliest warning that the database
    // cannot be written to at all. It has to name the reason, or the next
    // symptom is a 500 from "Sync now" with a query dump for a message.
    const failure = findDbFailure(err);
    logger.warn(
      { err, db: failure ?? undefined },
      failure
        ? `could not provision registrar accounts: ${explainDbFailure(failure) ?? failure.message}`
        : 'could not provision registrar accounts',
    );
    return null;
  }
}

/** Test-only: forget the memoized result. */
export function resetProvisioningCache(): void {
  inFlight = null;
  lastFailureAt = 0;
}

/**
 * No registrar can be synced, and the reason is the environment.
 *
 * Distinct from `RegistrarError` because there is no registrar to have erred:
 * nothing is configured at all. Mapped to a 400 with an actionable message, so
 * pressing "Sync now" says what to set instead of "Internal error".
 */
export class NoRegistrarConfiguredError extends Error {
  constructor(
    message: string,
    readonly missingEnv: string[],
  ) {
    super(message);
    this.name = 'NoRegistrarConfiguredError';
  }
}

/** The remediation sentence, in one place — it appears in three messages. */
export function credentialAdvice(): string {
  const options = REGISTRAR_ACCOUNT_SPECS.map((spec) => spec.requiredEnv.join(' and ')).join(', or ');
  return `Set ${options} in this deployment's environment and redeploy.`;
}
