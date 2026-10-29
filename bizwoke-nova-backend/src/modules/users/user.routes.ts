import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors/app-error';
import { authenticate, requireSuperAdmin } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { escapeRegex } from '../../common/utils/text';
import { ok } from '../../common/utils/http';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { RefreshTokenModel } from '../auth/auth.models';
import { PUBLIC_USER_FIELDS, UserModel } from './user.model';

const listQuery = paginationQuery
  .extend({ search: z.string().max(100).optional(), status: z.enum(['ACTIVE', 'DEACTIVATED']).optional() })
  .strict();
const statusBody = z
  .object({ status: z.enum(['ACTIVE', 'DEACTIVATED']), reason: z.string().max(300).optional() })
  .strict();

/** Platform account administration (SUPER_ADMIN only). */
export function userRouter(): Router {
  const r = Router();
  r.use(authenticate, requireSuperAdmin);

  r.get('/', validate({ query: listQuery }), async (req, res) => {
    const q = valid<z.infer<typeof listQuery>>(res).query;
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.search)
      filter.$or = [
        { email: new RegExp(escapeRegex(q.search), 'i') },
        { name: new RegExp(escapeRegex(q.search), 'i') },
      ];
    const [items, total] = await Promise.all([
      UserModel.find(filter, PUBLIC_USER_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skipFor(q))
        .limit(q.limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);
    ok(req, res, items, pageMeta(q, total));
  });

  // Deactivation is immediate: all sessions are revoked and authenticate() rejects the account.
  r.patch('/:id/status', validate({ params: idParam(), body: statusBody }), async (req, res) => {
    const { params, body } = valid<{ id: string } & z.infer<typeof statusBody>>(res);
    if (params.id === req.auth!.userId) throw Errors.forbidden('You cannot change your own account status');
    const user = await UserModel.findByIdAndUpdate(
      params.id,
      { $set: { status: body.status } },
      { new: true, projection: PUBLIC_USER_FIELDS },
    ).lean();
    if (!user) throw Errors.notFound('User');
    if (body.status === 'DEACTIVATED') {
      await RefreshTokenModel.updateMany(
        { userId: user._id, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: 'account_deactivated' } },
      );
    }
    await audit(originFromRequest(req), {
      action: `user.${body.status === 'ACTIVE' ? 'activate' : 'deactivate'}`,
      resourceType: 'user',
      resourceId: user._id,
      metadata: { reason: body.reason },
    });
    ok(req, res, user);
  });

  return r;
}
