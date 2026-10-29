import { Types, type ClientSession } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { escapeRegex } from '../../common/utils/text';
import { withTransaction, isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { TenantModel, type TenantDoc, type TenantStatus } from './tenant.model';
import { TenantSettingsModel } from '../business-config/tenant-settings.model';
import { RoleModel } from '../roles/role.model';
import { MembershipModel } from '../memberships/membership.model';
import { SYSTEM_ROLES } from '../permissions/permissions';
import { SubscriptionPlanModel, TenantSubscriptionModel } from '../subscriptions/subscription.models';

export interface CreateTenantInput {
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  category?: string;
}

const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'www',
  'app',
  'public',
  'docs',
  'health',
  'static',
  'support',
]);

export async function provisionTenant(
  input: CreateTenantInput,
  ownerUserId: Types.ObjectId | undefined,
  createdBy: Types.ObjectId | undefined,
  outerSession?: ClientSession,
): Promise<TenantDoc> {
  if (RESERVED_SLUGS.has(input.slug)) throw Errors.conflict('This slug is reserved');

  const run = async (session: ClientSession) => {
    const tenantId = new Types.ObjectId();
    const [tenant] = await TenantModel.create(
      [
        {
          _id: tenantId,
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          locale: input.locale,
          createdBy,
        },
      ],
      { session },
    );
    await TenantSettingsModel.create(
      [
        {
          tenantId,
          profile: { displayName: input.name, category: input.category },
          timezone: input.timezone,
          locale: input.locale,
          operatingHours: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, open: '09:00', close: '17:00' })),
        },
      ],
      { session },
    );
    await RoleModel.insertMany(
      Object.entries(SYSTEM_ROLES).map(([key, r]) => ({
        tenantId,
        key,
        name: r.name,
        permissions: r.permissions,
        system: true,
      })),
      { session },
    );
    if (ownerUserId) {
      await MembershipModel.create(
        [{ tenantId, userId: ownerUserId, roleKeys: ['TENANT_ADMIN'], invitedBy: createdBy }],
        {
          session,
        },
      );
    }
    const defaultPlan = await SubscriptionPlanModel.findOne({ isDefault: true, active: true }, '_id', {
      session,
    }).lean();
    if (defaultPlan) {
      await TenantSubscriptionModel.create(
        [{ tenantId, planId: defaultPlan._id, status: 'ACTIVE', startedAt: new Date() }],
        {
          session,
        },
      );
    }
    return tenant!.toObject() as TenantDoc;
  };

  try {
    return outerSession ? await run(outerSession) : await withTransaction(run);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw Errors.conflict('A tenant with this slug already exists');
    throw err;
  }
}

export async function listTenants(q: {
  page: number;
  limit: number;
  status?: TenantStatus;
  search?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.search)
    filter.$or = [
      { name: new RegExp(escapeRegex(q.search), 'i') },
      { slug: new RegExp(escapeRegex(q.search), 'i') },
    ];
  const [items, total] = await Promise.all([
    TenantModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    TenantModel.countDocuments(filter),
  ]);
  return { items, total };
}

/** Tenant ids the user can access via ACTIVE memberships (platform-level query by user). */
export async function tenantIdsForUser(userId: string): Promise<Types.ObjectId[]> {
  const ms = await MembershipModel.find({ userId, status: 'ACTIVE' }, 'tenantId', {
    skipTenantGuard: true,
  }).lean();
  return ms.map((m) => m.tenantId);
}

export async function getTenant(tenantId: string) {
  const t = await TenantModel.findById(tenantId).lean();
  if (!t) throw Errors.notFound('Tenant');
  return t;
}

export async function updateTenant(
  tenantId: string,
  patch: Partial<Pick<TenantDoc, 'name' | 'timezone' | 'locale' | 'slug'>>,
) {
  if (patch.slug && RESERVED_SLUGS.has(patch.slug)) throw Errors.conflict('This slug is reserved');
  try {
    const t = await TenantModel.findByIdAndUpdate(
      tenantId,
      { $set: patch },
      { new: true, runValidators: true },
    ).lean();
    if (!t) throw Errors.notFound('Tenant');
    if (patch.timezone)
      await TenantSettingsModel.updateOne({ tenantId: t._id }, { $set: { timezone: patch.timezone } });
    return t;
  } catch (err) {
    if (isDuplicateKeyError(err)) throw Errors.conflict('A tenant with this slug already exists');
    throw err;
  }
}

export async function setTenantStatus(tenantId: string, status: TenantStatus, reason?: string) {
  const t = await TenantModel.findByIdAndUpdate(
    tenantId,
    { $set: { status, statusReason: reason } },
    { new: true },
  ).lean();
  if (!t) throw Errors.notFound('Tenant');
  return t;
}

/** Public slug resolution: only ACTIVE tenants are addressable from public routes. */
export async function resolvePublicTenant(slug: string) {
  const t = await TenantModel.findOne({ slug, status: 'ACTIVE' }, '_id slug timezone name').lean();
  if (!t) throw Errors.notFound('Business');
  return t;
}
