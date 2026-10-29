import type { Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../../config/env';

function handler(req: Request, res: Response) {
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later', details: [] },
    requestId: req.requestId,
  });
}

/**
 * In-memory store by default. For multi-instance deployments plug a shared store
 * (e.g. rate-limit-redis) via `store`; see docs/DEPLOYMENT.md.
 */
function limiter(max: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs: env().RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    ...extra,
  });
}

export const globalLimiter = () => limiter(env().RATE_LIMIT_MAX);
export const authLimiter = () => limiter(env().AUTH_RATE_LIMIT_MAX);
export const publicLimiter = () => limiter(env().PUBLIC_RATE_LIMIT_MAX);
