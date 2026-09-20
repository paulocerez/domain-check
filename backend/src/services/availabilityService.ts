import type { DomainAvailabilityDTO } from '@domain-check/shared';
import { eq, inArray, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { domains, registrarAccounts, type RegistrarAccountRow } from '../db/schema.js';
import { isMockMode } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { capabilitiesFor, createRegistrar, isCredentialConfigured } from '../registrars/registry.js';

/**
 * Availability lookups for names the user does not own.
 *
 * Unlike every other service here this one is not scoped to a stored portfolio
 * — it borrows whichever configured account happens to be able to answer. The
 * portfolio is still consulted once, to say "you already own this", which is
 * the one thing this app can add on top of a raw registrar answer.
 */

/**
 * Picks the account that will answer.
 *
 * Capability first, then credentials: an account that *could* answer but has no
 * key is a configuration problem worth reporting, not a reason to silently fall
 * through to a different registrar and give an answer from somewhere the user
 * did not expect.
 *
 * Mock mode is checked ahead of both, because `createRegistrar` hands back the
 * fixture adapter for *every* account when it is on — so the account's own kind
 * and credentials say nothing about what will actually answer. Without this the
 * availability page would be dead in exactly the mode that exists to let you
 * use the app without credentials.
 */
export async function findAvailabilityAccount(db: Database): Promise<RegistrarAccountRow | null> {
  const accounts = await db
    .select()
    .from(registrarAccounts)
    .where(eq(registrarAccounts.isEnabled, true));

  if (isMockMode) return accounts[0] ?? null;

  return (
    accounts.find(
      (account) => capabilitiesFor(account.kind).availability && isCredentialConfigured(account),
    ) ?? null
  );
}

export async function checkAvailability(
  db: Database,
  names: string[],
): Promise<DomainAvailabilityDTO[]> {
  const account = await findAvailabilityAccount(db);
  if (!account) {
    throw new HttpError(
      400,
      'REGISTRAR_AUTH',
      'No registrar account can check availability. Add a GoDaddy account with GODADDY_API_KEY and GODADDY_API_SECRET set, or set MOCK_REGISTRAR=1 to try it against fixtures.',
    );
  }

  const registrar = createRegistrar(account);
  if (!registrar.checkAvailability) {
    // Only reachable if an adapter's capability flag and its methods disagree.
    throw new HttpError(
      400,
      'REGISTRAR_AUTH',
      `The ${account.label} adapter reports availability support but does not implement it.`,
    );
  }

  const results = await registrar.checkAvailability(names);
  const owned = await ownedIdsByName(db, names);

  return results.map((result) => ({
    name: result.name,
    available: result.available,
    definitive: result.definitive,
    priceCents: result.priceCents,
    currency: result.currency,
    periodYears: result.periodYears,
    error: result.error,
    ownedDomainId: owned.get(result.name) ?? null,
  }));
}

/**
 * Which of these names are already tracked, across every account.
 *
 * Deliberately not scoped to the account that answered: the useful question is
 * "is this in my portfolio at all", and a name held at IONOS would otherwise be
 * reported as merely unavailable when GoDaddy answered.
 */
async function ownedIdsByName(db: Database, names: string[]): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();

  // Matched on both columns: an IDN is stored under its unicode name but the
  // user is as likely to paste the punycode form, and either should count as
  // "you already own this".
  const rows = await db
    .select({ id: domains.id, name: domains.name, encodedName: domains.encodedName })
    .from(domains)
    .where(or(inArray(domains.name, names), inArray(domains.encodedName, names)));

  const byName = new Map<string, string>();
  for (const row of rows) {
    byName.set(row.name, row.id);
    if (row.encodedName) byName.set(row.encodedName, row.id);
  }
  return byName;
}
