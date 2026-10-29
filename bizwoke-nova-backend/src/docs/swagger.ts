import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { logger } from '../common/logging/logger';

function specPath(): string | undefined {
  const candidates = [join(process.cwd(), 'openapi.yaml'), join(__dirname, '..', '..', 'openapi.yaml')];
  return candidates.find((p) => existsSync(p));
}

export function loadOpenApiSpec(): Record<string, unknown> | undefined {
  const p = specPath();
  return p ? (YAML.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : undefined;
}

/** Swagger UI is the only HTML served by this backend (API documentation). */
export function mountDocs(app: Express) {
  const spec = loadOpenApiSpec();
  if (!spec) {
    logger.warn('openapi.yaml not found; API docs disabled');
    return;
  }
  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  app.use(
    '/docs',
    (_req: Request, res: Response, next: NextFunction) => {
      // Swagger UI needs inline scripts/styles; relax CSP only for the docs path.
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      );
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'Bizwoke Nova API' }),
  );
}
