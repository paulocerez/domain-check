/**
 * Vercel serverless entry point.
 *
 * vercel.json rewrites every /api/* request here. That rewrite is deliberate
 * rather than a filename catch-all: as `api/[...path].ts` this resolved as a
 * *single* path segment, so /api/health answered while /api/stats/summary 404d
 * at the edge without the function ever running. Vercel leaves the original
 * path on req.url across a rewrite, so the routes the app mounts under /api
 * still line up and nothing here has to re-derive them.
 *
 * It imports the *compiled* backend rather than its TypeScript sources: the
 * backend is a NodeNext project whose relative imports carry .js extensions,
 * which Vercel's esbuild-based bundler will not resolve back to .ts. The build
 * command compiles the backend first, so this always points at real JS.
 */
import { createApp } from '../backend/dist/app.js';
import { db, pool } from '../backend/dist/db/client.js';

export default createApp(db, pool);
