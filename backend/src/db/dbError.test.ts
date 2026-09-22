import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { findDbFailure, sqlState } from '../lib/dbError.js';
import { translate } from '../middleware/errorHandler.js';
import { registrarAccounts, syncRuns } from './schema.js';
import { createHarness, resetDatabase, type TestHarness } from '../test/helpers.js';

/**
 * Against a real Postgres and a real Drizzle, because the whole point is what
 * the driver actually throws. The unit tests fabricate the wrapper; these prove
 * the fabrication matches reality, and will fail if Drizzle ever moves the
 * driver error off `cause`.
 */

let harness: TestHarness;

beforeAll(async () => {
  harness = await createHarness();
  await resetDatabase(harness.db);
});

afterAll(async () => {
  await resetDatabase(harness.db);
  await harness.close();
});

describe('findDbFailure, through the driver', () => {
  it('recovers 42P01 from a missing relation', async () => {
    const err = await harness.db
      .execute(sql`select * from definitely_not_a_table`)
      .catch((caught: unknown) => caught);

    expect(sqlState(err)).toBe('42P01');
    expect(translate(err).status).toBe(503);
    expect(translate(err).body.error.code).toBe('DB_NOT_READY');
  });

  it('recovers 23503 from the sync_runs foreign key, with its constraint', async () => {
    // Exactly the insert that produced the opaque 500, with an account id that
    // is not there.
    const err = await harness.db
      .insert(syncRuns)
      .values({
        registrarAccountId: '5c3c9d19-a6ec-4ac4-a184-e004e7784435',
        mode: 'full',
        trigger: 'manual',
        status: 'running',
      })
      .catch((caught: unknown) => caught);

    const failure = findDbFailure(err);
    expect(failure?.code).toBe('23503');
    expect(failure?.constraint).toContain('sync_runs');

    const { status, body } = translate(err);
    expect(status).toBe(409);
    // The id it complained about must not travel back to the client.
    expect(JSON.stringify(body)).not.toContain('5c3c9d19');
  });

  it('recovers 23505 from a unique index', async () => {
    const row = { kind: 'ionos' as const, label: 'IONOS', credentialRef: 'IONOS_API_KEY' };
    await harness.db.insert(registrarAccounts).values(row);
    const err = await harness.db
      .insert(registrarAccounts)
      .values(row)
      .catch((caught: unknown) => caught);

    expect(sqlState(err)).toBe('23505');
    expect(translate(err).status).toBe(409);
  });
});
