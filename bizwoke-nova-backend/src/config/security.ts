import type { CorsOptions } from 'cors';
import { env } from './env';

export function corsOptions(): CorsOptions {
  const origins = env().CORS_ORIGINS;
  return {
    origin(origin, cb) {
      // Non-browser clients send no Origin header; browsers must be explicitly allowlisted.
      if (!origin) return cb(null, true);
      if (origins.includes('*') || origins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Appointment-Token',
    ],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  };
}
