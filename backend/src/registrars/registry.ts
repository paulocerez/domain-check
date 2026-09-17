import type { RegistrarAccountRow } from '../db/schema.js';
import { env, isMockMode } from '../env.js';
import { IonosRegistrar } from './ionos/client.js';
import { MockRegistrar } from './mock/index.js';
import type { Registrar } from './types.js';
import { RegistrarError } from './types.js';

/**
 * Builds the adapter for an account.
 *
 * The account row stores the *name* of the environment variable holding the
 * key (`credential_ref`), never the key. Resolution happens here, at the last
 * possible moment, so secrets never enter the database or any DTO.
 */
export function createRegistrar(account: RegistrarAccountRow): Registrar {
  if (isMockMode || account.kind === 'mock') {
    return new MockRegistrar({ failureMode: env.MOCK_FAILURE_MODE });
  }

  switch (account.kind) {
    case 'ionos': {
      const apiKey = resolveCredential(account.credentialRef);
      return new IonosRegistrar({
        apiKey,
        tenantId: account.tenantId,
        baseUrl: env.IONOS_BASE_URL,
        debug: env.DEBUG_REGISTRAR,
      });
    }
    default:
      throw new RegistrarError('config', `No adapter for registrar kind "${account.kind}"`);
  }
}

/**
 * Reports the real state of the environment variable, even in mock mode.
 *
 * Claiming the key is present because fixtures are in use would hide exactly
 * the thing the user needs to fix before switching to live data. Mock mode is
 * surfaced separately, via `/api/health`.
 */
export function isCredentialConfigured(account: RegistrarAccountRow): boolean {
  if (account.kind === 'mock') return true;
  return Boolean(process.env[account.credentialRef]?.trim());
}

function resolveCredential(credentialRef: string): string {
  const value = process.env[credentialRef]?.trim();
  if (!value) {
    throw new RegistrarError(
      'config',
      `${credentialRef} is not set. Add it to .env, or set MOCK_REGISTRAR=1 to run against fixtures.`,
    );
  }
  return value;
}

/** Capabilities without constructing a client (which would need credentials). */
export function capabilitiesFor(kind: string) {
  if (kind === 'ionos') return new IonosRegistrar({ apiKey: 'placeholder' }).capabilities;
  return new MockRegistrar().capabilities;
}
