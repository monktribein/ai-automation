import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { AppError } from '../errors/app-error';
import { logger } from '../logging/logger';

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Uploaded file is too large');
    return new AppError(422, 'VALIDATION_ERROR', `Upload rejected: ${err.code}`);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(422, 'VALIDATION_ERROR', 'Invalid value', [
      { path: err.path, message: 'Invalid value' },
    ]);
  }
  const e = err as { code?: number; type?: string; status?: number };
  if (e?.code === 11000)
    return new AppError(409, 'CONFLICT', 'A record with the same unique value already exists');
  if (e?.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (e?.type === 'entity.parse.failed') return new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body');
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const appErr = toAppError(err);
  const log = { err, requestId: req.requestId, method: req.method, path: req.path, code: appErr.code };
  if (appErr.status >= 500) logger.error(log, 'Request failed');
  else logger.debug(log, 'Request rejected');
  res.status(appErr.status).json({
    success: false,
    error: { code: appErr.code, message: appErr.message, details: appErr.details },
    requestId: req.requestId,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, details: [] },
    requestId: req.requestId,
  });
}
