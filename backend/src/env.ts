import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// .env lives at the repo root, one level above backend/.
//
// `override: true` is deliberate and important. Developer shells commonly
// export a DATABASE_URL for whatever project they last worked on, and dotenv's
// default is to leave existing process.env values alone — so this repo's .env
// would be silently ignored and migrations would run against someone else's
// database. The file on disk always wins; to point at a different database,
// edit .env or pass DATABASE_URL explicitly to the command.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), override: true });

const booleanish = z
  .enum(['0', '1', 'true', 'false', ''])
  .default('0')
  .transform((value) => value === '1' || value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — run `npm run db:up` and copy .env.example'),
  TEST_DATABASE_URL: z.string().optional(),

  IONOS_API_KEY: z.string().optional(),
  IONOS_TENANT_ID: z.string().optional(),
  IONOS_BASE_URL: z.string().url().default('https://api.hosting.ionos.com/domains'),
  IONOS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),

  MOCK_REGISTRAR: booleanish,
  MOCK_FAILURE_MODE: z.enum(['429', '401', 'partial', 'slow', '']).default(''),
  DEBUG_REGISTRAR: booleanish,

  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
});

function load() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Fail fast and loudly: a half-configured server that boots and then throws
    // on the first request is far harder to diagnose than this.
    console.error(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

export type Env = typeof env;

/** True when we should talk to fixtures rather than a real registrar API. */
export const isMockMode = env.MOCK_REGISTRAR;

export const isProduction = env.NODE_ENV === 'production';
