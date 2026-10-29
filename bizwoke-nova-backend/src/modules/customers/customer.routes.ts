import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { email, idParam, phone } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, sortQuery, toMongoSort } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { listAppointments } from '../appointments/appointment.service';
import * as customers from './customer.service';

const consent = z
  .object({ email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean(), marketing: z.boolean() })
  .partial()
  .strict();
export const customerBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: email.optional(),
    phone: phone.optional(),
    preferredLanguage: z.string().min(2).max(10).optional(),
    consent: consent.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict()
  .refine((c) => c.email || c.phone, 'Email or phone is required');
const patchBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: email,
    phone: phone,
    preferredLanguage: z.string().min(2).max(10),
    consent,
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    notes: z.string().max(1000),
  })
  .partial()
  .strict();
const listQuery = paginationQuery
  .extend({
    search: z.string().max(100).optional(),
    tag: z.string().max(40).optional(),
    sort: sortQuery(['name', 'createdAt'], '-createdAt'),
  })
  .strict();

export function customerRouter(): Router {
  const r = Router();
  const pii = (req: Express.Request) => req.tenant!.permissions.has(PERMISSIONS.CUSTOMERS_PII);

  r.get(
    '/',
    requirePermission(PERMISSIONS.CUSTOMERS_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const { items, total } = await customers.searchCustomers(req.tenant!.tenantId, {
        ...q,
        sort: toMongoSort(q.sort),
      });
      ok(
        req,
        res,
        items.map((c) => customers.redactCustomer(c, pii(req))),
        pageMeta(q, total),
      );
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.CUSTOMERS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      const c = await customers
        .customerRepo(req.tenant!.tenantId)
        .getById(valid<{ id: string }>(res).params.id, 'Customer');
      ok(req, res, customers.redactCustomer(c, pii(req)));
    },
  );

  r.get(
    '/:id/appointments',
    requirePermission(PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.APPOINTMENTS_READ),
    validate({ params: idParam(), query: paginationQuery.strict() }),
    async (req, res) => {
      const { params, query } = valid<{ id: string; page: number; limit: number }>(res);
      await customers.customerRepo(req.tenant!.tenantId).getById(params.id, 'Customer');
      const { items, total } = await listAppointments(req.tenant!.tenantId, {
        ...query,
        customerId: params.id,
        sort: { startAt: -1 },
      });
      ok(req, res, items, pageMeta(query, total));
    },
  );

  r.post(
    '/',
    requirePermission(PERMISSIONS.CUSTOMERS_WRITE),
    validate({ body: customerBody }),
    async (req, res) => {
      const c = await customers.createCustomer(
        req.tenant!.tenantId,
        valid<z.infer<typeof customerBody>>(res).body,
      );
      await audit(originFromRequest(req), {
        action: 'customer.create',
        resourceType: 'customer',
        resourceId: c._id,
      });
      created(req, res, customers.redactCustomer(c, pii(req)));
    },
  );

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.CUSTOMERS_WRITE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      const c = await customers.updateCustomer(req.tenant!.tenantId, params.id, body);
      if (body.consent)
        await audit(originFromRequest(req), {
          action: 'customer.consent_update',
          resourceType: 'customer',
          resourceId: params.id,
          metadata: body.consent,
        });
      ok(req, res, customers.redactCustomer(c!, pii(req)));
    },
  );

  // Erasure: anonymizes PII, keeps de-identified booking history.
  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.CUSTOMERS_DELETE),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      await customers.anonymizeCustomer(req.tenant!.tenantId, id);
      await audit(originFromRequest(req), {
        action: 'customer.anonymize',
        resourceType: 'customer',
        resourceId: new Types.ObjectId(id),
      });
      ok(req, res, { anonymized: true });
    },
  );

  return r;
}
