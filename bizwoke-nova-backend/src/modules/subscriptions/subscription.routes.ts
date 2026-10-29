import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import {
  authenticate,
  requirePermission,
  requireSuperAdmin,
  requireTenant,
} from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, objectId } from '../../common/validation/schemas';
import { ok, created } from '../../common/utils/http';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { TenantModel } from '../tenants/tenant.model';
import { effectiveLimits, usageSummary } from '../usage/usage.service';
import { SubscriptionPlanModel, TenantSubscriptionModel } from './subscription.models';

const limits = z
  .object({
    appointmentsPerMonth: z.number().int().min(0),
    aiMessagesPerMonth: z.number().int().min(0),
    aiTokensPerMonth: z.number().int().min(0),
    whatsappMessagesPerMonth: z.number().int().min(0),
    exportsPerMonth: z.number().int().min(0),
    importsPerMonth: z.number().int().min(0),
    staff: z.number().int().min(0),
    services: z.number().int().min(0),
  })
  .partial()
  .strict();
const planBody = z
  .object({
    code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name: z.string().min(1).max(80),
    features: z.array(z.string().max(40)).max(50).default([]),
    limits: limits.default({}),
    isDefault: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
const assignBody = z
  .object({
    planId: objectId,
    status: z.enum(['ACTIVE', 'PAST_DUE', 'CANCELLED']).default('ACTIVE'),
    limitOverrides: limits.default({}),
  })
  .strict();

export function subscriptionRouter(): Router {
  const r = Router();
  r.use(authenticate);

  // Platform catalog (globally shared). Readable by any authenticated user, managed by SUPER_ADMIN.
  r.get('/plans', async (req, res) => {
    ok(req, res, await SubscriptionPlanModel.find({ active: true }).sort({ code: 1 }).lean());
  });

  r.post('/plans', requireSuperAdmin, validate({ body: planBody }), async (req, res) => {
    const b = valid<z.infer<typeof planBody>>(res).body;
    try {
      if (b.isDefault)
        await SubscriptionPlanModel.updateMany({ isDefault: true }, { $set: { isDefault: false } });
      const plan = await SubscriptionPlanModel.create(b);
      await audit(originFromRequest(req), {
        action: 'plan.create',
        resourceType: 'subscriptionPlan',
        resourceId: plan._id,
      });
      created(req, res, plan);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw Errors.conflict('Plan code already exists');
      throw err;
    }
  });

  r.patch(
    '/plans/:id',
    requireSuperAdmin,
    validate({ params: idParam(), body: planBody.partial().strict() }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & Partial<z.infer<typeof planBody>>>(res);
      if (body.isDefault)
        await SubscriptionPlanModel.updateMany(
          { isDefault: true, _id: { $ne: params.id } },
          { $set: { isDefault: false } },
        );
      const plan = await SubscriptionPlanModel.findByIdAndUpdate(
        params.id,
        { $set: body },
        { new: true, runValidators: true },
      ).lean();
      if (!plan) throw Errors.notFound('Plan');
      ok(req, res, plan);
    },
  );

  // Platform admin assigns a plan to a tenant. Tenant admins cannot change their own entitlements.
  r.put(
    '/tenants/:tenantId',
    requireSuperAdmin,
    validate({ params: idParam('tenantId'), body: assignBody }),
    async (req, res) => {
      const { params, body } = valid<{ tenantId: string } & z.infer<typeof assignBody>>(res);
      const tenantId = new Types.ObjectId(params.tenantId);
      if (!(await TenantModel.exists({ _id: tenantId }))) throw Errors.notFound('Tenant');
      if (!(await SubscriptionPlanModel.exists({ _id: body.planId }))) throw Errors.notFound('Plan');
      await TenantSubscriptionModel.updateOne(
        { tenantId },
        {
          $set: {
            planId: new Types.ObjectId(body.planId),
            status: body.status,
            limitOverrides: body.limitOverrides,
          },
          $setOnInsert: { tenantId, startedAt: new Date() },
        },
        { upsert: true, runValidators: true },
      );
      await audit(
        { ...originFromRequest(req), tenantId },
        {
          action: 'subscription.assign',
          resourceType: 'tenantSubscription',
          resourceId: tenantId,
          metadata: { planId: body.planId },
        },
      );
      ok(req, res, await TenantSubscriptionModel.findOne({ tenantId }).lean());
    },
  );

  r.get('/current', requireTenant, requirePermission(PERMISSIONS.USAGE_READ), async (req, res) => {
    const tenantId = req.tenant!.tenantId;
    const sub = await TenantSubscriptionModel.findOne({ tenantId }).lean();
    ok(req, res, { subscription: sub, effectiveLimits: await effectiveLimits(tenantId) });
  });

  return r;
}

export function usageRouter(): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission(PERMISSIONS.USAGE_READ),
    validate({
      query: z
        .object({
          period: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
        .strict(),
    }),
    async (req, res) => {
      ok(req, res, await usageSummary(req.tenant!.tenantId, valid<{ period?: string }>(res).query.period));
    },
  );
  return r;
}
