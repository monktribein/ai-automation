import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DateTime } from 'luxon';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  setupBookable,
  futureDate,
  at,
  bookingBody,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import { ReservationSlotModel, AppointmentEventModel } from '../../modules/appointments/appointment.models';

let app: Express;
let t: TenantFixture;
beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app);
});
afterAll(teardownTestApp);

const book = (body: Record<string, unknown>, key?: string) => {
  const r = request(app).post('/api/v1/appointments').set(auth(t));
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};

describe('availability engine', () => {
  it('returns real slots inside operating hours and removes booked times', async () => {
    const { serviceId } = await setupBookable(app, t, { duration: 60 });
    const date = futureDate(3);
    const before = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(t))
      .query({ serviceId, from: date })
      .expect(200);
    const starts: string[] = before.body.data.map((s: { startAt: string }) => s.startAt);
    expect(starts[0]).toBe(at(date, '08:00').replace('.000Z', '.000Z'));
    expect(starts).toContain(new Date(at(date, '17:00')).toISOString());
    expect(starts).not.toContain(new Date(at(date, '17:15')).toISOString()); // would end after close

    await book(bookingBody(serviceId, at(date, '10:00'))).expect(201);
    const after = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(t))
      .query({ serviceId, from: date })
      .expect(200);
    const afterStarts: string[] = after.body.data.map((s: { startAt: string }) => s.startAt);
    for (const blocked of ['09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45']) {
      expect(afterStarts).not.toContain(new Date(at(date, blocked)).toISOString());
    }
    expect(afterStarts).toContain(new Date(at(date, '11:00')).toISOString());
  });

  it('applies staff breaks and leave exceptions', async () => {
    const { serviceId, staffId } = await setupBookable(app, t, { duration: 30 });
    const date = futureDate(4);
    const weekday = DateTime.fromISO(date, { zone: 'UTC' }).weekday;
    await request(app)
      .put(`/api/v1/staff/${staffId}/availability`)
      .set(auth(t))
      .send({
        weekly: [{ dayOfWeek: weekday, start: '09:00', end: '12:00' }],
        breaks: [{ dayOfWeek: weekday, start: '10:00', end: '10:30' }],
      })
      .expect(200);
    const res = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(t))
      .query({ serviceId, from: date })
      .expect(200);
    const starts: string[] = res.body.data.map((s: { startAt: string }) => s.startAt);
    expect(starts[0]).toBe(new Date(at(date, '09:00')).toISOString());
    expect(starts).not.toContain(new Date(at(date, '09:45')).toISOString()); // overlaps break
    expect(starts).not.toContain(new Date(at(date, '10:00')).toISOString());
    expect(starts).toContain(new Date(at(date, '10:30')).toISOString());
    expect(starts).not.toContain(new Date(at(date, '11:45')).toISOString());

    await request(app)
      .post(`/api/v1/staff/${staffId}/exceptions`)
      .set(auth(t))
      .send({ type: 'LEAVE', startsAt: at(date, '00:00'), endsAt: at(date, '23:59') })
      .expect(201);
    const onLeave = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(t))
      .query({ serviceId, from: date })
      .expect(200);
    expect(onLeave.body.data).toHaveLength(0);
    await book(bookingBody(serviceId, at(date, '09:00'))).expect(409);
  });

  it('interprets hours in the business timezone and stores UTC', async () => {
    const tz = await createTenant(app, { timezone: 'Asia/Kolkata' });
    const { serviceId } = await setupBookable(app, tz, { duration: 30 });
    const date = futureDate(5, 'Asia/Kolkata');
    const res = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(tz))
      .query({ serviceId, from: date })
      .expect(200);
    // 08:00 IST == 02:30 UTC
    expect(res.body.data[0].startAt).toBe(
      DateTime.fromISO(`${date}T08:00`, { zone: 'Asia/Kolkata' }).toUTC().toISO(),
    );
    const created = await request(app)
      .post('/api/v1/appointments')
      .set(auth(tz))
      .send(bookingBody(serviceId, `${date}T09:00:00+05:30`))
      .expect(201);
    expect(created.body.data.startAt).toBe(DateTime.fromISO(`${date}T03:30:00Z`).toUTC().toISO());
    expect(created.body.data.timezone).toBe('Asia/Kolkata');
  });

  it('enforces minimum notice and advance windows for public bookings', async () => {
    const p = await createTenant(app);
    const { serviceId } = await setupBookable(app, p);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(p))
      .send({ bookingPolicy: { minNoticeMinutes: 72 * 60, maxAdvanceDays: 10 } })
      .expect(200);
    const soon = at(futureDate(1), '10:00');
    const far = at(futureDate(30), '10:00');
    const r1 = await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .send(bookingBody(serviceId, soon))
      .expect(409);
    expect(r1.body.error.code).toBe('SLOT_UNAVAILABLE');
    await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .send(bookingBody(serviceId, far))
      .expect(409);
    await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .send(bookingBody(serviceId, at(futureDate(5), '10:00')))
      .expect(201);
  });
});

describe('appointment creation', () => {
  it('creates a confirmed appointment with reference, reservation slots and a CREATED event', async () => {
    const { serviceId, staffId } = await setupBookable(app, t, { duration: 45, buffer: 15 });
    const res = await book(bookingBody(serviceId, at(futureDate(6), '09:00'))).expect(201);
    const a = res.body.data;
    expect(a.reference).toMatch(/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(a.status).toBe('CONFIRMED');
    expect(a.staffId).toBe(staffId);
    expect(new Date(a.blockEndAt).getTime() - new Date(a.startAt).getTime()).toBe(60 * 60_000);
    expect(await ReservationSlotModel.countDocuments({ tenantId: t.tenantId, appointmentId: a._id })).toBe(
      12,
    );
    const hist = await request(app).get(`/api/v1/appointments/${a._id}/history`).set(auth(t)).expect(200);
    expect(hist.body.data[0].type).toBe('CREATED');
  });

  it('rejects invalid bookings with precise errors', async () => {
    const { serviceId } = await setupBookable(app, t);
    const date = futureDate(7);
    expect((await book(bookingBody(serviceId, at(date, '07:00'))).expect(409)).body.error.code).toBe(
      'SLOT_UNAVAILABLE',
    );
    expect((await book(bookingBody(serviceId, at(date, '10:07'))).expect(422)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    await book(bookingBody(serviceId, 'not-a-date')).expect(422);
    await book(bookingBody('000000000000000000000000', at(date, '10:00'))).expect(404);
    await book({ serviceId, startAt: at(date, '10:00') }).expect(422);
  });

  it('is idempotent: retries with the same key return the original appointment', async () => {
    const { serviceId } = await setupBookable(app, t);
    const body = bookingBody(serviceId, at(futureDate(8), '11:00'));
    const first = await book(body, 'idem-key-0001').expect(201);
    const retry = await book(body, 'idem-key-0001').expect(200);
    expect(retry.body.data._id).toBe(first.body.data._id);
    expect(retry.body.meta.idempotentReplay).toBe(true);
    const conflict = await book({ ...body, startAt: at(futureDate(8), '12:00') }, 'idem-key-0001').expect(
      409,
    );
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('never double-books under concurrent requests (single capacity)', async () => {
    const { serviceId } = await setupBookable(app, t, { duration: 60 });
    const start = at(futureDate(9), '13:00');
    const results = await Promise.all(Array.from({ length: 8 }, () => book(bookingBody(serviceId, start))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
  });

  it('never double-books overlapping (not identical) concurrent requests', async () => {
    const { serviceId } = await setupBookable(app, t, { duration: 60 });
    const date = futureDate(10);
    const results = await Promise.all(
      ['13:00', '13:15', '13:30', '13:45'].map((h) => book(bookingBody(serviceId, at(date, h)))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('respects resource capacity limits under concurrency', async () => {
    const { serviceId } = await setupBookable(app, t, { capacity: 3, duration: 30 });
    const start = at(futureDate(11), '15:00');
    const results = await Promise.all(Array.from({ length: 6 }, () => book(bookingBody(serviceId, start))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    const seats = results
      .filter((r) => r.status === 201)
      .map((r) => r.body.data.seat)
      .sort();
    expect(seats).toEqual([0, 1, 2]);
  });
});

describe('lifecycle', () => {
  it('enforces valid status transitions and records events', async () => {
    const { serviceId } = await setupBookable(app, t);
    const a = (await book(bookingBody(serviceId, at(futureDate(12), '09:00'))).expect(201)).body.data;
    const bad = await request(app)
      .patch(`/api/v1/appointments/${a._id}/status`)
      .set(auth(t))
      .send({ status: 'COMPLETED' })
      .expect(409);
    expect(bad.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await request(app)
      .patch(`/api/v1/appointments/${a._id}/status`)
      .set(auth(t))
      .send({ status: 'CHECKED_IN' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/appointments/${a._id}/status`)
      .set(auth(t))
      .send({ status: 'COMPLETED' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/appointments/${a._id}/status`)
      .set(auth(t))
      .send({ status: 'CANCELLED' })
      .expect(409);
    const events = await AppointmentEventModel.find({ tenantId: t.tenantId, appointmentId: a._id })
      .sort({ createdAt: 1 })
      .lean();
    expect(events.map((e) => e.toStatus)).toEqual(['CONFIRMED', 'CHECKED_IN', 'COMPLETED']);
  });

  it('cancellation frees the time without deleting the appointment', async () => {
    const { serviceId } = await setupBookable(app, t);
    const start = at(futureDate(13), '09:00');
    const a = (await book(bookingBody(serviceId, start)).expect(201)).body.data;
    await book(bookingBody(serviceId, start)).expect(409);
    await request(app)
      .patch(`/api/v1/appointments/${a._id}/status`)
      .set(auth(t))
      .send({ status: 'CANCELLED', reason: 'Customer request' })
      .expect(200);
    const kept = await request(app).get(`/api/v1/appointments/${a._id}`).set(auth(t)).expect(200);
    expect(kept.body.data.status).toBe('CANCELLED');
    expect(kept.body.data.cancellation.reason).toBe('Customer request');
    await book(bookingBody(serviceId, start)).expect(201);
  });

  it('reschedules atomically and rejects moving onto a taken slot', async () => {
    const { serviceId } = await setupBookable(app, t, { duration: 60 });
    const date = futureDate(14);
    const a = (await book(bookingBody(serviceId, at(date, '09:00'))).expect(201)).body.data;
    const b = (await book(bookingBody(serviceId, at(date, '11:00'))).expect(201)).body.data;
    // Overlapping its own old block is fine (old block released in the same transaction).
    const moved = await request(app)
      .post(`/api/v1/appointments/${a._id}/reschedule`)
      .set(auth(t))
      .send({ startAt: at(date, '09:30') })
      .expect(200);
    expect(moved.body.data.startAt).toBe(new Date(at(date, '09:30')).toISOString());
    const clash = await request(app)
      .post(`/api/v1/appointments/${a._id}/reschedule`)
      .set(auth(t))
      .send({ startAt: at(date, '10:30') })
      .expect(409);
    expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');
    // Failed reschedule must not lose the existing reservation.
    await book(bookingBody(serviceId, at(date, '09:30'))).expect(409);
    const hist = await request(app).get(`/api/v1/appointments/${a._id}/history`).set(auth(t)).expect(200);
    expect(hist.body.data.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'RESCHEDULED']);
    expect(b.status).toBe('CONFIRMED');
  });

  it('lists appointments with filters and pagination', async () => {
    const res = await request(app)
      .get('/api/v1/appointments')
      .set(auth(t))
      .query({ status: 'CONFIRMED', limit: 2, page: 1 })
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.total).toBeGreaterThan(2);
    expect(res.body.data.every((a: { status: string }) => a.status === 'CONFIRMED')).toBe(true);
  });
});

describe('public booking flow', () => {
  it('books as guest, manages via signed token, and never via id alone', async () => {
    const p = await createTenant(app);
    const { serviceId } = await setupBookable(app, p);
    const date = futureDate(15);
    const created = await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .set('Idempotency-Key', 'public-key-001')
      .send(bookingBody(serviceId, at(date, '10:00')))
      .expect(201);
    const { appointment, manageToken } = created.body.data;
    expect(appointment.customerId).toBeUndefined();

    await request(app)
      .patch(`/api/v1/public/${p.slug}/appointments/${appointment.id}`)
      .send({ action: 'cancel' })
      .expect(401);
    await request(app)
      .patch(`/api/v1/public/${p.slug}/appointments/${appointment.id}`)
      .set('X-Appointment-Token', 'garbage')
      .send({ action: 'cancel' })
      .expect(401);

    // Token for appointment A cannot manage appointment B.
    const other = (
      await request(app)
        .post(`/api/v1/public/${p.slug}/appointments`)
        .send(bookingBody(serviceId, at(date, '12:00')))
        .expect(201)
    ).body.data;
    await request(app)
      .patch(`/api/v1/public/${p.slug}/appointments/${other.appointment.id}`)
      .set('X-Appointment-Token', manageToken)
      .send({ action: 'cancel' })
      .expect(403);

    const resched = await request(app)
      .patch(`/api/v1/public/${p.slug}/appointments/${appointment.id}`)
      .set('X-Appointment-Token', manageToken)
      .send({ action: 'reschedule', startAt: at(date, '14:00') })
      .expect(200);
    expect(resched.body.data.startAt).toBe(new Date(at(date, '14:00')).toISOString());
    const cancelled = await request(app)
      .patch(`/api/v1/public/${p.slug}/appointments/${appointment.id}`)
      .set('X-Appointment-Token', manageToken)
      .send({ action: 'cancel' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('appointment-access never returns the token in the response', async () => {
    const p = await createTenant(app);
    const { serviceId } = await setupBookable(app, p);
    const body = bookingBody(serviceId, at(futureDate(16), '10:00'));
    const created = (await request(app).post(`/api/v1/public/${p.slug}/appointments`).send(body).expect(201))
      .body.data;
    const res = await request(app)
      .post(`/api/v1/public/${p.slug}/appointment-access`)
      .send({ reference: created.appointment.reference, email: (body.customer as { email: string }).email })
      .expect(202);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no JWT leaked
    const wrong = await request(app)
      .post(`/api/v1/public/${p.slug}/appointment-access`)
      .send({ reference: created.appointment.reference, email: 'other@example.test' })
      .expect(202);
    expect(wrong.body.data.message).toBe(res.body.data.message);
    await drainInlineQueue();
  });

  it('honours requireConfirmation and the guest booking policy', async () => {
    const p = await createTenant(app);
    const { serviceId } = await setupBookable(app, p);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(p))
      .send({ bookingPolicy: { requireConfirmation: true } })
      .expect(200);
    const r = await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .send(bookingBody(serviceId, at(futureDate(17), '10:00')))
      .expect(201);
    expect(r.body.data.appointment.status).toBe('PENDING_CONFIRMATION');
    await request(app)
      .patch('/api/v1/business')
      .set(auth(p))
      .send({ bookingPolicy: { allowGuestBooking: false } })
      .expect(200);
    await request(app)
      .post(`/api/v1/public/${p.slug}/appointments`)
      .send(bookingBody(serviceId, at(futureDate(17), '12:00')))
      .expect(403);
  });
});
