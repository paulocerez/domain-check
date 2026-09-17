import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type pg from 'pg';
import type { Database } from './db/client.js';
import { isProduction } from './env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRoutes } from './routes/index.js';

export const APP_VERSION = '1.0.0';

/**
 * Builds the Express app.
 *
 * Exported as a factory so the integration tests can mount it against a test
 * database with supertest, without binding a port.
 */
export function createApp(db: Database, pool: pg.Pool): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // In development the Vite dev server proxies /api to this process, so
  // requests are same-origin and CORS is only relevant if someone points a
  // separate tool at the port.
  app.use(cors({ origin: isProduction ? false : true }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createRoutes(db, pool, APP_VERSION));

  if (isProduction) {
    // One process, one port: the API and the built SPA are served together.
    const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      // Anything under /api that got this far is a genuine 404, not a route
      // for the client-side router to try to render.
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
  });

  app.use(errorHandler);

  return app;
}
