import type { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { TenantModel } from '../tenants/tenant.model';
import { MembershipModel } from './membership.model';
import { RoleModel } from '../roles/role.model';

/** Builds a TenantContext for a user from a live ACTIVE membership in an ACTIVE tenant. */
export async function resolveMembershipContext(
  userId: string,
  tenantId: Types.ObjectId,
): Promise<TenantContext> {
  const [tenant, membership] = await Promise.all([
    TenantModel.findById(tenantId, 'slug status timezone').lean(),
    MembershipModel.findOne({ tenantId, userId, status: 'ACTIVE' }).lean(),
  ]);
  if (!tenant || !membership) throw Errors.forbidden('You are not a member of this tenant');
  if (tenant.status !== 'ACTIVE') throw Errors.tenantInactive();

  const roles = await RoleModel.find({ tenantId, key: { $in: membership.roleKeys } }, 'permissions').lean();
  const permissions = new Set(roles.flatMap((r) => r.permissions));

  return {
    tenantId,
    slug: tenant.slug,
    timezone: tenant.timezone,
    permissions,
    actor: { type: 'user', userId, membershipId: membership._id.toString(), roleKeys: membership.roleKeys },
  };
}

/** Context for trusted internal code (jobs, webhooks) acting inside one tenant. */
export function systemContext(
  tenant: { _id: Types.ObjectId; slug: string; timezone: string },
  type: 'system' | 'public' | 'ai' = 'system',
): TenantContext {
  return {
    tenantId: tenant._id,
    slug: tenant.slug,
    timezone: tenant.timezone,
    permissions: new Set(),
    actor: { type },
  };
}
