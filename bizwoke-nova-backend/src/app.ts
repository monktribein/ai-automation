import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { corsOptions } from './config/security';
import { logger } from './common/logging/logger';
import { requestId } from './common/middleware/request-id';
import { rejectOperatorKeys } from './common/middleware/sanitize';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler';
import { globalLimiter } from './common/middleware/rate-limit';
import { healthRouter } from './modules/health/health.routes';
import { apiRouter } from './routes';
import { mountDocs } from './docs/swagger';

export function createApp(): Express {
  const e = env();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', e.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors(corsOptions()));
  app.use(
    express.json({
      limit: e.BODY_LIMIT,
      strict: true,
      // Raw bytes are kept for webhook signature verification.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(rejectOperatorKeys);

  app.use('/health', healthRouter());
  if (e.SWAGGER_ENABLED) mountDocs(app);

  app.use(e.API_PREFIX, globalLimiter(), apiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
