import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  setupBookable,
  futureDate,
  at,
  bookingBody,
  addMember,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import { CustomerModel } from '../../modules/customers/customer.models';
import { ServiceModel } from '../../modules/services/service.model';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { TenantGuardError } from '../../infrastructure/mongodb/tenant-guard.plugin';
import { deliverNotification } from '../../modules/notifications/notification.service';
import { NotificationModel } from '../../modules/notifications/notification.model';
import { processExportJob } from '../../modules/imports-exports/import-export.service';
import { ExportJobModel } from '../../modules/imports-exports/import-export.models';
import { executeTool } from '../../modules/ai/ai.tools';
import { ConversationSessionModel } from '../../modules/conversations/conversation.models';
import { systemContext } from '../../modules/memberships/membership-context';
import { XLSX_MIME } from '../../modules/imports-exports/excel';

let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let bServiceId: string;
let bStaffId: string;
let bCustomerId: string;
let bAppointment: { _id: string; reference: string };
let bConversationId: string;

beforeAll(async () => {
  app = await setupTestApp();
  A = await createTenant(app);
  B = await createTenant(app);
  await setupBookable(app, A);
  ({ serviceId: bServiceId, staffId: bStaffId } = await setupBookable(app, B));
  bCustomerId = (
    await request(app)
      .post('/api/v1/customers')
      .set(auth(B))
      .send({ name: 'B Customer', email: 'b-cust@example.test' })
      .expect(201)
  ).body.data._id;
  bAppointment = (
    await request(app)
      .post('/api/v1/appointments')
      .set(auth(B))
      .send({ serviceId: bServiceId, startAt: at(futureDate(3), '10:00'), customerId: bCustomerId })
      .expect(201)
  ).body.data;
  bConversationId = (
    await ConversationSessionModel.create({
      tenantId: B.tenantId,
      channel: 'API',
      status: 'OPEN',
      turnCount: 0,
      customerId: bCustomerId,
    })
  )._id.toString();
});
afterAll(teardownTestApp);

describe('HTTP API: tenant A cannot touch tenant B resources', () => {
  it('cannot read B customer (404, indistinguishable from missing)', async () => {
    const r = await request(app).get(`/api/v1/customers/${bCustomerId}`).set(auth(A)).expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    const list = await request(app)
      .get('/api/v1/customers')
      .set(auth(A))
      .query({ search: 'b-cust' })
      .expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('cannot update or cancel B appointment', async () => {
    await request(app)
      .patch(`/api/v1/appointments/${bAppointment._id}/status`)
      .set(auth(A))
      .send({ status: 'CANCELLED' })
      .expect(404);
    await request(app)
      .post(`/api/v1/appointments/${bAppointment._id}/reschedule`)
      .set(auth(A))
      .send({ startAt: at(futureDate(3), '12:00') })
      .expect(404);
    await request(app).get(`/api/v1/appointments/${bAppointment._id}/history`).set(auth(A)).expect(404);
    const still = await request(app).get(`/api/v1/appointments/${bAppointment._id}`).set(auth(B)).expect(200);
    expect(still.body.data.status).toBe('CONFIRMED');
  });

  it('cannot delete/archive or modify B service or staff', async () => {
    await request(app).delete(`/api/v1/services/${bServiceId}`).set(auth(A)).expect(404);
    await request(app)
      .patch(`/api/v1/services/${bServiceId}`)
      .set(auth(A))
      .send({ name: 'Hacked' })
      .expect(404);
    await request(app)
      .put(`/api/v1/staff/${bStaffId}/availability`)
      .set(auth(A))
      .send({ weekly: [] })
      .expect(404);
    const svc = await ServiceModel.findOne({ _id: bServiceId, tenantId: B.tenantId }).lean();
    expect(svc!.status).toBe('ACTIVE');
    expect(svc!.name).not.toBe('Hacked');
  });

  it('cannot book B service through A, or attach B customer to A appointment', async () => {
    await request(app)
      .post('/api/v1/appointments')
      .set(auth(A))
      .send(bookingBody(bServiceId, at(futureDate(4), '10:00')))
      .expect(404);
    const { serviceId } = await setupBookable(app, A);
    await request(app)
      .post('/api/v1/appointments')
      .set(auth(A))
      .send({ serviceId, startAt: at(futureDate(4), '10:00'), customerId: bCustomerId })
      .expect(404);
  });

  it('cannot assign B staff or location ids to A records', async () => {
    const r = await request(app)
      .post('/api/v1/members')
      .set(auth(A))
      .send({ email: B.email, roleKeys: ['OPERATOR'], staffId: bStaffId });
    expect([404, 422]).toContain(r.status);
  });

  it('cannot access B conversations', async () => {
    await request(app).get(`/api/v1/conversations/${bConversationId}`).set(auth(A)).expect(404);
    await request(app)
      .post(`/api/v1/conversations/${bConversationId}/messages`)
      .set(auth(A))
      .send({ text: 'hi' })
      .expect(404);
    await request(app)
      .post('/api/v1/ai/chat')
      .set(auth(A))
      .send({ sessionId: bConversationId, message: 'hi' })
      .expect(404);
  });

  it('ignores tenantId smuggled in body, query or headers', async () => {
    const r = await request(app)
      .post('/api/v1/customers')
      .set(auth(A))
      .set('X-Tenant-Id', B.tenantId)
      .send({ name: 'Smuggle', email: 'smuggle@example.test', tenantId: B.tenantId });
    expect(r.status).toBe(422); // unknown field rejected outright
    await request(app).get('/api/v1/customers').set(auth(A)).query({ tenantId: B.tenantId }).expect(422);
    const ok = await request(app)
      .post('/api/v1/customers')
      .set(auth(A))
      .set('X-Tenant-Id', B.tenantId)
      .send({ name: 'Header Smuggle', email: 'hdr@example.test' })
      .expect(201);
    const stored = await CustomerModel.findById(ok.body.data._id, null, { skipTenantGuard: true }).lean();
    expect(stored!.tenantId.toString()).toBe(A.tenantId);
  });

  it('cannot switch into a tenant without membership', async () => {
    await request(app)
      .post('/api/v1/auth/switch-tenant')
      .set(auth(A))
      .send({ tenantId: B.tenantId })
      .expect(403);
    await request(app).get(`/api/v1/tenants/${B.tenantId}`).set(auth(A)).expect(404);
  });

  it('cannot read B audit logs, usage or notifications', async () => {
    const logs = await request(app).get('/api/v1/audit-logs').set(auth(A)).expect(200);
    expect(logs.body.data.every((l: { tenantId: string }) => l.tenantId === A.tenantId)).toBe(true);
    const notes = await request(app).get('/api/v1/notifications').set(auth(A)).expect(200);
    expect(notes.body.data.every((n: { tenantId: string }) => n.tenantId === A.tenantId)).toBe(true);
  });
});

describe('Excel: no cross-tenant import or export', () => {
  it('cannot export B records and A export contains only A data', async () => {
    const job = await request(app).post('/api/v1/exports/customers').set(auth(A)).send({}).expect(202);
    await drainInlineQueue();
    const status = await request(app).get(`/api/v1/exports/${job.body.data.id}`).set(auth(A)).expect(200);
    expect(status.body.data.status).toBe('COMPLETED');
    const file = await request(app)
      .get(`/api/v1/exports/${job.body.data.id}/download`)
      .set(auth(A))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as ArrayBuffer);
    const emails: string[] = [];
    wb.worksheets[0]!.eachRow((row, n) => n > 1 && emails.push(String(row.getCell(3).value)));
    expect(emails).not.toContain('b-cust@example.test');
    // B cannot download A's export by id.
    await request(app).get(`/api/v1/exports/${job.body.data.id}/download`).set(auth(B)).expect(404);
    await request(app).get(`/api/v1/exports/${job.body.data.id}`).set(auth(B)).expect(404);
  });

  it('a tampered export job cannot run against another tenant', async () => {
    const job = await request(app).post('/api/v1/exports/customers').set(auth(A)).send({}).expect(202);
    await drainInlineQueue();
    // Job worker invoked with tenant B id but A's job id => nothing happens.
    await processExportJob(B.tenantId, job.body.data.id);
    const raw = await ExportJobModel.findById(job.body.data.id, null, { skipTenantGuard: true }).lean();
    expect(raw!.tenantId.toString()).toBe(A.tenantId);
  });

  it('import cannot write into another tenant even with a tenantId column', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('customers');
    ws.addRow(['name', 'email', 'tenantId']);
    ws.addRow(['Injected', 'inj@example.test', B.tenantId]);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const r = await request(app)
      .post('/api/v1/imports/customers/validate')
      .set(auth(A))
      .attach('file', buf, { filename: 'x.xlsx', contentType: XLSX_MIME })
      .expect(422);
    expect(r.body.error.message).toMatch(/Unsupported column/);
    expect(await CustomerModel.countDocuments({ tenantId: B.tenantId, email: 'inj@example.test' })).toBe(0);
  });
});

describe('Public slug isolation', () => {
  it('slug A cannot see or act on B resources', async () => {
    await request(app)
      .get(`/api/v1/public/${A.slug}/slots`)
      .query({ serviceId: bServiceId, from: futureDate(3) })
      .expect(404);
    await request(app)
      .post(`/api/v1/public/${A.slug}/appointments`)
      .send(bookingBody(bServiceId, at(futureDate(5), '10:00')))
      .expect(404);
    const staff = await request(app).get(`/api/v1/public/${A.slug}/staff`).expect(200);
    expect(staff.body.data.map((s: { _id: string }) => s._id)).not.toContain(bStaffId);
  });

  it("a manage token from tenant B is useless on tenant A's slug", async () => {
    const pub = await request(app)
      .post(`/api/v1/public/${B.slug}/appointments`)
      .send(bookingBody(bServiceId, at(futureDate(6), '10:00')))
      .expect(201);
    const { appointment, manageToken } = pub.body.data;
    const r = await request(app)
      .patch(`/api/v1/public/${A.slug}/appointments/${appointment.id}`)
      .set('X-Appointment-Token', manageToken)
      .send({ action: 'cancel' });
    expect(r.status).toBe(403);
  });

  it('unknown slugs return 404', async () => {
    await request(app).get('/api/v1/public/does-not-exist').expect(404);
  });
});

describe('Background jobs and AI tools stay within their tenant', () => {
  it('a notification job with a mismatched tenant does nothing', async () => {
    const n = await NotificationModel.create({
      tenantId: B.tenantId,
      channel: 'EMAIL',
      to: 'x@example.test',
      templateKey: 'operational_alert',
      data: {},
      scheduledFor: new Date(),
      status: 'QUEUED',
    });
    await deliverNotification(A.tenantId, n._id.toString());
    const after = await NotificationModel.findOne({ _id: n._id, tenantId: B.tenantId }).lean();
    expect(after!.status).toBe('QUEUED');
    expect(after!.attempts).toBe(0);
  });

  it('AI tools executed for tenant A cannot reach tenant B data', async () => {
    const tenantA = { _id: new Types.ObjectId(A.tenantId), slug: A.slug, timezone: 'UTC' };
    const session = (
      await ConversationSessionModel.create({
        tenantId: A.tenantId,
        channel: 'API',
        status: 'OPEN',
        turnCount: 0,
      })
    ).toObject();
    const ctx = { tenant: systemContext(tenantA, 'ai'), session, toolUseId: 'tool-1' };
    const slots = await executeTool(ctx, 'get_available_slots', {
      serviceId: bServiceId,
      date: futureDate(3),
    });
    expect(slots.status).toBe('REJECTED');
    expect(slots.error).toMatch(/NOT_FOUND/);
    const appt = await executeTool(ctx, 'get_appointment', { reference: bAppointment.reference });
    expect(appt.status).toBe('REJECTED');
    const cancel = await executeTool(ctx, 'cancel_appointment', { reference: bAppointment.reference });
    expect(cancel.status).toBe('REJECTED');
    const svc = await executeTool(ctx, 'list_services', {});
    expect(JSON.stringify(svc.result)).not.toContain(bServiceId);
    const create = await executeTool(ctx, 'create_appointment', {
      serviceId: bServiceId,
      startAt: at(futureDate(7), '10:00'),
      customerName: 'X',
      customerEmail: 'x@example.test',
    });
    expect(create.status).toBe('REJECTED');
  });
});

describe('Data-access layer fails closed', () => {
  it('rejects queries, updates, deletes and aggregations without tenantId', async () => {
    await expect(CustomerModel.find({ email: 'b-cust@example.test' }).lean()).rejects.toThrow(
      TenantGuardError,
    );
    await expect(CustomerModel.updateMany({}, { $set: { name: 'x' } })).rejects.toThrow(TenantGuardError);
    await expect(CustomerModel.deleteMany({})).rejects.toThrow(TenantGuardError);
    await expect(CustomerModel.aggregate([{ $match: {} }])).rejects.toThrow(TenantGuardError);
    await expect(CustomerModel.create({ name: 'No tenant', email: 'none@example.test' })).rejects.toThrow();
  });

  it('rejects tenant reassignment through updates', async () => {
    await expect(
      CustomerModel.updateOne({ tenantId: B.tenantId, _id: bCustomerId }, { $set: { tenantId: A.tenantId } }),
    ).rejects.toThrow(TenantGuardError);
    const repo = new TenantRepository(CustomerModel, new Types.ObjectId(A.tenantId));
    await repo.updateOne({ _id: bCustomerId }, { $set: { name: 'x', tenantId: A.tenantId } });
    const c = await CustomerModel.findOne({ _id: bCustomerId, tenantId: B.tenantId }).lean();
    expect(c!.name).toBe('B Customer');
  });

  it('repository aggregate is always prefixed with the tenant match', async () => {
    const repo = new TenantRepository(CustomerModel, new Types.ObjectId(A.tenantId));
    const rows = await repo.aggregate<{ tenantId: Types.ObjectId }>([
      { $match: {} },
      { $project: { tenantId: 1 } },
    ]);
    expect(rows.every((r) => r.tenantId.toString() === A.tenantId)).toBe(true);
  });
});

describe('Privilege boundaries inside a tenant', () => {
  it('roles cannot grant permissions the creator lacks; operators cannot manage members', async () => {
    const op = await addMember(app, A, ['OPERATOR']);
    await request(app)
      .post('/api/v1/members')
      .set(auth(op))
      .send({ email: 'x@example.test', roleKeys: ['TENANT_ADMIN'] })
      .expect(403);
    await request(app)
      .post('/api/v1/roles')
      .set(auth(op))
      .send({ key: 'SUPER', name: 'x', permissions: ['members:manage'] })
      .expect(403);
    await request(app).get('/api/v1/audit-logs').set(auth(op)).expect(403);
    // Platform role is not a tenant permission and cannot be requested.
    await request(app)
      .post('/api/v1/roles')
      .set(auth(A))
      .send({ key: 'PLATFORM', name: 'x', permissions: ['platform:admin'] })
      .expect(422);
  });

  it('service providers see masked customer contact data only when lacking customers:pii', async () => {
    await request(app)
      .post('/api/v1/roles')
      .set(auth(A))
      .send({ key: 'VIEWER', name: 'Viewer', permissions: ['customers:read'] })
      .expect(201);
    const viewer = await addMember(app, A, ['VIEWER']);
    await request(app)
      .post('/api/v1/customers')
      .set(auth(A))
      .send({ name: 'Masked', email: 'masked.person@example.test', phone: '+15550001234' })
      .expect(201);
    const list = await request(app)
      .get('/api/v1/customers')
      .set(auth(viewer))
      .query({ search: 'Masked' })
      .expect(200);
    expect(list.body.data[0].email).toBe('m***@example.test');
    expect(list.body.data[0].phone).toBe('***234');
    await request(app).post('/api/v1/exports/customers').set(auth(viewer)).send({}).expect(403);
  });

  it('tenant admins cannot change their own membership', async () => {
    const members = await request(app).get('/api/v1/members').set(auth(A)).expect(200);
    const mine = members.body.data.find((m: { userId: string }) => m.userId === A.userId);
    await request(app)
      .patch(`/api/v1/members/${mine._id}`)
      .set(auth(A))
      .send({ roleKeys: ['OPERATOR'] })
      .expect(403);
  });
});
