import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { hhmm, idParam, isoDateTime, metadata, objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { effectiveLimits } from '../usage/usage.service';
import { ServiceModel } from '../services/service.model';
import { LocationModel } from '../locations/location.model';
import {
  AvailabilityExceptionModel,
  StaffAvailabilityModel,
  StaffModel,
  StaffServiceAssignmentModel,
  type StaffDoc,
} from './staff.models';

export const staffBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z.string().max(32).optional(),
    title: z.string().max(120).optional(),
    bio: z.string().max(2000).optional(),
    locationId: objectId.optional(),
    capacity: z.number().int().min(1).max(50).default(1),
    publiclyVisible: z.boolean().default(true),
    serviceIds: z.array(objectId).max(200).optional(),
    metadata,
  })
  .strict();
const patchBody = staffBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();
const listQuery = paginationQuery
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(), serviceId: objectId.optional() })
  .strict();

const rangeSchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    start: hhmm,
    end: z.union([hhmm, z.literal('24:00')]),
  })
  .strict()
  .refine((r) => r.start < r.end, 'start must be before end');
const availabilityBody = z
  .object({ weekly: z.array(rangeSchema).max(50), breaks: z.array(rangeSchema).max(50).default([]) })
  .strict();
const exceptionBody = z
  .object({
    type: z.enum(['LEAVE', 'HOLIDAY', 'BLOCK']),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: z.string().max(300).optional(),
  })
  .strict()
  .refine((e) => e.startsAt < e.endsAt, 'startsAt must be before endsAt');
const staffParam = idParam('staffId');

export async function setStaffServices(
  tenantId: Types.ObjectId,
  staffId: Types.ObjectId,
  serviceIds: string[],
) {
  const unique = [...new Set(serviceIds)];
  const found = await new TenantRepository(ServiceModel, tenantId).count({
    _id: { $in: unique },
    status: { $ne: 'ARCHIVED' },
  });
  if (found !== unique.length)
    throw Errors.validation('Unknown service', [{ path: 'serviceIds', message: 'Unknown service' }]);
  const assignments = new TenantRepository(StaffServiceAssignmentModel, tenantId);
  await assignments.deleteMany({ staffId, serviceId: { $nin: unique.map((id) => new Types.ObjectId(id)) } });
  for (const serviceId of unique) {
    await StaffServiceAssignmentModel.updateOne(
      { tenantId, staffId, serviceId: new Types.ObjectId(serviceId) },
      { $setOnInsert: { tenantId, staffId, serviceId: new Types.ObjectId(serviceId) } },
      { upsert: true },
    );
  }
}

export function staffRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) => new TenantRepository<StaffDoc>(StaffModel, req.tenant!.tenantId);

  async function assertLocation(tenantId: Types.ObjectId, id?: string) {
    if (id && !(await new TenantRepository(LocationModel, tenantId).findOne({ _id: id, status: 'ACTIVE' }))) {
      throw Errors.validation('Unknown location', [{ path: 'locationId', message: 'Unknown location' }]);
    }
  }

  r.get('/', requirePermission(PERMISSIONS.STAFF_READ), validate({ query: listQuery }), async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(res).query;
    const filter: Record<string, unknown> = { status: q.status ?? { $in: ['ACTIVE', 'INACTIVE'] } };
    if (q.serviceId) {
      const a = await new TenantRepository(StaffServiceAssignmentModel, req.tenant!.tenantId).find({
        serviceId: new Types.ObjectId(q.serviceId),
      });
      filter._id = { $in: a.map((x) => x.staffId) };
    }
    const [items, total] = await Promise.all([
      repo(req).find(filter, { sort: { name: 1 }, skip: skipFor(q), limit: q.limit }),
      repo(req).count(filter),
    ]);
    ok(req, res, items, pageMeta(q, total));
  });

  r.get(
    '/:staffId',
    requirePermission(PERMISSIONS.STAFF_READ),
    validate({ params: staffParam }),
    async (req, res) => {
      const staff = await repo(req).getById(valid<{ staffId: string }>(res).params.staffId, 'Staff');
      const a = await new TenantRepository(StaffServiceAssignmentModel, req.tenant!.tenantId).find({
        staffId: staff._id,
      });
      ok(req, res, { ...staff, serviceIds: a.map((x) => x.serviceId) });
    },
  );

  r.post('/', requirePermission(PERMISSIONS.STAFF_WRITE), validate({ body: staffBody }), async (req, res) => {
    const { serviceIds, ...b } = valid<z.infer<typeof staffBody>>(res).body;
    const tenantId = req.tenant!.tenantId;
    await assertLocation(tenantId, b.locationId);
    const limits = await effectiveLimits(tenantId);
    if (
      limits.staff !== undefined &&
      (await repo(req).count({ status: { $ne: 'ARCHIVED' } })) >= limits.staff
    ) {
      throw Errors.quotaExceeded('staff');
    }
    try {
      const staff = await repo(req).create(b);
      if (serviceIds) await setStaffServices(tenantId, staff._id, serviceIds);
      await audit(originFromRequest(req), {
        action: 'staff.create',
        resourceType: 'staff',
        resourceId: staff._id,
      });
      created(req, res, { ...staff, serviceIds: serviceIds ?? [] });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw Errors.conflict('A staff member with this email already exists');
      throw err;
    }
  });

  r.patch(
    '/:staffId',
    requirePermission(PERMISSIONS.STAFF_WRITE),
    validate({ params: staffParam, body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ staffId: string } & z.infer<typeof patchBody>>(res);
      const { serviceIds, ...b } = body;
      const staff = await repo(req).getById(params.staffId, 'Staff');
      if (staff.status === 'ARCHIVED') throw Errors.conflict('Archived staff cannot be modified');
      await assertLocation(req.tenant!.tenantId, b.locationId);
      const updated = await repo(req).findOneAndUpdate({ _id: params.staffId }, { $set: b });
      if (serviceIds) await setStaffServices(req.tenant!.tenantId, staff._id, serviceIds);
      ok(req, res, updated);
    },
  );

  r.delete(
    '/:staffId',
    requirePermission(PERMISSIONS.STAFF_WRITE),
    validate({ params: staffParam }),
    async (req, res) => {
      const { staffId } = valid<{ staffId: string }>(res).params;
      await repo(req).getById(staffId, 'Staff');
      const staff = await repo(req).findOneAndUpdate({ _id: staffId }, { $set: { status: 'ARCHIVED' } });
      await audit(originFromRequest(req), {
        action: 'staff.archive',
        resourceType: 'staff',
        resourceId: staffId,
      });
      ok(req, res, staff);
    },
  );

  // Weekly schedule (business timezone) + breaks.
  r.get(
    '/:staffId/availability',
    requirePermission(PERMISSIONS.STAFF_READ),
    validate({ params: staffParam }),
    async (req, res) => {
      const { staffId } = valid<{ staffId: string }>(res).params;
      await repo(req).getById(staffId, 'Staff');
      const tenantId = req.tenant!.tenantId;
      const [schedule, exceptions] = await Promise.all([
        new TenantRepository(StaffAvailabilityModel, tenantId).findOne({
          staffId: new Types.ObjectId(staffId),
        }),
        new TenantRepository(AvailabilityExceptionModel, tenantId).find(
          { staffId: new Types.ObjectId(staffId), endsAt: { $gte: new Date() } },
          { sort: { startsAt: 1 }, limit: 200 },
        ),
      ]);
      ok(req, res, { schedule: schedule ?? null, followsBusinessHours: !schedule, exceptions });
    },
  );

  r.put(
    '/:staffId/availability',
    requirePermission(PERMISSIONS.AVAILABILITY_WRITE),
    validate({ params: staffParam, body: availabilityBody }),
    async (req, res) => {
      const { params, body } = valid<{ staffId: string } & z.infer<typeof availabilityBody>>(res);
      await repo(req).getById(params.staffId, 'Staff');
      const tenantId = req.tenant!.tenantId;
      const staffId = new Types.ObjectId(params.staffId);
      await StaffAvailabilityModel.updateOne(
        { tenantId, staffId },
        { $set: { weekly: body.weekly, breaks: body.breaks }, $setOnInsert: { tenantId, staffId } },
        { upsert: true, runValidators: true },
      );
      await audit(originFromRequest(req), {
        action: 'staff.availability_update',
        resourceType: 'staff',
        resourceId: staffId,
      });
      ok(req, res, await new TenantRepository(StaffAvailabilityModel, tenantId).findOne({ staffId }));
    },
  );

  r.post(
    '/:staffId/exceptions',
    requirePermission(PERMISSIONS.AVAILABILITY_WRITE),
    validate({ params: staffParam, body: exceptionBody }),
    async (req, res) => {
      const { params, body } = valid<{ staffId: string } & z.infer<typeof exceptionBody>>(res);
      await repo(req).getById(params.staffId, 'Staff');
      const ex = await new TenantRepository(AvailabilityExceptionModel, req.tenant!.tenantId).create({
        ...body,
        staffId: new Types.ObjectId(params.staffId),
      });
      created(req, res, ex);
    },
  );

  r.delete(
    '/:staffId/exceptions/:id',
    requirePermission(PERMISSIONS.AVAILABILITY_WRITE),
    validate({ params: z.object({ staffId: objectId, id: objectId }) }),
    async (req, res) => {
      const { staffId, id } = valid<{ staffId: string; id: string }>(res).params;
      const del = await new TenantRepository(AvailabilityExceptionModel, req.tenant!.tenantId).deleteOne({
        _id: id,
        staffId: new Types.ObjectId(staffId),
      });
      if (del.deletedCount === 0) throw Errors.notFound('Availability exception');
      ok(req, res, { deleted: true });
    },
  );

  return r;
}

/** Business-wide closures (holidays) — not tied to a staff member. */
export function closureRouter(): Router {
  const r = Router();
  r.get('/', requirePermission(PERMISSIONS.STAFF_READ), async (req, res) => {
    ok(
      req,
      res,
      await new TenantRepository(AvailabilityExceptionModel, req.tenant!.tenantId).find(
        { staffId: { $exists: false }, endsAt: { $gte: new Date() } },
        { sort: { startsAt: 1 }, limit: 200 },
      ),
    );
  });
  r.post(
    '/',
    requirePermission(PERMISSIONS.AVAILABILITY_WRITE),
    validate({ body: exceptionBody }),
    async (req, res) => {
      const ex = await new TenantRepository(AvailabilityExceptionModel, req.tenant!.tenantId).create(
        valid<z.infer<typeof exceptionBody>>(res).body,
      );
      await audit(originFromRequest(req), {
        action: 'business.closure_create',
        resourceType: 'availabilityException',
        resourceId: ex._id,
      });
      created(req, res, ex);
    },
  );
  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.AVAILABILITY_WRITE),
    validate({ params: idParam() }),
    async (req, res) => {
      const del = await new TenantRepository(AvailabilityExceptionModel, req.tenant!.tenantId).deleteOne({
        _id: valid<{ id: string }>(res).params.id,
        staffId: { $exists: false },
      });
      if (del.deletedCount === 0) throw Errors.notFound('Closure');
      ok(req, res, { deleted: true });
    },
  );
  return r;
}
