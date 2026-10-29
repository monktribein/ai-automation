import { Router } from 'express';
import { isDatabaseReady } from '../../config/database';
import { getQueue } from '../../infrastructure/queue/queue';
import { integrationStatus } from '../../config/providers';

export function healthRouter(): Router {
  const r = Router();

  r.get('/', (req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        integrations: integrationStatus(),
        queue: getQueue().mode,
      },
      meta: {},
      requestId: req.requestId,
    });
  });

  // Liveness: process is up. Never depends on downstream services.
  r.get('/live', (req, res) => {
    res.json({ success: true, data: { status: 'alive' }, meta: {}, requestId: req.requestId });
  });

  // Readiness: can serve traffic (database connected).
  r.get('/ready', (req, res) => {
    const db = isDatabaseReady();
    res.status(db ? 200 : 503).json({
      success: db,
      data: { status: db ? 'ready' : 'not_ready', checks: { mongodb: db ? 'up' : 'down' } },
      meta: {},
      requestId: req.requestId,
    });
  });

  return r;
}
