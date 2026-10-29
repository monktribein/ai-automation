import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import express from 'express';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  PASSWORD,
  captureEmails,
  capturedEmails,
  createSuperAdmin,
  drainInlineQueue,
} from '../helpers';
import { setEmailProviderForTests } from '../../infrastructure/email/email.provider';
import { resetEnvCache } from '../../config/env';
import { createApp } from '../../app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(async () => {
  setEmailProviderForTests(undefined);
  await teardownTestApp();
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    await request(app).get('/health/live').expect(200);
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body.data.checks.mongodb).toBe('up');
    const h = await request(app).get('/health').expect(200);
    expect(h.body.data.integrations.ai.status).toBe('unavailable');
    expect(h.headers['x-request-id']).toBeTruthy();
  });
});

describe('registration and login', () => {
  it('registers a user with a business and returns tenant-scoped tokens', async () => {
    const t = await createTenant(app);
    expect(t.tenantId).toMatch(/^[a-f0-9]{24}$/);
    const me = await request(app).get('/api/v1/auth/me').set(auth(t)).expect(200);
    expect(me.body.data.memberships[0].roleKeys).toEqual(['TENANT_ADMIN']);
    expect(me.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate email with 409 and weak passwords with 422', async () => {
    const t = await createTenant(app);
    const dup = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: t.email, password: PASSWORD, name: 'X' })
      .expect(409);
    expect(dup.body.success).toBe(false);
    expect(dup.body.error.code).toBe('CONFLICT');
    const weak = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.test', password: 'short', name: 'X' })
      .expect(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect(weak.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects unknown fields (no mass assignment, e.g. platformRole)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'mass@example.test', password: PASSWORD, name: 'X', platformRole: 'SUPER_ADMIN' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a generic 401 for wrong password and unknown email', async () => {
    const t = await createTenant(app);
    const a = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.email, password: 'WrongPass123' })
      .expect(401);
    const b = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'WrongPass123' })
      .expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const t = await createTenant(app);
    for (let i = 0; i < 5; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: t.email, password: 'WrongPass123' })
        .expect(401);
    // Correct password is now refused while locked.
    await request(app).post('/api/v1/auth/login').send({ email: t.email, password: PASSWORD }).expect(401);
  });
});

describe('tokens', () => {
  it('rejects missing, malformed, tampered and expired access tokens', async () => {
    await request(app).get('/api/v1/services').expect(401);
    await request(app).get('/api/v1/services').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const t = await createTenant(app);
    const forged = jwt.sign(
      { sub: t.userId, sid: 'x', prl: 'SUPER_ADMIN', typ: 'access' },
      'wrong-secret-wrong-secret-wrong-secret',
    );
    await request(app).get('/api/v1/services').set('Authorization', `Bearer ${forged}`).expect(401);
    const decoded = jwt.decode(t.token) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign({ ...decoded, iat: now - 100, exp: now - 10 }, process.env.JWT_ACCESS_SECRET!);
    const res = await request(app)
      .get('/api/v1/services')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('rotates refresh tokens and detects reuse (revokes the family)', async () => {
    const t = await createTenant(app);
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t.refreshToken })
      .expect(200);
    const second = r1.body.data.refreshToken;
    expect(second).not.toBe(t.refreshToken);
    // Re-using the rotated token is treated as theft.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
    // ...which revokes the whole family, including the newest token and live access tokens.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second }).expect(401);
    await request(app)
      .get('/api/v1/services')
      .set('Authorization', `Bearer ${r1.body.data.accessToken}`)
      .expect(401);
  });

  it('logout revokes the session immediately', async () => {
    const t = await createTenant(app);
    await request(app).post('/api/v1/auth/logout').set(auth(t)).send({}).expect(200);
    await request(app).get('/api/v1/services').set(auth(t)).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
  });
});

describe('password reset', () => {
  it('issues a single-use token by email and revokes sessions after reset', async () => {
    captureEmails();
    const t = await createTenant(app);
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: t.email }).expect(202);
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.test' })
      .expect(202);
    expect(res.body.data.message).toBe(unknown.body.data.message);
    await drainInlineQueue();
    const mail = capturedEmails.find((m) => m.to === t.email)!;
    const token = mail.text.trim().split('\n').pop()!.trim();
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'BrandNewPass99' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'AnotherPass99' })
      .expect(422);
    await request(app).get('/api/v1/services').set(auth(t)).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.email, password: 'BrandNewPass99' })
      .expect(200);
  });
});

describe('platform privileges', () => {
  it('tenant admins cannot use platform tenant-management APIs', async () => {
    const t = await createTenant(app);
    await request(app)
      .post('/api/v1/tenants')
      .set(auth(t))
      .send({ name: 'Evil', slug: 'evil-co' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/tenants/${t.tenantId}/status`)
      .set(auth(t))
      .send({ status: 'ACTIVE' })
      .expect(403);
    await request(app)
      .post('/api/v1/subscriptions/plans')
      .set(auth(t))
      .send({ code: 'x', name: 'x' })
      .expect(403);
  });

  it('super admins can create, list and suspend tenants; suspension blocks tenant access', async () => {
    const root = await createSuperAdmin(app);
    const t = await createTenant(app);
    const list = await request(app).get('/api/v1/tenants').set(auth(root)).expect(200);
    expect(list.body.meta.total).toBeGreaterThan(0);
    await request(app)
      .post('/api/v1/tenants')
      .set(auth(root))
      .send({ name: 'Platform Made', slug: `pm-${Date.now()}` })
      .expect(201);
    await request(app)
      .patch(`/api/v1/tenants/${t.tenantId}/status`)
      .set(auth(root))
      .send({ status: 'SUSPENDED', reason: 'test' })
      .expect(200);
    const blocked = await request(app).get('/api/v1/services').set(auth(t)).expect(403);
    expect(blocked.body.error.code).toBe('TENANT_INACTIVE');
    await request(app).get(`/api/v1/public/${t.slug}`).expect(404);
  });
});

describe('tenant feature entitlements', () => {
  it('only super admins can toggle tenant features', async () => {
    const root = await createSuperAdmin(app);
    const t = await createTenant(app);
    await request(app)
      .patch(`/api/v1/tenants/${t.tenantId}/features`)
      .set(auth(t))
      .send({ ai: true })
      .expect(403);
    const r = await request(app)
      .patch(`/api/v1/tenants/${t.tenantId}/features`)
      .set(auth(root))
      .send({ ai: true })
      .expect(200);
    expect(r.body.data.ai).toBe(true);
    await request(app)
      .patch(`/api/v1/tenants/${t.tenantId}/features`)
      .set(auth(root))
      .send({ bogus: true })
      .expect(422);
    const biz = await request(app).get('/api/v1/business').set(auth(t)).expect(200);
    expect(biz.body.data.settings.features.ai).toBe(true);
  });
});

describe('account activation and deactivation', () => {
  it('super admins deactivate accounts (sessions revoked) and reactivate them', async () => {
    const root = await createSuperAdmin(app);
    const t = await createTenant(app);
    await request(app)
      .patch(`/api/v1/users/${t.userId}/status`)
      .set(auth(t))
      .send({ status: 'DEACTIVATED' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/users/${t.userId}/status`)
      .set(auth(root))
      .send({ status: 'DEACTIVATED', reason: 'abuse' })
      .expect(200);
    await request(app).get('/api/v1/services').set(auth(t)).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: t.email, password: PASSWORD }).expect(401);
    await request(app)
      .patch(`/api/v1/users/${t.userId}/status`)
      .set(auth(root))
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: t.email, password: PASSWORD }).expect(200);
    const list = await request(app)
      .get('/api/v1/users')
      .set(auth(root))
      .query({ search: t.email })
      .expect(200);
    expect(list.body.data[0].passwordHash).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('limits login attempts', async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    resetEnvCache();
    const limited = createApp();
    process.env.AUTH_RATE_LIMIT_MAX = '100000';
    resetEnvCache();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(limited)
        .post('/api/v1/auth/login')
        .send({ email: 'rl@example.test', password: 'Whatever123' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[4]).toBe(429);
    expect(express).toBeDefined();
  });
});
