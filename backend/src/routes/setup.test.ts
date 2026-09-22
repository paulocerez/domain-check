import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `isMockMode` and `env.CRON_SECRET` are module-load snapshots, so `stubEnv`
 * cannot move them — and this file is specifically about the live-registrar
 * deployment, where mock mode would mask every one of these states by making
 * a credential-less account look syncable.
 */
vi.mock('../env.js', async () => {
  const actual = await vi.importActual<typeof import('../env.js')>('../env.js');
  return { ...actual, isMockMode: false, env: { ...actual.env, CRON_SECRET: 'cron-secret' } };
});

import { createApp } from '../app.js';
import { resetProvisioningCache } from '../db/provision.js';
import { registrarAccounts } from '../db/schema.js';
import { createHarness, resetDatabase, type TestHarness } from '../test/helpers.js';

/**
 * The deployment story, end to end over HTTP.
 *
 * The bug these lock in: with `IONOS_API_KEY` set in a Vercel project but no
 * `registrar_accounts` row, every surface answered as though nothing were
 * wrong — an empty account list, a generic 500 from "Sync now", and a cron that
 * reported `200 {runs: []}` every morning while doing nothing.
 */

let harness: TestHarness;
let app: Express;

beforeAll(async () => {
  harness = await createHarness();
  app = createApp(harness.db, harness.pool);
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetDatabase(harness.db);
  resetProvisioningCache();
  vi.stubEnv('IONOS_API_KEY', '');
  vi.stubEnv('GODADDY_API_KEY', '');
  vi.stubEnv('GODADDY_API_SECRET', '');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('with a credential in the environment and an empty database', () => {
  beforeEach(() => {
    vi.stubEnv('IONOS_API_KEY', 'prefix.secret');
  });

  it('creates the account on the first request that needs one', async () => {
    const response = await request(app).get('/api/registrar-accounts').expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      kind: 'ionos',
      credentialRef: 'IONOS_API_KEY',
      credentialConfigured: true,
    });
    expect(response.body.meta.noCredentials).toBe(false);

    // Provisioning has to be *awaited* by the middleware: fire-and-forget would
    // let this first response race the insert and answer [] on a cold start.
    expect(await harness.db.select().from(registrarAccounts)).toHaveLength(1);
  });

  it('reports the account in the health counters', async () => {
    await request(app).get('/api/registrar-accounts').expect(200);
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body.data).toMatchObject({
      registrarAccounts: 1,
      registrarAccountsReady: 1,
      syncRuns: 0,
    });
  });
});

describe('with no registrar credentials at all', () => {
  it('names the missing variable instead of listing nothing', async () => {
    const response = await request(app).get('/api/registrar-accounts').expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.meta.noCredentials).toBe(true);
    expect(response.body.meta.expected).toEqual([
      { kind: 'ionos', label: 'IONOS', requiredEnv: ['IONOS_API_KEY'], configured: false, missingEnv: ['IONOS_API_KEY'] },
      {
        kind: 'godaddy',
        label: 'GoDaddy',
        requiredEnv: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'],
        configured: false,
        missingEnv: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'],
      },
    ]);
  });

  it('rejects a manual sync with an actionable 400, not a generic 500', async () => {
    const response = await request(app).post('/api/sync').send({ mode: 'full' }).expect(400);

    expect(response.body.error.code).toBe('REGISTRAR_AUTH');
    expect(response.body.error.message).toContain('IONOS_API_KEY');
    expect(response.body.error.details.missingEnv).toContain('IONOS_API_KEY');
  });

  it('fails the scheduled sync instead of reporting an empty success', async () => {
    const response = await request(app)
      .get('/api/cron/sync')
      .set('Authorization', 'Bearer cron-secret')
      .expect(400);

    expect(response.body.error.code).toBe('REGISTRAR_AUTH');
    expect(response.body.error.message).toContain('IONOS_API_KEY');
  });

  it('still checks the cron credential first', async () => {
    await request(app).get('/api/cron/sync').expect(401);
    await request(app).get('/api/cron/sync').set('Authorization', 'Bearer wrong').expect(401);
  });
});

describe('when an account exists but its credentials do not', () => {
  beforeEach(async () => {
    await harness.db
      .insert(registrarAccounts)
      .values({ kind: 'ionos', label: 'IONOS', credentialRef: 'IONOS_API_KEY' });
  });

  it('says the key is missing rather than deleting the account', async () => {
    const response = await request(app).get('/api/registrar-accounts').expect(200);

    // The row keeps its domains. A temporarily absent variable is a state to
    // report, never a reason to remove data.
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].credentialConfigured).toBe(false);

    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.data).toMatchObject({ registrarAccounts: 1, registrarAccountsReady: 0 });
  });

  it('rejects a sync naming the environment as the problem', async () => {
    const response = await request(app).post('/api/sync').send({ mode: 'full' }).expect(400);

    expect(response.body.error.code).toBe('REGISTRAR_AUTH');
    expect(response.body.error.message).toContain('IONOS');
    expect(response.body.error.message).toContain('not set in this environment');
  });
});

describe('/api/health', () => {
  it('answers without waiting on provisioning', async () => {
    // Registered before the provisioning middleware on purpose, so the one
    // endpoint that must work while the database is broken cannot be blocked by
    // it. This is the guarantee a future route reorder would silently break.
    const insert = vi.spyOn(harness.db, 'insert');
    try {
      await request(app).get('/api/health').expect(200);
      expect(insert).not.toHaveBeenCalled();
    } finally {
      insert.mockRestore();
    }
  });
});
