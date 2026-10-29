import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, metadata, objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor, sortQuery, toMongoSort } from '../../common/utils/pagination';
import { escapeRegex } from '../../common/utils/text';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { effectiveLimits } from '../usage/usage.service';
import { LocationModel } from '../locations/location.model';
import { StaffServiceAssignmentModel } from '../staff/staff.models';
import { RESERVATION_UNIT_MINUTES } from '../availability/time';
import { ServiceModel, type ServiceDoc } from './service.model';

const minutes = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .refine(
      (v) => v % RESERVATION_UNIT_MINUTES === 0,
      `Must be a multiple of ${RESERVATION_UNIT_MINUTES} minutes`,
    );

export const serviceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    durationMinutes: minutes(1440).refine((v) => v >= 5, 'Minimum 5 minutes'),
    bufferMinutes: minutes(240).default(0),
    price: z.number().min(0).max(10_000_000).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    category: z.string().max(60).optional(),
    locationIds: z.array(objectId).max(50).default([]),
    publiclyBookable: z.boolean().default(true),
    metadata,
  })
  .strict();
const patchBody = serviceBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();
const listQuery = paginationQuery
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
    search: z.string().max(100).optional(),
    sort: sortQuery(['name', 'createdAt', 'durationMinutes'], 'name'),
  })
  .strict();

export function serviceRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) => new TenantRepository<ServiceDoc>(ServiceModel, req.tenant!.tenantId);

  async function assertLocations(tenantId: Types.ObjectId, ids?: string[]) {
    if (!ids?.length) return;
    const n = await new TenantRepository(LocationModel, tenantId).count({
      _id: { $in: ids },
      status: 'ACTIVE',
    });
    if (n !== new Set(ids).size)
      throw Errors.validation('Unknown location', [{ path: 'locationIds', message: 'Unknown location' }]);
  }

  r.get(
    '/',
    requirePermission(PERMISSIONS.SERVICES_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const filter: Record<string, unknown> = { status: q.status ?? { $in: ['ACTIVE', 'INACTIVE'] } };
      if (q.search) filter.name = new RegExp(escapeRegex(q.search), 'i');
      const [items, total] = await Promise.all([
        repo(req).find(filter, { sort: toMongoSort(q.sort), skip: skipFor(q), limit: q.limit }),
        repo(req).count(filter),
      ]);
      ok(req, res, items, pageMeta(q, total));
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.SERVICES_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      const svc = await repo(req).getById(valid<{ id: string }>(res).params.id, 'Service');
      const staff = await new TenantRepository(StaffServiceAssignmentModel, req.tenant!.tenantId).find({
        serviceId: svc._id,
      });
      ok(req, res, { ...svc, staffIds: staff.map((s) => s.staffId) });
    },
  );

  r.post(
    '/',
    requirePermission(PERMISSIONS.SERVICES_WRITE),
    validate({ body: serviceBody }),
    async (req, res) => {
      const b = valid<z.infer<typeof serviceBody>>(res).body;
      const tenantId = req.tenant!.tenantId;
      await assertLocations(tenantId, b.locationIds);
      const limits = await effectiveLimits(tenantId);
      if (
        limits.services !== undefined &&
        (await repo(req).count({ status: { $ne: 'ARCHIVED' } })) >= limits.services
      ) {
        throw Errors.quotaExceeded('services');
      }
      try {
        const svc = await repo(req).create(b);
        await audit(originFromRequest(req), {
          action: 'service.create',
          resourceType: 'service',
          resourceId: svc._id,
        });
        created(req, res, svc);
      } catch (err) {
        if (isDuplicateKeyError(err)) throw Errors.conflict('A service with this name already exists');
        throw err;
      }
    },
  );

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.SERVICES_WRITE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      const current = await repo(req).getById(params.id, 'Service');
      if (current.status === 'ARCHIVED') throw Errors.conflict('Archived services cannot be modified');
      await assertLocations(req.tenant!.tenantId, body.locationIds);
      ok(req, res, await repo(req).findOneAndUpdate({ _id: params.id }, { $set: body }));
    },
  );

  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.SERVICES_WRITE),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      await repo(req).getById(id, 'Service');
      const svc = await repo(req).findOneAndUpdate({ _id: id }, { $set: { status: 'ARCHIVED' } });
      await audit(originFromRequest(req), {
        action: 'service.archive',
        resourceType: 'service',
        resourceId: id,
      });
      ok(req, res, svc);
    },
  );

  return r;
}
