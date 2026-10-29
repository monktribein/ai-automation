import type { NextFunction, Request, Response } from 'express';
import { Errors } from '../errors/app-error';

function findOperatorKey(value: unknown, depth = 0): string | undefined {
  if (depth > 20 || value === null || typeof value !== 'object') return undefined;
  for (const [k, v] of Object.entries(value)) {
    if (
      k.startsWith('$') ||
      k.includes('\0') ||
      k === '__proto__' ||
      k === 'constructor' ||
      k === 'prototype'
    ) {
      return k;
    }
    const nested = findOperatorKey(v, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

/** Rejects any request whose body or query contains MongoDB operator keys or prototype keys. */
export function rejectOperatorKeys(req: Request, _res: Response, next: NextFunction) {
  const bad = findOperatorKey(req.body) ?? findOperatorKey(req.query);
  if (bad)
    throw Errors.validation('Request contains forbidden keys', [{ path: bad, message: 'Forbidden key' }]);
  next();
}
