import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { authenticate, requireSuperAdmin } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, objectId, slug, timezone } from '../../common/validation/schemas';
import { paginationQuery, pageMeta } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { MembershipModel } from '../memberships/membership.model';
import { UserModel } from '../users/user.model';
import { TenantModel } from './tenant.model';
import { TenantSettingsModel } from '../business-config/tenant-settings.model';

const featuresBody = z
  .object({
    ai: z.boolean(),
    whatsapp: z.boolean(),
    excel: z.boolean(),
    publicBooking: z.boolean(),
    workflows: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'At least one feature is required');
import * as tenants from './tenant.service';

const createBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug,
    timezone: timezone.default('UTC'),
    locale: z.string().min(2).max(10).default('en'),
    category: z.string().trim().max(60).optional(),
    ownerUserId: objectId.optional(),
  })
  .strict();

const patchBody = z
  .object({ name: z.string().trim().min(2).max(120), slug, timezone, locale: z.string().min(2).max(10) })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'At least one field is required');

const statusBody = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().max(500).optional() })
  .strict();

const listQuery = paginationQuery
  .extend({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
    search: z.string().max(100).optional(),
  })
  .strict();

const tenantParam = idParam('tenantId');

export function tenantRouter(): Router {
  const r = Router();
  r.use(authenticate);

  // Platform administration only.
  r.post('/', requireSuperAdmin, validate({ body: createBody }), async (req, res) => {
    const b = valid<z.infer<typeof createBody>>(res).body;
    if (b.ownerUserId && !(await UserModel.exists({ _id: b.ownerUserId, status: 'ACTIVE' }))) {
      throw Errors.validation('Owner user does not exist', [
        { path: 'ownerUserId', message: 'Unknown user' },
      ]);
    }
    const tenant = await tenants.provisionTenant(
      b,
      b.ownerUserId ? new Types.ObjectId(b.ownerUserId) : undefined,
      new Types.ObjectId(req.auth!.userId),
    );
    await audit(
      { ...originFromRequest(req), tenantId: tenant._id },
      { action: 'tenant.create', resourceType: 'tenant', resourceId: tenant._id },
    );
    created(req, res, tenant);
  });

  // Super admins see all tenants; everyone else sees only tenants they are a member of.
  r.get('/', validate({ query: listQuery }), async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(res).query;
    if (req.auth!.platformRole === 'SUPER_ADMIN') {
      const { items, total } = await tenants.listTenants(q);
      return ok(req, res, items, pageMeta(q, total));
    }
    const ids = await tenants.tenantIdsForUser(req.auth!.userId);
    const items = await TenantModel.find(
      { _id: { $in: ids } },
      'name slug status timezone locale createdAt',
    ).lean();
    ok(req, res, items, pageMeta({ page: 1, limit: Math.max(items.length, 1) }, items.length));
  });

  r.get('/:tenantId', validate({ params: tenantParam }), async (req, res) => {
    const { tenantId } = valid<{ tenantId: string }>(res).params;
    if (req.auth!.platformRole !== 'SUPER_ADMIN') {
      const member = await MembershipModel.exists({
        tenantId: new Types.ObjectId(tenantId),
        userId: req.auth!.userId,
        status: 'ACTIVE',
      });
      if (!member) throw Errors.notFound('Tenant');
    }
    ok(req, res, await tenants.getTenant(tenantId));
  });

  r.patch(
    '/:tenantId',
    requireSuperAdmin,
    validate({ params: tenantParam, body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ tenantId: string } & z.infer<typeof patchBody>>(res);
      const t = await tenants.updateTenant(params.tenantId, body);
      await audit(
        { ...originFromRequest(req), tenantId: t._id },
        {
          action: 'tenant.update',
          resourceType: 'tenant',
          resourceId: t._id,
          metadata: { fields: Object.keys(body) },
        },
      );
      ok(req, res, t);
    },
  );

  r.patch(
    '/:tenantId/status',
    requireSuperAdmin,
    validate({ params: tenantParam, body: statusBody }),
    async (req, res) => {
      const { params, body } = valid<{ tenantId: string } & z.infer<typeof statusBody>>(res);
      const t = await tenants.setTenantStatus(params.tenantId, body.status, body.reason);
      await audit(
        { ...originFromRequest(req), tenantId: t._id },
        {
          action: 'tenant.status_change',
          resourceType: 'tenant',
          resourceId: t._id,
          metadata: { status: body.status },
        },
      );
      ok(req, res, t);
    },
  );

  // Feature entitlements are platform-controlled; tenants cannot grant themselves features.
  r.patch(
    '/:tenantId/features',
    requireSuperAdmin,
    validate({ params: tenantParam, body: featuresBody }),
    async (req, res) => {
      const { params, body } = valid<{ tenantId: string } & z.infer<typeof featuresBody>>(res);
      const tenantId = new Types.ObjectId(params.tenantId);
      if (!(await TenantModel.exists({ _id: tenantId }))) throw Errors.notFound('Tenant');
      const set = Object.fromEntries(Object.entries(body).map(([k, v]) => [`features.${k}`, v]));
      const settings = await TenantSettingsModel.findOneAndUpdate(
        { tenantId },
        { $set: set },
        { new: true, projection: { features: 1 } },
      ).lean();
      await audit(
        { ...originFromRequest(req), tenantId },
        { action: 'tenant.features_update', resourceType: 'tenant', resourceId: tenantId, metadata: body },
      );
      ok(req, res, settings?.features);
    },
  );

  return r;
}
