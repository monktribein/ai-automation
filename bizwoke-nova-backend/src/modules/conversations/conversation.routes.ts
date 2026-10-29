import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { queueNotification } from '../notifications/notification.service';
import {
  AiToolExecutionModel,
  ConversationMessageModel,
  ConversationSessionModel,
  type ConversationMessageDoc,
  type ConversationSessionDoc,
} from './conversation.models';

const listQuery = paginationQuery
  .extend({
    status: z.enum(['OPEN', 'HANDOFF', 'CLOSED']).optional(),
    channel: z.enum(['API', 'WHATSAPP']).optional(),
  })
  .strict();
const statusBody = z
  .object({ status: z.enum(['OPEN', 'HANDOFF', 'CLOSED']), reason: z.string().max(300).optional() })
  .strict();
const replyBody = z.object({ text: z.string().trim().min(1).max(4000) }).strict();

export function conversationRouter(): Router {
  const r = Router();
  const sessions = (req: Express.Request) =>
    new TenantRepository<ConversationSessionDoc>(ConversationSessionModel, req.tenant!.tenantId);
  const messages = (req: Express.Request) =>
    new TenantRepository<ConversationMessageDoc>(ConversationMessageModel, req.tenant!.tenantId);

  r.get(
    '/',
    requirePermission(PERMISSIONS.CONVERSATIONS_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const filter: Record<string, unknown> = {};
      if (q.status) filter.status = q.status;
      if (q.channel) filter.channel = q.channel;
      const [items, total] = await Promise.all([
        sessions(req).find(filter, { sort: { lastMessageAt: -1 }, skip: skipFor(q), limit: q.limit }),
        sessions(req).count(filter),
      ]);
      ok(req, res, items, pageMeta(q, total));
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.CONVERSATIONS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      const session = await sessions(req).getById(id, 'Conversation');
      const msgs = await messages(req).find(
        { sessionId: session._id, $or: [{ text: { $ne: '' } }, { role: { $in: ['agent', 'system'] } }] },
        { sort: { createdAt: 1 }, limit: 500, projection: { content: 0 } },
      );
      ok(req, res, { session, messages: msgs });
    },
  );

  r.get(
    '/:id/tool-executions',
    requirePermission(PERMISSIONS.CONVERSATIONS_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      await sessions(req).getById(id, 'Conversation');
      ok(
        req,
        res,
        await new TenantRepository(AiToolExecutionModel, req.tenant!.tenantId).find(
          { sessionId: new Types.ObjectId(id) },
          { sort: { createdAt: 1 }, limit: 500 },
        ),
      );
    },
  );

  r.patch(
    '/:id/status',
    requirePermission(PERMISSIONS.CONVERSATIONS_WRITE),
    validate({ params: idParam(), body: statusBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof statusBody>>(res);
      await sessions(req).getById(params.id, 'Conversation');
      const set: Record<string, unknown> = { status: body.status };
      if (body.status === 'HANDOFF') {
        set.handoff = {
          reason: body.reason ?? 'Taken over by agent',
          at: new Date(),
          assignedMembershipId: new Types.ObjectId(req.tenant!.actor.membershipId),
        };
      }
      const s = await sessions(req).findOneAndUpdate({ _id: params.id }, { $set: set });
      await audit(originFromRequest(req), {
        action: 'conversation.status_change',
        resourceType: 'conversation',
        resourceId: params.id,
        metadata: { status: body.status },
      });
      ok(req, res, s);
    },
  );

  // Human agent reply. For WhatsApp sessions it is queued to the customer via the provider.
  r.post(
    '/:id/messages',
    requirePermission(PERMISSIONS.CONVERSATIONS_WRITE),
    validate({ params: idParam(), body: replyBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof replyBody>>(res);
      const session = await sessions(req).getById(params.id, 'Conversation');
      if (session.status === 'CLOSED') throw Errors.conflict('Conversation is closed');
      const msg = await messages(req).create({
        sessionId: session._id,
        role: 'agent',
        text: body.text,
        authorUserId: new Types.ObjectId(req.auth!.userId),
        deliveryStatus: session.channel === 'WHATSAPP' ? 'QUEUED' : undefined,
      });
      if (session.channel === 'WHATSAPP' && session.externalUserId) {
        await queueNotification(req.tenant!.tenantId, {
          channel: 'WHATSAPP',
          to: session.externalUserId,
          templateKey: 'free_text',
          data: { text: body.text },
          dedupeKey: `agent-msg:${msg._id}`,
        });
      }
      await sessions(req).updateOne({ _id: session._id }, { $set: { lastMessageAt: new Date() } });
      created(req, res, msg);
    },
  );

  return r;
}
