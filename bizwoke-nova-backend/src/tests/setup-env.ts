import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test-only configuration. Never points at a shared or production database.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGODB_URI: 'mongodb://placeholder-overridden-per-test-file',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
  APPOINTMENT_TOKEN_SECRET: 'test-appointment-secret-0123456789abcdef012345',
  BCRYPT_ROUNDS: '4',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  PUBLIC_RATE_LIMIT_MAX: '100000',
  CORS_ORIGINS: 'https://app.example.test',
  STORAGE_PROVIDER: 'local',
  STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'bizwoke-test-')),
  SWAGGER_ENABLED: 'true',
  REDIS_URL: '',
  AI_PROVIDER: '',
  WHATSAPP_PROVIDER: '',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  WHATSAPP_APP_SECRET: 'test-app-secret',
  AK_NEXUS_WEBHOOK_SECRET: 'test-aknexus-webhook-secret-0123456789',
  AK_NEXUS_API_BASE_URL: 'https://aknexus.example.test/api/v2',
  WHATSAPP_DRY_RUN: 'false',
  EMAIL_PROVIDER: '',
});
