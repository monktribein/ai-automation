import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { email, idParam, objectId } from '../../common/validation/schemas';
import { paginationQuery, pageMeta, skipFor } from '../../common/utils/pagination';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { UserModel } from '../users/user.model';
import { RoleModel } from '../roles/role.model';
import { StaffModel } from '../staff/staff.models';
import { MembershipModel, type MembershipDoc } from './membership.model';

const roleKeys = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/))
  .min(1)
  .max(10);
const addBody = z.object({ email, roleKeys, staffId: objectId.optional() }).strict();
const patchBody = z
  .object({ roleKeys, status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']), staffId: objectId.nullable() })
  .partial()
  .strict();
const listQuery = paginationQuery
  .extend({ status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']).optional() })
  .strict();

async function assertRolesExist(tenantId: Types.ObjectId, keys: string[]) {
  const roles = new TenantRepository(RoleModel, tenantId);
  const found = await roles.count({ key: { $in: keys } });
  if (found !== new Set(keys).size)
    throw Errors.validation('Unknown role', [{ path: 'roleKeys', message: 'Unknown role key' }]);
}

export function membershipRouter(): Router {
  const r = Router();
  const repo = (tenantId: Types.ObjectId) => new TenantRepository<MembershipDoc>(MembershipModel, tenantId);

  r.get(
    '/',
    requirePermission(PERMISSIONS.MEMBERS_READ),
    validate({ query: listQuery }),
    async (req, res) => {
      const q = valid<z.infer<typeof listQuery>>(res).query;
      const m = repo(req.tenant!.tenantId);
      const filter = q.status ? { status: q.status } : {};
      const [items, total] = await Promise.all([
        m.find(filter, { sort: { createdAt: -1 }, skip: skipFor(q), limit: q.limit }),
        m.count(filter),
      ]);
      const users = await UserModel.find({ _id: { $in: items.map((i) => i.userId) } }, 'email name').lean();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      ok(
        req,
        res,
        items.map((i) => ({ ...i, user: byId.get(i.userId.toString()) ?? null })),
        pageMeta(q, total),
      );
    },
  );

  // Adds an existing platform user to this tenant. Tenant admins can never grant platform roles.
  r.post(
    '/',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ body: addBody }),
    async (req, res) => {
      const b = valid<z.infer<typeof addBody>>(res).body;
      const tenantId = req.tenant!.tenantId;
      await assertRolesExist(tenantId, b.roleKeys);
      const user = await UserModel.findOne({ email: b.email, status: 'ACTIVE' }, '_id').lean();
      if (!user) throw Errors.notFound('User');
      if (b.staffId && !(await new TenantRepository(StaffModel, tenantId).findById(b.staffId)))
        throw Errors.notFound('Staff');
      const membership = await repo(tenantId).create({
        userId: user._id,
        roleKeys: b.roleKeys,
        staffId: b.staffId ? new Types.ObjectId(b.staffId) : undefined,
        invitedBy: new Types.ObjectId(req.auth!.userId),
      });
      await audit(originFromRequest(req), {
        action: 'membership.add',
        resourceType: 'membership',
        resourceId: membership._id,
        metadata: { roleKeys: b.roleKeys },
      });
      created(req, res, membership);
    },
  );

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.MEMBERS_MANAGE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      const tenantId = req.tenant!.tenantId;
      const existing = await repo(tenantId).getById(params.id, 'Membership');
      if (existing.userId.toString() === req.auth!.userId && (body.status || body.roleKeys)) {
        throw Errors.forbidden('You cannot change your own membership roles or status');
      }
      if (body.roleKeys) await assertRolesExist(tenantId, body.roleKeys);
      const { staffId, ...rest } = body;
      const update =
        staffId === null
          ? { $set: rest, $unset: { staffId: 1 } }
          : { $set: { ...rest, ...(staffId ? { staffId: new Types.ObjectId(staffId) } : {}) } };
      const updated = await repo(tenantId).findOneAndUpdate({ _id: params.id }, update);
      await audit(originFromRequest(req), {
        action: 'membership.update',
        resourceType: 'membership',
        resourceId: params.id,
        metadata: { fields: Object.keys(body) },
      });
      ok(req, res, updated);
    },
  );

  return r;
}
