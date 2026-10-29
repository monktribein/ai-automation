import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { NOTIFICATION_STATUSES, NotificationModel, type NotificationDoc } from './notification.model';

const listQuery = paginationQuery
  .extend({
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    channel: z.enum(['EMAIL', 'WHATSAPP']).optional(),
    appointmentId: objectId.optional(),
  })
  .strict();

export function notificationRouter(): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission(PERMISSIONS.NOTIFICATIONS_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const repo = new TenantRepository<NotificationDoc>(NotificationModel, req.tenant!.tenantId);
      const filter: Record<string, unknown> = {};
      if (q.status) filter.status = q.status;
      if (q.channel) filter.channel = q.channel;
      if (q.appointmentId) filter.appointmentId = q.appointmentId;
      const [items, total] = await Promise.all([
        repo.find(filter, {
          sort: { createdAt: -1 },
          skip: skipFor(q),
          limit: q.limit,
          projection: { data: 0 },
        }),
        repo.count(filter),
      ]);
      ok(req, res, items, pageMeta(q, total));
    },
  );
  return r;
}
