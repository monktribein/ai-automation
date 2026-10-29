import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestApp, teardownTestApp, createTenant, auth, addMember, type TenantFixture } from '../helpers';
import { AuditLogModel } from '../../modules/audit-logs/audit-log.model';

let app: Express;
let t: TenantFixture;
beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app);
});
afterAll(teardownTestApp);

describe('HTTP hardening', () => {
  it('sets security headers and hides framework details', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['content-security-policy']).toBeDefined();
  });

  it('only allowlisted browser origins receive CORS headers', async () => {
    const allowed = await request(app).get('/health').set('Origin', 'https://app.example.test');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.test');
    const denied = await request(app).get('/health').set('Origin', 'https://evil.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns consistent error envelopes with request ids and no stack traces', async () => {
    const r = await request(app).get('/api/v1/nope').expect(404);
    expect(r.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it('rejects oversized JSON bodies', async () => {
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.test', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a safe client request id and replaces unsafe ones', async () => {
    const good = await request(app).get('/health').set('X-Request-Id', 'client-req-123456');
    expect(good.headers['x-request-id']).toBe('client-req-123456');
    const evil = await request(app).get('/health').set('X-Request-Id', '<script>alert(1)</script>');
    expect(evil.headers['x-request-id']).not.toContain('<');
  });

  it('serves OpenAPI docs', async () => {
    const spec = await request(app).get('/openapi.json').expect(200);
    expect(spec.body.openapi).toMatch(/^3\./);
  });
});

describe('NoSQL injection', () => {
  it('rejects operator objects in bodies and queries', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } })
      .expect(422);
    expect(login.body.error.code).toBe('VALIDATION_ERROR');
    await request(app).get('/api/v1/customers').set(auth(t)).query({ 'search[$regex]': '.*' }).expect(422);
    await request(app)
      .post('/api/v1/customers')
      .set(auth(t))
      .send({ name: 'x', email: 'p@example.test', __proto__: { admin: true } })
      .expect((r) => expect([201, 422]).toContain(r.status));
  });

  it('treats regex metacharacters in search as literal text', async () => {
    await request(app)
      .post('/api/v1/customers')
      .set(auth(t))
      .send({ name: 'Literal Person', email: 'lit@example.test' })
      .expect(201);
    const r = await request(app).get('/api/v1/customers').set(auth(t)).query({ search: '.*' }).expect(200);
    expect(r.body.data).toHaveLength(0);
  });

  it('rejects malformed ids', async () => {
    await request(app).get('/api/v1/customers/not-an-id').set(auth(t)).expect(422);
    await request(app).get('/api/v1/customers/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(t)).expect(404);
  });
});

describe('authorization', () => {
  it('returns 403 for missing permissions', async () => {
    const sp = await addMember(app, t, ['SERVICE_PROVIDER']);
    await request(app).get('/api/v1/appointments').set(auth(sp)).expect(200);
    await request(app)
      .post('/api/v1/services')
      .set(auth(sp))
      .send({ name: 'x', durationMinutes: 30 })
      .expect(403);
    await request(app).get('/api/v1/leads').set(auth(sp)).expect(403);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(sp))
      .send({ profile: { displayName: 'x' } })
      .expect(403);
    const cust = await addMember(app, t, ['CUSTOMER']);
    await request(app).get('/api/v1/customers').set(auth(cust)).expect(403);
  });

  it('users without an active tenant cannot reach tenant routes', async () => {
    const r = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'lonely@example.test', password: 'Sup3rSecretPass', name: 'Lonely' })
      .expect(201);
    await request(app)
      .get('/api/v1/services')
      .set('Authorization', `Bearer ${r.body.data.tokens.accessToken}`)
      .expect(403);
  });

  it('revoked memberships lose access immediately even with a valid token', async () => {
    const op = await addMember(app, t, ['OPERATOR']);
    await request(app).get('/api/v1/services').set(auth(op)).expect(200);
    const members = await request(app).get('/api/v1/members').set(auth(t)).expect(200);
    const m = members.body.data.find((x: { user: { email: string } }) => x.user?.email === op.email);
    await request(app).patch(`/api/v1/members/${m._id}`).set(auth(t)).send({ status: 'REVOKED' }).expect(200);
    await request(app).get('/api/v1/services').set(auth(op)).expect(403);
  });

  it('business profile URLs must be https (safe external URLs)', async () => {
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ branding: { logoUrl: 'javascript:alert(1)' } })
      .expect(422);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ branding: { logoUrl: 'http://insecure.test/logo.png' } })
      .expect(422);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ branding: { logoUrl: 'https://cdn.example.test/logo.png' } })
      .expect(200);
  });
});

describe('audit logging', () => {
  it('records sensitive operations without secrets', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: t.email, password: 'WrongPassword1' })
      .expect(401);
    const logs = await AuditLogModel.find({ tenantId: t.tenantId }).lean();
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['auth.register', 'business.update']));
    const failed = await AuditLogModel.findOne({
      action: 'auth.login',
      outcome: 'FAILURE',
      actorUserId: t.userId,
    }).lean();
    expect(failed!.metadata).toEqual({ reason: 'bad_password' });
    expect(JSON.stringify(await AuditLogModel.find({}).lean())).not.toMatch(/WrongPassword1|Sup3rSecretPass/);
    const api = await request(app)
      .get('/api/v1/audit-logs')
      .set(auth(t))
      .query({ action: 'business.update' })
      .expect(200);
    expect(api.body.data.length).toBeGreaterThan(0);
  });
});
