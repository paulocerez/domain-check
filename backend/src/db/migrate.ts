import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Exported so the integration tests can migrate their own database.
 *
 * Always reports the database it is about to touch. Migrations are the one
 * place where pointing at the wrong server does real damage, and a one-line
 * "migrations applied" tells you nothing about *where*.
 */
export async function runMigrations(connectionString = env.DATABASE_URL) {
  const pool = createPool(connectionString);
  try {
    const { rows } = await pool.query<{ db: string; usr: string; port: number }>(
      'select current_database() as db, current_user as usr, inet_server_port() as port',
    );
    const target = rows[0];
    logger.info({ database: target?.db, user: target?.usr, port: target?.port }, 'applying migrations');
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const target = process.env.MIGRATE_TARGET === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  if (!target) {
    logger.error('MIGRATE_TARGET=test requires TEST_DATABASE_URL to be set');
    process.exit(1);
  }
  runMigrations(target)
    .then(() => {
      logger.info('migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      process.exit(1);
    });
}
