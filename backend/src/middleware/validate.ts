import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TypeOf, ZodTypeAny } from 'zod';

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not do this itself; without it a failed await becomes an
 * unhandled rejection and the request hangs until it times out.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Both helpers return the schema's *output* type, so `.default()` and
 * `.transform()` are reflected — a field with a default is non-optional to
 * every caller, which is the whole point of declaring the default.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request): TypeOf<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): TypeOf<S> {
  return schema.parse(req.query ?? {});
}
