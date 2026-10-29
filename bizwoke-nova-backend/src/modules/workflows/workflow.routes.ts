import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { Errors } from '../../common/errors/app-error';
import { APPOINTMENT_STATUSES } from '../appointments/appointment.models';
import {
  AutomationWorkflowModel,
  WORKFLOW_TRIGGERS,
  WorkflowExecutionModel,
  type AutomationWorkflowDoc,
} from './workflow.models';

const action = z
  .object({
    type: z.literal('send_notification'),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    recipient: z.enum(['customer', 'fixed']),
    fixedTo: z.string().email().max(254).optional(),
    subject: z.string().max(200).optional(),
    text: z.string().min(1).max(2000),
    offsetMinutes: z.number().int().min(-43_200).max(43_200).default(0),
    relativeTo: z.enum(['event', 'appointment_start']).default('event'),
  })
  .strict()
  .refine(
    (a) => a.recipient !== 'fixed' || (a.fixedTo && a.channel === 'EMAIL'),
    'fixed recipients must be an email address on the EMAIL channel',
  );

const body = z
  .object({
    name: z.string().trim().min(1).max(120),
    trigger: z.enum(WORKFLOW_TRIGGERS),
    conditions: z
      .object({ toStatus: z.enum(APPOINTMENT_STATUSES).optional() })
      .strict()
      .default({}),
    actions: z.array(action).min(1).max(10),
    enabled: z.boolean().default(true),
  })
  .strict();
const patchBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    conditions: z.object({ toStatus: z.enum(APPOINTMENT_STATUSES).optional() }).strict(),
    actions: z.array(action).min(1).max(10),
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export function workflowRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) =>
    new TenantRepository<AutomationWorkflowDoc>(AutomationWorkflowModel, req.tenant!.tenantId);
  r.use(requirePermission(PERMISSIONS.WORKFLOWS_MANAGE));

  r.get('/', validate({ query: paginationQuery.strict() }), async (req, res) => {
    const q = valid<{ page: number; limit: number }>(res).query;
    const [items, total] = await Promise.all([
      repo(req).find({}, { sort: { createdAt: -1 }, skip: skipFor(q), limit: q.limit }),
      repo(req).count(),
    ]);
    ok(req, res, items, pageMeta(q, total));
  });

  r.post('/', validate({ body }), async (req, res) => {
    const b = valid<z.infer<typeof body>>(res).body;
    if (
      b.actions.some((a) => a.relativeTo === 'appointment_start') &&
      !b.trigger.startsWith('appointment.')
    ) {
      throw Errors.validation('appointment_start offsets require an appointment trigger');
    }
    const wf = await repo(req).create(b);
    await audit(originFromRequest(req), {
      action: 'workflow.create',
      resourceType: 'workflow',
      resourceId: wf._id,
    });
    created(req, res, wf);
  });

  r.get('/:id', validate({ params: idParam() }), async (req, res) => {
    ok(req, res, await repo(req).getById(valid<{ id: string }>(res).params.id, 'Workflow'));
  });

  r.patch('/:id', validate({ params: idParam(), body: patchBody }), async (req, res) => {
    const { params, body: b } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
    await repo(req).getById(params.id, 'Workflow');
    ok(req, res, await repo(req).findOneAndUpdate({ _id: params.id }, { $set: b }));
  });

  r.delete('/:id', validate({ params: idParam() }), async (req, res) => {
    const { id } = valid<{ id: string }>(res).params;
    const del = await repo(req).deleteOne({ _id: id });
    if (del.deletedCount === 0) throw Errors.notFound('Workflow');
    await audit(originFromRequest(req), {
      action: 'workflow.delete',
      resourceType: 'workflow',
      resourceId: id,
    });
    ok(req, res, { deleted: true });
  });

  r.get(
    '/:id/executions',
    validate({ params: idParam(), query: paginationQuery.strict() }),
    async (req, res) => {
      const { params, query } = valid<{ id: string; page: number; limit: number }>(res);
      await repo(req).getById(params.id, 'Workflow');
      const execs = new TenantRepository(WorkflowExecutionModel, req.tenant!.tenantId);
      const filter = { workflowId: new Types.ObjectId(params.id) };
      const [items, total] = await Promise.all([
        execs.find(filter, { sort: { createdAt: -1 }, skip: skipFor(query), limit: query.limit }),
        execs.count(filter),
      ]);
      ok(req, res, items, pageMeta(query, total));
    },
  );

  return r;
}
