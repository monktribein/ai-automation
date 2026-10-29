import type { Request, Response } from 'express';

export function ok(
  req: Request,
  res: Response,
  data: unknown,
  meta: Record<string, unknown> = {},
  status = 200,
) {
  return res.status(status).json({ success: true, data, meta, requestId: req.requestId });
}

export function created(req: Request, res: Response, data: unknown, meta: Record<string, unknown> = {}) {
  return ok(req, res, data, meta, 201);
}
