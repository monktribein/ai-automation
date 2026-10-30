import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'test') loadDotenv({ quiet: true });

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : undefined))
    .pipe(z.enum(values).optional());

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    API_PREFIX: z
      .string()
      .regex(/^\/[a-z0-9/_-]+$/i)
      .default('/api/v1'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    JWT_ISSUER: z.string().default('bizwoke-nova'),
    APPOINTMENT_TOKEN_SECRET: z.string().min(32, 'APPOINTMENT_TOKEN_SECRET must be at least 32 characters'),
    APPOINTMENT_TOKEN_TTL: z.string().default('30d'),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    ALLOW_SELF_SIGNUP_TENANTS: bool(true),
    CORS_ORIGINS: csv,
    BODY_LIMIT: z.string().default('100kb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    REDIS_URL: optionalString,
    AI_PROVIDER: optionalEnum(['anthropic', 'openai']),
    AI_API_KEY: optionalString,
    AI_MODEL: optionalString,
    AI_BASE_URL: optionalString,
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(5),
    WHATSAPP_PROVIDER: optionalEnum(['meta', 'aknexus']),
    /** Master switch: false disables all WhatsApp sending regardless of provider. */
    WHATSAPP_ENABLED: bool(true),
    /** true = never call the provider; notifications are recorded as SKIPPED (never as SENT). */
    WHATSAPP_DRY_RUN: bool(false),
    AK_NEXUS_API_BASE_URL: z.string().url().default('https://app.aknexus.in/api/v2'),
    AK_NEXUS_API_TOKEN: optionalString,
    /** Default AK Nexus WhatsApp instance (used when a webhook payload carries no instance id). */
    AK_NEXUS_INSTANCE_ID: optionalString,
    /** Secret path segment for the inbound webhook URL (AK Nexus webhooks are unsigned). */
    AK_NEXUS_WEBHOOK_SECRET: optionalString,
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    WHATSAPP_GRAPH_URL: z.string().url().default('https://graph.facebook.com'),
    STORAGE_PROVIDER: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : 'local'))
      .pipe(z.enum(['local', 's3'])),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    STORAGE_BUCKET: optionalString,
    STORAGE_ENDPOINT: optionalString,
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_ACCESS_KEY: optionalString,
    STORAGE_SECRET_KEY: optionalString,
    STORAGE_FORCE_PATH_STYLE: bool(true),
    /** Google Apps Script web app URL; when set, every booking is mirrored to the sheet. */
    GOOGLE_SHEET_WEBHOOK_URL: optionalString,
    /** Shared secret; must equal SECRET in the Apps Script. */
    GOOGLE_SHEET_SECRET: optionalString,
    GOOGLE_SHEET_NAME: z.string().default('Bookings'),
    EMAIL_PROVIDER: optionalEnum(['smtp']),
    SMTP_URL: optionalString,
    EMAIL_FROM: optionalString,
    IMPORT_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5000),
    EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
    EXPORT_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SWAGGER_ENABLED: bool(true),
  })
  .superRefine((e, ctx) => {
    const prodLike = e.NODE_ENV === 'production' || e.NODE_ENV === 'staging';
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (prodLike && e.CORS_ORIGINS.includes('*'))
      issue('CORS_ORIGINS', 'Wildcard CORS is not allowed in production');
    if (prodLike && /localhost|127\.0\.0\.1/.test(e.MONGODB_URI)) {
      issue('MONGODB_URI', 'localhost MongoDB is not allowed in production');
    }
    if (e.JWT_ACCESS_SECRET === e.APPOINTMENT_TOKEN_SECRET) {
      issue('APPOINTMENT_TOKEN_SECRET', 'Must differ from JWT_ACCESS_SECRET');
    }
    if (prodLike && /replace_with/i.test(e.JWT_ACCESS_SECRET + e.APPOINTMENT_TOKEN_SECRET)) {
      issue('JWT_ACCESS_SECRET', 'Placeholder secrets are not allowed outside development');
    }
    if (
      e.STORAGE_PROVIDER === 's3' &&
      (!e.STORAGE_BUCKET || !e.STORAGE_ACCESS_KEY || !e.STORAGE_SECRET_KEY)
    ) {
      issue(
        'STORAGE_PROVIDER',
        'S3 storage requires STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY',
      );
    }
    if (e.AI_PROVIDER && !e.AI_API_KEY) issue('AI_API_KEY', 'AI_API_KEY is required when AI_PROVIDER is set');
    if (e.AI_PROVIDER === 'openai' && !e.AI_MODEL)
      issue('AI_MODEL', 'AI_MODEL is required for the openai provider');
    if (e.WHATSAPP_PROVIDER === 'aknexus' && !e.AK_NEXUS_API_TOKEN)
      issue('AK_NEXUS_API_TOKEN', 'AK_NEXUS_API_TOKEN is required when WHATSAPP_PROVIDER=aknexus');
    if (e.AK_NEXUS_WEBHOOK_SECRET && e.AK_NEXUS_WEBHOOK_SECRET.length < 24)
      issue('AK_NEXUS_WEBHOOK_SECRET', 'AK_NEXUS_WEBHOOK_SECRET must be at least 24 characters');
    if (e.AI_BASE_URL && !/^https:\/\//.test(e.AI_BASE_URL) && prodLike)
      issue('AI_BASE_URL', 'AI_BASE_URL must use https');
    if (e.GOOGLE_SHEET_WEBHOOK_URL) {
      if (!/^https:\/\/script\.google\.com\//.test(e.GOOGLE_SHEET_WEBHOOK_URL))
        issue('GOOGLE_SHEET_WEBHOOK_URL', 'Must be an https://script.google.com/... web app URL');
      if (!e.GOOGLE_SHEET_SECRET || e.GOOGLE_SHEET_SECRET.length < 16)
        issue('GOOGLE_SHEET_SECRET', 'GOOGLE_SHEET_SECRET (min 16 chars) is required with GOOGLE_SHEET_WEBHOOK_URL');
    }
    if (e.EMAIL_PROVIDER === 'smtp' && (!e.SMTP_URL || !e.EMAIL_FROM)) {
      issue('SMTP_URL', 'SMTP email requires SMTP_URL and EMAIL_FROM');
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validated environment; throws a readable error on first access if invalid. */
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
