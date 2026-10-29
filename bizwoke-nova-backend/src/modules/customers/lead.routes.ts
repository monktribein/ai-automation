import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { email, idParam, objectId, phone } from '../../common/validation/schemas';
import { paginationQuery, pageMeta } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { PERMISSIONS } from '../permissions/permissions';
import { LEAD_STATUSES } from './customer.models';
import * as leads from './lead.service';

export const leadBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: email.optional(),
    phone: phone.optional(),
    message: z.string().max(2000).optional(),
    interest: z.string().max(200).optional(),
    sourceDetail: z.string().max(200).optional(),
  })
  .strict()
  .refine((l) => l.email || l.phone, 'Email or phone is required');
const patchBody = z
  .object({
    status: z.enum(LEAD_STATUSES),
    assignedMembershipId: objectId.nullable(),
    interest: z.string().max(200),
  })
  .partial()
  .strict();
const listQuery = paginationQuery
  .extend({
    status: z.enum(LEAD_STATUSES).optional(),
    source: z.enum(['MANUAL', 'PUBLIC', 'WHATSAPP', 'AI', 'IMPORT']).optional(),
    search: z.string().max(100).optional(),
    assignedMembershipId: objectId.optional(),
  })
  .strict();

export function leadRouter(): Router {
  const r = Router();

  r.get('/', requirePermission(PERMISSIONS.LEADS_READ), validate({ query: listQuery }), async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(res).query;
    const { items, total } = await leads.listLeads(req.tenant!.tenantId, q);
    ok(req, res, items, pageMeta(q, total));
  });

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.LEADS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      ok(
        req,
        res,
        await leads.leadRepo(req.tenant!.tenantId).getById(valid<{ id: string }>(res).params.id, 'Lead'),
      );
    },
  );

  r.post('/', requirePermission(PERMISSIONS.LEADS_WRITE), validate({ body: leadBody }), async (req, res) => {
    created(
      req,
      res,
      await leads.createLead(req.tenant!.tenantId, valid<z.infer<typeof leadBody>>(res).body, 'MANUAL'),
    );
  });

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.LEADS_WRITE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      ok(req, res, await leads.updateLead(req.tenant!.tenantId, params.id, body));
    },
  );

  return r;
}
