import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { objectId } from '../../common/validation/schemas';
import { ok } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { CustomerModel } from '../customers/customer.models';
import { Errors } from '../../common/errors/app-error';
import { aiAvailability, handleCustomerMessage, startSession } from './ai.service';
import { TOOL_NAMES } from './ai.tools';

const chatBody = z
  .object({
    sessionId: objectId.optional(),
    message: z.string().trim().min(1).max(4000),
    customerId: objectId.optional(),
    contactName: z.string().max(120).optional(),
  })
  .strict();

export function aiRouter(): Router {
  const r = Router();

  r.get('/status', requirePermission(PERMISSIONS.AI_USE), (req, res) => {
    ok(req, res, { ...aiAvailability(), tools: TOOL_NAMES });
  });

  /**
   * Operator-facing AI chat over the API channel (e.g. for an embedded widget backend or testing).
   * Returns INTEGRATION_UNAVAILABLE when no provider is configured — never a fabricated reply.
   */
  r.post('/chat', requirePermission(PERMISSIONS.AI_USE), validate({ body: chatBody }), async (req, res) => {
    const b = valid<z.infer<typeof chatBody>>(res).body;
    const tenantId = req.tenant!.tenantId;
    let sessionId: Types.ObjectId;
    if (b.sessionId) sessionId = new Types.ObjectId(b.sessionId);
    else {
      let customerId: Types.ObjectId | undefined;
      if (b.customerId) {
        const c = await new TenantRepository(CustomerModel, tenantId).findOne({
          _id: b.customerId,
          status: 'ACTIVE',
        });
        if (!c) throw Errors.notFound('Customer');
        customerId = c._id;
      }
      sessionId = (await startSession(tenantId, { customerId, contactName: b.contactName }))._id;
    }
    ok(req, res, await handleCustomerMessage(req.tenant!, sessionId, b.message));
  });

  return r;
}
