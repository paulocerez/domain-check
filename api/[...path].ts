/**
 * Vercel serverless entry point.
 *
 * A catch-all so every /api/* request reaches the same Express app. The app
 * already mounts its routes under /api and Vercel leaves the full path on
 * req.url, so the two line up without rewriting anything.
 *
 * It imports the *compiled* backend rather than its TypeScript sources: the
 * backend is a NodeNext project whose relative imports carry .js extensions,
 * which Vercel's esbuild-based bundler will not resolve back to .ts. The build
 * command compiles the backend first, so this always points at real JS.
 */
import { createApp } from '../backend/dist/app.js';
import { db, pool } from '../backend/dist/db/client.js';

export default createApp(db, pool);
