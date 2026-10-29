import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodTypeAny, z } from 'zod';
import { Errors } from '../errors/app-error';

export function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

/** Parses with a strict schema; unknown keys are rejected by schemas defined with `.strict()`. */
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw Errors.validation('Request validation failed', zodDetails(result.error));
  return result.data;
}

type Parts = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/**
 * Validates request parts and stores the parsed values in res.locals.valid so
 * handlers never touch raw, unvalidated input (no mass assignment).
 */
export function validate(parts: Parts) {
  return (req: Request, res: Response, next: NextFunction) => {
    const valid: Record<string, unknown> = {};
    if (parts.params) valid.params = parse(parts.params, req.params);
    if (parts.query) valid.query = parse(parts.query, req.query);
    if (parts.body) valid.body = parse(parts.body, req.body ?? {});
    res.locals.valid = valid;
    next();
  };
}

export function valid<T = Record<string, unknown>>(res: Response): { body: T; query: T; params: T } {
  return res.locals.valid as { body: T; query: T; params: T };
}
