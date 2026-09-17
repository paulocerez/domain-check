import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The sync path is deliberately chatty; at info level it buries the results.
    env: { LOG_LEVEL: 'silent', NODE_ENV: 'test' },
    // Integration tests share one Postgres database and truncate between
    // cases, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
