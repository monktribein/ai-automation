import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { kbRepo, searchKnowledge } from './knowledge.service';

const body = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict();
const patchBody = body
  .partial()
  .extend({ status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']).optional() })
  .strict();
const listQuery = paginationQuery
  .extend({ status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']).optional() })
  .strict();

export function knowledgeRouter(): Router {
  const r = Router();

  r.get(
    '/',
    requirePermission(PERMISSIONS.KNOWLEDGE_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const repo = kbRepo(req.tenant!.tenantId);
      const filter = q.status ? { status: q.status } : { status: { $ne: 'ARCHIVED' } };
      const [items, total] = await Promise.all([
        repo.find(filter, { sort: { updatedAt: -1 }, skip: skipFor(q), limit: q.limit }),
        repo.count(filter),
      ]);
      ok(req, res, items, pageMeta(q, total));
    },
  );

  r.get(
    '/search',
    requirePermission(PERMISSIONS.KNOWLEDGE_READ),
    validate({ query: z.object({ q: z.string().min(1).max(200) }).strict() }),
    async (req, res) => {
      ok(req, res, await searchKnowledge(req.tenant!.tenantId, valid<{ q: string }>(res).query.q, 5));
    },
  );

  r.get(
    '/:id',
    requirePermission(PERMISSIONS.KNOWLEDGE_READ),
    validate({ params: idParam() }),
    async (req, res) => {
      ok(
        req,
        res,
        await kbRepo(req.tenant!.tenantId).getById(valid<{ id: string }>(res).params.id, 'Article'),
      );
    },
  );

  r.post('/', requirePermission(PERMISSIONS.KNOWLEDGE_WRITE), validate({ body }), async (req, res) => {
    const a = await kbRepo(req.tenant!.tenantId).create({
      ...valid<z.infer<typeof body>>(res).body,
      status: 'DRAFT',
    });
    created(req, res, a);
  });

  // Edits to content reset approval: only reviewed text reaches the AI.
  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.KNOWLEDGE_WRITE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body: b } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      const repo = kbRepo(req.tenant!.tenantId);
      await repo.getById(params.id, 'Article');
      const set: Record<string, unknown> = { ...b };
      if ((b.content || b.title) && b.status !== 'APPROVED') set.status = 'DRAFT';
      if (b.status === 'APPROVED')
        Object.assign(set, { approvedBy: new Types.ObjectId(req.auth!.userId), approvedAt: new Date() });
      const a = await repo.findOneAndUpdate({ _id: params.id }, { $set: set });
      if (b.status)
        await audit(originFromRequest(req), {
          action: 'knowledge.status_change',
          resourceType: 'knowledgeArticle',
          resourceId: params.id,
          metadata: { status: b.status },
        });
      ok(req, res, a);
    },
  );

  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.KNOWLEDGE_WRITE),
    validate({ params: idParam() }),
    async (req, res) => {
      const repo = kbRepo(req.tenant!.tenantId);
      const { id } = valid<{ id: string }>(res).params;
      await repo.getById(id, 'Article');
      ok(req, res, await repo.findOneAndUpdate({ _id: id }, { $set: { status: 'ARCHIVED' } }));
    },
  );

  return r;
}
