import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-appointment-token"]',
  'req.headers["x-hub-signature-256"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.passwordHash',
];

export const logger = pino({
  level,
  base: { service: 'bizwoke-nova' },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
