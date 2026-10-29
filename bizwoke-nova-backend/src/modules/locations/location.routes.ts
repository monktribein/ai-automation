import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, metadata, timezone } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { LocationModel, type LocationDoc } from './location.model';

const body = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    phone: z.string().max(32).optional(),
    timezone: timezone.optional(),
    metadata,
  })
  .strict();
const patchBody = body
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .strict();
const listQuery = paginationQuery.extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict();

export function locationRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) =>
    new TenantRepository<LocationDoc>(LocationModel, req.tenant!.tenantId);

  r.get(
    '/',
    requirePermission(PERMISSIONS.LOCATIONS_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const filter = { status: q.status ?? 'ACTIVE' };
      const [items, total] = await Promise.all([
        repo(req).find(filter, { sort: { name: 1 }, skip: skipFor(q), limit: q.limit }),
        repo(req).count(filter),
      ]);
      ok(req, res, items, pageMeta(q, total));
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.LOCATIONS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      ok(req, res, await repo(req).getById(valid<{ id: string }>(res).params.id, 'Location'));
    },
  );

  r.post('/', requirePermission(PERMISSIONS.LOCATIONS_WRITE), validate({ body }), async (req, res) => {
    const loc = await repo(req).create(valid<z.infer<typeof body>>(res).body);
    await audit(originFromRequest(req), {
      action: 'location.create',
      resourceType: 'location',
      resourceId: loc._id,
    });
    created(req, res, loc);
  });

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.LOCATIONS_WRITE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body: b } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      await repo(req).getById(params.id, 'Location');
      ok(req, res, await repo(req).findOneAndUpdate({ _id: params.id }, { $set: b }));
    },
  );

  // Archive instead of hard delete: locations are referenced by historical appointments.
  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.LOCATIONS_WRITE),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      await repo(req).getById(id, 'Location');
      const loc = await repo(req).findOneAndUpdate({ _id: id }, { $set: { status: 'ARCHIVED' } });
      await audit(originFromRequest(req), {
        action: 'location.archive',
        resourceType: 'location',
        resourceId: id,
      });
      ok(req, res, loc);
    },
  );

  return r;
}
