import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { isoDateTime, objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok } from '../../common/utils/http';
import { PERMISSIONS } from '../permissions/permissions';
import { AuditLogModel } from './audit-log.model';

const listQuery = paginationQuery
  .extend({
    action: z
      .string()
      .regex(/^[a-z_.]+$/)
      .max(100)
      .optional(),
    resourceType: z
      .string()
      .regex(/^[a-zA-Z]+$/)
      .max(60)
      .optional(),
    actorUserId: objectId.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
  })
  .strict();

export function auditRouter(): Router {
  const r = Router();
  r.get('/', requirePermission(PERMISSIONS.AUDIT_READ), validate({ query: listQuery }), async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(res).query;
    // Tenant scoping is mandatory: the tenantId comes from the verified membership only.
    const filter: Record<string, unknown> = { tenantId: req.tenant!.tenantId };
    if (q.action) filter.action = q.action;
    if (q.resourceType) filter.resourceType = q.resourceType;
    if (q.actorUserId) filter.actorUserId = q.actorUserId;
    if (q.from || q.to)
      filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lt: q.to } : {}) };
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter, { ip: 0 }).sort({ createdAt: -1 }).skip(skipFor(q)).limit(q.limit).lean(),
      AuditLogModel.countDocuments(filter),
    ]);
    ok(req, res, items, pageMeta(q, total));
  });
  return r;
}
