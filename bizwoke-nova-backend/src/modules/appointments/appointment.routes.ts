import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors/app-error';
import { requireAnyPermission, requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, isoDate, isoDateTime, objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, sortQuery, toMongoSort } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { normalizeEmail } from '../../common/utils/text';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { getAvailableSlots } from '../availability/availability.service';
import { customerBody } from '../customers/customer.routes';
import { customerRepo } from '../customers/customer.service';
import { UserModel } from '../users/user.model';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './appointment.models';
import * as appointments from './appointment.service';

export const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Idempotency-Key must be 8-128 URL-safe characters');

const createBody = z
  .object({
    serviceId: objectId,
    staffId: objectId.optional(),
    startAt: isoDateTime,
    customerId: objectId.optional(),
    customer: customerBody.optional(),
    customerNotes: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (b) => Boolean(b.customerId) !== Boolean(b.customer),
    'Provide exactly one of customerId or customer',
  );

const listQuery = paginationQuery
  .extend({
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    staffId: objectId.optional(),
    serviceId: objectId.optional(),
    customerId: objectId.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    sort: sortQuery(['startAt', 'createdAt'], 'startAt'),
  })
  .strict();

const statusBody = z
  .object({
    status: z.enum(['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'PENDING_CONFIRMATION']),
    reason: z.string().max(500).optional(),
  })
  .strict();
const rescheduleBody = z.object({ startAt: isoDateTime, staffId: objectId.optional() }).strict();
const slotsQuery = z
  .object({ serviceId: objectId, from: isoDate, to: isoDate.optional(), staffId: objectId.optional() })
  .strict();

export function appointmentRouter(): Router {
  const r = Router();

  r.get(
    '/slots',
    requirePermission(PERMISSIONS.APPOINTMENTS_READ),
    validate({ query: slotsQuery }),
    async (req, res) => {
      ok(req, res, await getAvailableSlots(req.tenant!, valid<z.infer<typeof slotsQuery>>(res).query));
    },
  );

  r.get(
    '/',
    requireAnyPermission(PERMISSIONS.APPOINTMENTS_READ, PERMISSIONS.APPOINTMENTS_READ_OWN),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const tenantId = req.tenant!.tenantId;
      let customerIds;
      // CUSTOMER role: restricted to customer records matching the user's own verified email.
      if (!req.tenant!.permissions.has(PERMISSIONS.APPOINTMENTS_READ)) {
        const user = await UserModel.findById(req.auth!.userId, 'email').lean();
        const mine = await customerRepo(tenantId).find(
          { emailNormalized: normalizeEmail(user!.email) },
          { projection: { _id: 1 } },
        );
        customerIds = mine.map((c) => c._id);
      }
      const { items, total } = await appointments.listAppointments(tenantId, {
        ...q,
        customerIds,
        sort: toMongoSort(q.sort),
      });
      ok(req, res, items, pageMeta(q, total));
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.APPOINTMENTS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      ok(
        req,
        res,
        await appointments.getAppointment(req.tenant!.tenantId, valid<{ id: string }>(res).params.id),
      );
    },
  );

  r.get(
    '/:id/history',
    requirePermission(PERMISSIONS.APPOINTMENTS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      ok(
        req,
        res,
        await appointments.appointmentHistory(req.tenant!.tenantId, valid<{ id: string }>(res).params.id),
      );
    },
  );

  r.post(
    '/',
    requirePermission(PERMISSIONS.APPOINTMENTS_WRITE),
    validate({ body: createBody }),
    async (req, res) => {
      const key = req.header('idempotency-key');
      if (key !== undefined && !idempotencyKey.safeParse(key).success)
        throw Errors.validation('Invalid Idempotency-Key header');
      const { appointment, replayed } = await appointments.createAppointment(
        req.tenant!,
        valid<z.infer<typeof createBody>>(res).body,
        {
          source: 'STAFF',
          idempotencyKey: key,
          enforcePolicy: false,
        },
      );
      if (!replayed)
        await audit(originFromRequest(req), {
          action: 'appointment.create',
          resourceType: 'appointment',
          resourceId: appointment._id,
        });
      if (replayed) return ok(req, res, appointment, { idempotentReplay: true });
      created(req, res, appointment);
    },
  );

  r.patch(
    '/:id/status',
    requirePermission(PERMISSIONS.APPOINTMENTS_WRITE),
    validate({ params: idParam(), body: statusBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof statusBody>>(res);
      const a = await appointments.transition(req.tenant!, params.id, body.status as AppointmentStatus, {
        reason: body.reason,
      });
      await audit(originFromRequest(req), {
        action: 'appointment.status_change',
        resourceType: 'appointment',
        resourceId: a._id,
        metadata: { to: body.status },
      });
      ok(req, res, a);
    },
  );

  r.post(
    '/:id/reschedule',
    requirePermission(PERMISSIONS.APPOINTMENTS_WRITE),
    validate({ params: idParam(), body: rescheduleBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof rescheduleBody>>(res);
      const a = await appointments.reschedule(req.tenant!, params.id, body, { enforcePolicy: false });
      await audit(originFromRequest(req), {
        action: 'appointment.reschedule',
        resourceType: 'appointment',
        resourceId: a._id,
      });
      ok(req, res, a);
    },
  );

  return r;
}
