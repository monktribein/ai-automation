import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  intersect,
  localToEpoch,
  subtract,
  unitStarts,
  isUnitAligned,
  dateRange,
} from '../../modules/availability/time';
import { canTransition } from '../../modules/appointments/appointment.service';
import { APPOINTMENT_STATUSES } from '../../modules/appointments/appointment.models';
import { escapeRegex, neutralizeFormula, normalizePhone, slugify } from '../../common/utils/text';
import { fingerprint, humanReference, safeEqual } from '../../common/utils/crypto';
import { parseEnv } from '../../config/env';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '../../modules/permissions/permissions';
import { durationMs, signAppointmentToken, verifyAppointmentToken } from '../../modules/auth/token.service';
import { looksLikeXlsx } from '../../modules/imports-exports/excel';

const base = {
  MONGODB_URI: 'mongodb://db.internal:27017/x',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  APPOINTMENT_TOKEN_SECRET: 'b'.repeat(40),
};

describe('time utilities', () => {
  it('subtracts and intersects intervals', () => {
    expect(
      subtract(
        [{ start: 0, end: 100 }],
        [
          { start: 20, end: 30 },
          { start: 90, end: 120 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 90 },
    ]);
    expect(intersect([{ start: 0, end: 50 }], [{ start: 40, end: 60 }])).toEqual([{ start: 40, end: 50 }]);
    expect(intersect([{ start: 0, end: 10 }], [{ start: 10, end: 20 }])).toEqual([]);
  });

  it('converts local wall time to UTC across DST transitions', () => {
    // New York: 2026-03-08 is DST start (UTC-5 -> UTC-4).
    expect(new Date(localToEpoch('2026-03-07', '09:00', 'America/New_York')).toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(new Date(localToEpoch('2026-03-09', '09:00', 'America/New_York')).toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
    expect(localToEpoch('2026-03-09', '24:00', 'UTC')).toBe(DateTime.fromISO('2026-03-10T00:00Z').toMillis());
  });

  it('generates 5-minute reservation units and alignment checks', () => {
    const s = new Date('2030-01-01T10:00:00Z');
    expect(unitStarts(s, new Date('2030-01-01T10:30:00Z'))).toHaveLength(6);
    expect(isUnitAligned(s)).toBe(true);
    expect(isUnitAligned(new Date('2030-01-01T10:03:00Z'))).toBe(false);
    expect(dateRange('2030-01-30', '2030-02-02')).toEqual([
      '2030-01-30',
      '2030-01-31',
      '2030-02-01',
      '2030-02-02',
    ]);
  });
});

describe('appointment state machine', () => {
  it('allows only documented transitions', () => {
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING_CONFIRMATION', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
    for (const terminal of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      for (const to of APPOINTMENT_STATUSES) expect(canTransition(terminal, to)).toBe(false);
    }
  });
});

describe('text and crypto utilities', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('+cmd')).toBe("'+cmd");
    expect(neutralizeFormula('-2')).toBe("'-2");
    expect(neutralizeFormula('@SUM')).toBe("'@SUM");
    expect(neutralizeFormula('\tx')).toBe("'\tx");
    expect(neutralizeFormula('Normal text')).toBe('Normal text');
  });

  it('escapes regex input and normalises identifiers', () => {
    expect(new RegExp(escapeRegex('a.*(b)')).test('a.*(b)')).toBe(true);
    expect(new RegExp(escapeRegex('a.*')).test('abc')).toBe(false);
    expect(normalizePhone('+1 (555) 010-0000')).toBe('+15550100000');
    expect(slugify('Dr. Smith & Co!')).toBe('dr-smith-co');
  });

  it('produces stable fingerprints and readable references', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(humanReference('BK')).toMatch(/^BK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(durationMs('15m')).toBe(900_000);
    expect(durationMs('7d')).toBe(604_800_000);
  });

  it('detects xlsx magic bytes', () => {
    expect(looksLikeXlsx(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeXlsx(Buffer.from('name,email'))).toBe(false);
  });
});

describe('environment validation', () => {
  it('fails with a clear message when required variables are missing', () => {
    expect(() => parseEnv({})).toThrow(/MONGODB_URI[\s\S]*JWT_ACCESS_SECRET/);
  });

  it('starts with only core variables (optional integrations unavailable)', () => {
    const e = parseEnv(base);
    expect(e.AI_PROVIDER).toBeUndefined();
    expect(e.WHATSAPP_PROVIDER).toBeUndefined();
    expect(e.REDIS_URL).toBeUndefined();
    expect(e.STORAGE_PROVIDER).toBe('local');
  });

  it('rejects unsafe production configuration', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/Wildcard CORS/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost/x' })).toThrow(
      /localhost/,
    );
    expect(() => parseEnv({ ...base, APPOINTMENT_TOKEN_SECRET: base.JWT_ACCESS_SECRET })).toThrow(/differ/);
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'anthropic' })).toThrow(/AI_API_KEY/);
    expect(() => parseEnv({ ...base, STORAGE_PROVIDER: 's3' })).toThrow(/STORAGE_BUCKET/);
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'skynet', AI_API_KEY: 'k' })).toThrow();
  });
});

describe('permissions', () => {
  it('system roles only reference catalog permissions and CUSTOMER is minimal', () => {
    for (const r of Object.values(SYSTEM_ROLES))
      for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    expect(SYSTEM_ROLES.CUSTOMER!.permissions).not.toContain('customers:read');
    expect(SYSTEM_ROLES.OPERATOR!.permissions).not.toContain('members:manage');
    expect(ALL_PERMISSIONS.some((p) => p.startsWith('platform'))).toBe(false);
  });
});

describe('appointment manage tokens', () => {
  it('are bound to one tenant and one appointment', () => {
    const tok = signAppointmentToken('t1', 'a1');
    expect(() => verifyAppointmentToken(tok, 't1', 'a1')).not.toThrow();
    expect(() => verifyAppointmentToken(tok, 't2', 'a1')).toThrow();
    expect(() => verifyAppointmentToken(tok, 't1', 'a2')).toThrow();
    expect(() => verifyAppointmentToken(`${tok}x`, 't1', 'a1')).toThrow();
  });
});
