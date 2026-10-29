import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam } from '../../common/validation/schemas';
import { ok, created } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { MembershipModel } from '../memberships/membership.model';
import { RoleModel, type RoleDoc } from './role.model';

const permissionList = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .max(ALL_PERMISSIONS.length);
const createBody = z
  .object({
    key: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).optional(),
    permissions: permissionList,
  })
  .strict();
const patchBody = createBody.omit({ key: true }).partial().strict();

export function roleRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) => new TenantRepository<RoleDoc>(RoleModel, req.tenant!.tenantId);

  r.get('/permissions', requirePermission(PERMISSIONS.MEMBERS_READ), (req, res) => {
    ok(req, res, ALL_PERMISSIONS);
  });

  r.get('/', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res) => {
    ok(req, res, await repo(req).find({}, { sort: { key: 1 } }));
  });

  r.post(
    '/',
    requirePermission(PERMISSIONS.ROLES_MANAGE),
    validate({ body: createBody }),
    async (req, res) => {
      const b = valid<z.infer<typeof createBody>>(res).body;
      // A role can never hold permissions its creator does not hold (no privilege escalation).
      if (b.permissions.some((p) => !req.tenant!.permissions.has(p)))
        throw Errors.forbidden('Cannot grant permissions you do not hold');
      const role = await repo(req).create({ ...b, system: false });
      await audit(originFromRequest(req), {
        action: 'role.create',
        resourceType: 'role',
        resourceId: role._id,
        metadata: { permissions: b.permissions },
      });
      created(req, res, role);
    },
  );

  r.patch(
    '/:id',
    requirePermission(PERMISSIONS.ROLES_MANAGE),
    validate({ params: idParam(), body: patchBody }),
    async (req, res) => {
      const { params, body } = valid<{ id: string } & z.infer<typeof patchBody>>(res);
      const role = await repo(req).getById(params.id, 'Role');
      if (role.system) throw Errors.forbidden('System roles cannot be modified');
      if (body.permissions?.some((p) => !req.tenant!.permissions.has(p)))
        throw Errors.forbidden('Cannot grant permissions you do not hold');
      const updated = await repo(req).findOneAndUpdate({ _id: params.id }, { $set: body });
      await audit(originFromRequest(req), {
        action: 'role.update',
        resourceType: 'role',
        resourceId: params.id,
      });
      ok(req, res, updated);
    },
  );

  r.delete(
    '/:id',
    requirePermission(PERMISSIONS.ROLES_MANAGE),
    validate({ params: idParam() }),
    async (req, res) => {
      const { id } = valid<{ id: string }>(res).params;
      const role = await repo(req).getById(id, 'Role');
      if (role.system) throw Errors.forbidden('System roles cannot be deleted');
      const inUse = await new TenantRepository(MembershipModel, req.tenant!.tenantId).count({
        roleKeys: role.key,
        status: 'ACTIVE',
      });
      if (inUse > 0) throw Errors.conflict('Role is assigned to active members');
      await repo(req).deleteOne({ _id: id });
      await audit(originFromRequest(req), { action: 'role.delete', resourceType: 'role', resourceId: id });
      ok(req, res, { deleted: true });
    },
  );

  return r;
}
