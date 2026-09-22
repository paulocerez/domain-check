import { useHealth, useRegistrarAccounts, useSyncStatus } from '@/api/hooks';

/**
 * Why the app has nothing to show, and what to do about it.
 *
 * Five states used to render one sentence — "Run a sync to pull your portfolio
 * from the registrar" — including the two cases where running a sync is
 * impossible. The distinction lives here rather than in each page so the
 * remediation copy has one definition; the Domains, Sync and Settings pages and
 * the shell all read the same answer.
 */

export type SetupState =
  /** No account row at all: this environment holds no registrar credentials. */
  | 'no-accounts'
  /** Rows exist, but not one has its credentials set here. */
  | 'credentials-missing'
  /** Ready to sync, and no sync has ever been attempted. */
  | 'never-synced'
  /** The last sync failed or came back incomplete. */
  | 'sync-failed'
  /** Synced cleanly and the registrar genuinely reported nothing. */
  | 'synced-empty'
  /** Configured, synced, and there is data to show. */
  | 'ready';

export interface SetupAdvice {
  state: SetupState;
  title: string;
  description: string;
  /** True when pressing "Sync now" can only produce an error. */
  syncBlocked: boolean;
  /** The env vars to set, when that is the problem. */
  missingEnv: string[];
}

/**
 * A new environment variable on Vercel is only visible to a *new* deployment,
 * which is the single most common reason a key that "is set" appears not to be.
 */
const REDEPLOY_NOTE =
  'On Vercel a newly added environment variable only reaches a new deployment, so redeploy after setting it.';

export function useSetupState(): SetupAdvice {
  const health = useHealth();
  const accounts = useRegistrarAccounts();
  const syncStatus = useSyncStatus();

  const accountCount = health.data?.registrarAccounts;
  const readyCount = health.data?.registrarAccountsReady;
  const syncRuns = health.data?.syncRuns;
  const lastRun = syncStatus.data?.lastRun ?? null;

  // Until health has answered, assume everything is fine: flashing "nothing is
  // configured" during the first load would be a lie most of the time.
  if (accountCount === undefined || accountCount === null) return ready();

  const missingEnv = accounts.data?.expected.flatMap((entry) => entry.missingEnv) ?? [];
  const envList = formatList(unique(missingEnv));

  if (accountCount === 0) {
    return {
      state: 'no-accounts',
      title: 'No registrar is configured',
      description:
        `This deployment has no registrar credentials, so there is nothing to sync. ` +
        `Set ${describeOptions(accounts.data?.expected)} in its environment. ${REDEPLOY_NOTE}`,
      syncBlocked: true,
      missingEnv: unique(missingEnv),
    };
  }

  if (readyCount === 0) {
    // A row exists — someone configured this once — but the key is not here.
    const labels = accounts.data?.rows.map((row) => row.label).join(', ') ?? 'The registrar account';
    return {
      state: 'credentials-missing',
      title: envList ? `${envList} is not set` : 'Registrar credentials are missing',
      description:
        `${labels} is set up, but its credentials are not present in this environment. ` +
        `${REDEPLOY_NOTE}`,
      syncBlocked: true,
      missingEnv: unique(missingEnv),
    };
  }

  if (syncRuns === 0) {
    return {
      state: 'never-synced',
      title: 'Nothing synced yet',
      description: `${readyLabel(accounts.data?.rows)} is configured. Run a sync to pull the portfolio.`,
      syncBlocked: false,
      missingEnv: [],
    };
  }

  if (lastRun && (lastRun.status === 'failed' || lastRun.status === 'partial')) {
    return {
      state: 'sync-failed',
      title: lastRun.status === 'failed' ? 'The last sync did not complete' : 'The last sync was incomplete',
      description: lastRun.errorMessage ?? 'Open the Sync page for this run’s details.',
      syncBlocked: false,
      missingEnv: [],
    };
  }

  if (lastRun && lastRun.status === 'success' && lastRun.domainsSeen === 0) {
    return {
      state: 'synced-empty',
      title: `${lastRun.registrarLabel} returned 0 domains for this API key`,
      description:
        'The credentials work, but the account reported no domains. Check that the key belongs to the ' +
        'contract holding your portfolio, and whether a tenant id is required.',
      syncBlocked: false,
      missingEnv: [],
    };
  }

  return ready();
}

function ready(): SetupAdvice {
  return {
    state: 'ready',
    title: 'No domains yet',
    description: 'Run a sync to pull your portfolio from the registrar.',
    syncBlocked: false,
    missingEnv: [],
  };
}

function readyLabel(rows: Array<{ label: string; credentialConfigured: boolean }> | undefined): string {
  const configured = rows?.filter((row) => row.credentialConfigured).map((row) => row.label) ?? [];
  return configured.length > 0 ? configured.join(', ') : 'The registrar';
}

/** "IONOS_API_KEY, or GODADDY_API_KEY and GODADDY_API_SECRET" */
function describeOptions(expected: Array<{ requiredEnv: string[] }> | undefined): string {
  if (!expected || expected.length === 0) return 'a registrar API key';
  return expected.map((entry) => formatList(entry.requiredEnv)).join(', or ');
}

function formatList(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]!}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
