import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { DateTime } from 'luxon';
import { inject } from 'vitest';
import { createApp } from '../app';
import { bootstrapModules } from '../bootstrap';
import { resetEnvCache } from '../config/env';
import { drainInlineQueue } from '../infrastructure/queue/queue';
import { UserModel } from '../modules/users/user.model';
import { hashPassword } from '../modules/auth/auth.service';
import { setEmailProviderForTests, type EmailMessage } from '../infrastructure/email/email.provider';

export const PASSWORD = 'Sup3rSecretPass';

/** Each test file gets its own database on the shared in-memory replica set. */
export async function setupTestApp(): Promise<Express> {
  const url = new URL(inject('mongoUri'));
  url.pathname = `/test_${randomBytes(6).toString('hex')}`;
  process.env.MONGODB_URI = url.toString();
  resetEnvCache();
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all(
    Object.values(mongoose.models).map((m) => m.createCollection().then(() => m.syncIndexes())),
  );
  bootstrapModules();
  return createApp();
}

export async function teardownTestApp() {
  await drainInlineQueue();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export const capturedEmails: EmailMessage[] = [];
export function captureEmails() {
  capturedEmails.length = 0;
  setEmailProviderForTests({
    name: 'test',
    send: async (m) => {
      capturedEmails.push(m);
      return { providerMessageId: `email-${capturedEmails.length}` };
    },
  });
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${randomBytes(2).toString('hex')}`;

export interface TenantFixture {
  tenantId: string;
  slug: string;
  token: string;
  refreshToken: string;
  userId: string;
  email: string;
}

/** Registers a user who self-provisions a business (becomes TENANT_ADMIN). */
export async function createTenant(app: Express, opts: { timezone?: string } = {}): Promise<TenantFixture> {
  const id = uniq();
  const email = `owner-${id}@example.test`;
  const slug = `biz-${id}`.toLowerCase().slice(0, 40);
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email,
      password: PASSWORD,
      name: 'Owner',
      business: { name: `Business ${id}`, slug, timezone: opts.timezone ?? 'UTC' },
    })
    .expect(201);
  const t = res.body.data.tokens;
  return {
    tenantId: t.tenantId,
    slug,
    token: t.accessToken,
    refreshToken: t.refreshToken,
    userId: res.body.data.user.id,
    email,
  };
}

export async function createSuperAdmin(app: Express) {
  const email = `root-${uniq()}@example.test`;
  await UserModel.create({
    email,
    name: 'Root',
    passwordHash: await hashPassword(PASSWORD),
    platformRole: 'SUPER_ADMIN',
  });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { token: res.body.data.tokens.accessToken as string, email };
}

/** Adds a new user to a tenant with given roles; returns a tenant-scoped token for them. */
export async function addMember(app: Express, admin: TenantFixture, roleKeys: string[]) {
  const email = `member-${uniq()}@example.test`;
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, name: 'Member' })
    .expect(201);
  await request(app).post('/api/v1/members').set(auth(admin)).send({ email, roleKeys }).expect(201);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, tenantSlug: admin.slug })
    .expect(200);
  return { token: res.body.data.tokens.accessToken as string, email };
}

export const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

/** Opens the business every day 08:00-18:00, no notice period; returns a bookable service + staff. */
export async function setupBookable(
  app: Express,
  t: TenantFixture,
  opts: { capacity?: number; duration?: number; buffer?: number } = {},
) {
  await request(app)
    .patch('/api/v1/business')
    .set(auth(t))
    .send({
      operatingHours: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, open: '08:00', close: '18:00' })),
      bookingPolicy: {
        minNoticeMinutes: 0,
        maxAdvanceDays: 365,
        slotIntervalMinutes: 15,
        cancellationCutoffMinutes: 0,
        rescheduleCutoffMinutes: 0,
      },
    })
    .expect(200);
  const svc = await request(app)
    .post('/api/v1/services')
    .set(auth(t))
    .send({
      name: `Service ${uniq()}`,
      durationMinutes: opts.duration ?? 30,
      bufferMinutes: opts.buffer ?? 0,
    })
    .expect(201);
  const staff = await request(app)
    .post('/api/v1/staff')
    .set(auth(t))
    .send({ name: 'Staff Member', capacity: opts.capacity ?? 1, serviceIds: [svc.body.data._id] })
    .expect(201);
  return { serviceId: svc.body.data._id as string, staffId: staff.body.data._id as string };
}

/** A future date (YYYY-MM-DD) in the zone, `days` ahead. */
export function futureDate(days = 2, zone = 'UTC') {
  return DateTime.now().setZone(zone).plus({ days }).toISODate()!;
}

export function at(date: string, hhmm: string, zone = 'UTC') {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone }).toUTC().toISO()!;
}

export function bookingBody(serviceId: string, startAt: string, extra: Record<string, unknown> = {}) {
  return {
    serviceId,
    startAt,
    customer: { name: 'Test Customer', email: `c-${uniq()}@example.test` },
    ...extra,
  };
}

export { drainInlineQueue };
