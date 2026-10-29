import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  setupBookable,
  futureDate,
  at,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import { NotificationModel } from '../../modules/notifications/notification.model';
import { WorkflowExecutionModel } from '../../modules/workflows/workflow.models';
import { runWorkflows } from '../../modules/workflows/workflow.service';

let app: Express;
let t: TenantFixture;
let serviceId: string;
beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app);
  ({ serviceId } = await setupBookable(app, t));
});
afterAll(teardownTestApp);

describe('automation workflows', () => {
  it('schedules a follow-up relative to appointment start, exactly once per event', async () => {
    const wf = await request(app)
      .post('/api/v1/workflows')
      .set(auth(t))
      .send({
        name: 'Post-visit follow-up',
        trigger: 'appointment.created',
        actions: [
          {
            type: 'send_notification',
            channel: 'EMAIL',
            recipient: 'customer',
            subject: 'Thanks {{customerName}}',
            text: 'See you at {{businessName}} ({{reference}})',
            offsetMinutes: 120,
            relativeTo: 'appointment_start',
          },
        ],
      })
      .expect(201);
    const appt = await request(app)
      .post('/api/v1/appointments')
      .set(auth(t))
      .send({
        serviceId,
        startAt: at(futureDate(5), '10:00'),
        customer: { name: 'Flow Person', email: 'flow@example.test' },
      })
      .expect(201);
    await drainInlineQueue();

    const n = await NotificationModel.findOne({
      tenantId: t.tenantId,
      dedupeKey: { $regex: `^wf:${wf.body.data._id}` },
    }).lean();
    expect(n!.scheduledFor.getTime()).toBe(new Date(appt.body.data.startAt).getTime() + 120 * 60_000);
    expect(n!.data.subject).toBe('Thanks Flow Person');
    expect(n!.data.text).toContain(appt.body.data.reference);

    // Re-running the same event is a no-op (idempotent execution record).
    await runWorkflows({
      tenantId: t.tenantId,
      trigger: 'appointment.created',
      entityId: appt.body.data._id,
      eventKey: `appointment.created:${appt.body.data._id}`,
    });
    expect(
      await WorkflowExecutionModel.countDocuments({ tenantId: t.tenantId, workflowId: wf.body.data._id }),
    ).toBe(1);
    const execs = await request(app)
      .get(`/api/v1/workflows/${wf.body.data._id}/executions`)
      .set(auth(t))
      .expect(200);
    expect(execs.body.data[0].actionsQueued).toBe(1);
  });

  it('filters on status conditions and validates definitions', async () => {
    await request(app)
      .post('/api/v1/workflows')
      .set(auth(t))
      .send({
        name: 'x',
        trigger: 'lead.created',
        actions: [
          {
            type: 'send_notification',
            channel: 'EMAIL',
            recipient: 'customer',
            text: 'hi',
            relativeTo: 'appointment_start',
          },
        ],
      })
      .expect(422);
    await request(app)
      .post('/api/v1/workflows')
      .set(auth(t))
      .send({
        name: 'x',
        trigger: 'lead.created',
        actions: [
          {
            type: 'send_notification',
            channel: 'WHATSAPP',
            recipient: 'fixed',
            fixedTo: 'a@example.test',
            text: 'hi',
          },
        ],
      })
      .expect(422);
    await request(app)
      .post('/api/v1/workflows')
      .set(auth(t))
      .send({ name: 'x', trigger: 'unknown.event', actions: [] })
      .expect(422);
    const wf = await request(app)
      .post('/api/v1/workflows')
      .set(auth(t))
      .send({
        name: 'No-show nudge',
        trigger: 'appointment.status_changed',
        conditions: { toStatus: 'NO_SHOW' },
        actions: [
          {
            type: 'send_notification',
            channel: 'EMAIL',
            recipient: 'fixed',
            fixedTo: 'frontdesk@example.test',
            text: '{{customerName}} did not show',
          },
        ],
      })
      .expect(201);
    const appt = await request(app)
      .post('/api/v1/appointments')
      .set(auth(t))
      .send({
        serviceId,
        startAt: at(futureDate(6), '10:00'),
        customer: { name: 'Absent', email: 'absent@example.test' },
      })
      .expect(201);
    await request(app)
      .patch(`/api/v1/appointments/${appt.body.data._id}/status`)
      .set(auth(t))
      .send({ status: 'CHECKED_IN' })
      .expect(200);
    await drainInlineQueue();
    expect(
      await NotificationModel.countDocuments({ tenantId: t.tenantId, to: 'frontdesk@example.test' }),
    ).toBe(0);
    expect(wf.body.data.enabled).toBe(true);
  });
});
