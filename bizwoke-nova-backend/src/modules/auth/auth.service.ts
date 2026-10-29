import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { Errors } from '../../common/errors/app-error';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { withTransaction, isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { UserModel, type UserDoc } from '../users/user.model';
import { MembershipModel } from '../memberships/membership.model';
import { TenantModel } from '../tenants/tenant.model';
import { provisionTenant, type CreateTenantInput } from '../tenants/tenant.service';
import { RefreshTokenModel, PasswordResetModel } from './auth.models';
import { durationMs, signAccessToken } from './token.service';
import { audit } from '../audit-logs/audit.service';
import { getEmailProvider } from '../../infrastructure/email/email.provider';
import { logger } from '../../common/logging/logger';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Used to equalise timing when the email does not exist.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync(randomToken(16), env().BCRYPT_ROUNDS));

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tenantId?: string;
}

export const hashPassword = (p: string) => bcrypt.hash(p, env().BCRYPT_ROUNDS);

async function activeTenantIdsFor(userId: Types.ObjectId) {
  const ms = await MembershipModel.find({ userId, status: 'ACTIVE' }, 'tenantId roleKeys', {
    skipTenantGuard: true,
  }).lean();
  const tenants = await TenantModel.find(
    { _id: { $in: ms.map((m) => m.tenantId) } },
    'name slug status',
  ).lean();
  return tenants.map((t) => ({
    tenantId: t._id.toString(),
    name: t.name,
    slug: t.slug,
    status: t.status,
    roleKeys: ms.find((m) => m.tenantId.equals(t._id))?.roleKeys ?? [],
  }));
}

async function issueTokens(
  user: Pick<UserDoc, '_id' | 'platformRole'>,
  tenantId: string | undefined,
  client: ClientInfo,
  familyId: string = randomUUID(),
): Promise<TokenPair> {
  const refreshToken = randomToken(48);
  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    familyId,
    tenantId: tenantId ? new Types.ObjectId(tenantId) : undefined,
    expiresAt: new Date(Date.now() + durationMs(env().JWT_REFRESH_TTL)),
    ip: client.ip,
    userAgent: client.userAgent?.slice(0, 300),
  });
  const accessToken = signAccessToken({
    sub: user._id.toString(),
    sid: familyId,
    prl: user.platformRole,
    tid: tenantId,
  });
  return { accessToken, refreshToken, expiresIn: env().JWT_ACCESS_TTL, tenantId };
}

export async function register(
  input: { email: string; password: string; name: string; phone?: string; business?: CreateTenantInput },
  client: ClientInfo,
) {
  const passwordHash = await hashPassword(input.password);
  try {
    const { user, tenantId } = await withTransaction(async (session) => {
      const [user] = await UserModel.create(
        [{ email: input.email, name: input.name, phone: input.phone, passwordHash, platformRole: 'USER' }],
        { session },
      );
      let tenantId: string | undefined;
      if (input.business) {
        const tenant = await provisionTenant(input.business, user!._id, user!._id, session);
        tenantId = tenant._id.toString();
      }
      return { user: user!, tenantId };
    });
    await audit(
      {
        actorType: 'user',
        actorUserId: user._id.toString(),
        tenantId: tenantId ? new Types.ObjectId(tenantId) : undefined,
        ...client,
      },
      { action: 'auth.register', resourceType: 'user', resourceId: user._id },
    );
    const tokens = await issueTokens(user, tenantId, client);
    return { user: { id: user._id, email: user.email, name: user.name }, tokens };
  } catch (err) {
    if (isDuplicateKeyError(err))
      throw Errors.conflict('An account with this email or a tenant with this slug already exists');
    throw err;
  }
}

export async function login(
  input: { email: string; password: string; tenantSlug?: string },
  client: ClientInfo,
) {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash').lean();
  const fail = async (reason: string) => {
    await audit(
      { actorType: 'public', actorUserId: user?._id.toString(), ...client },
      {
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user?._id,
        outcome: 'FAILURE',
        metadata: { reason },
      },
    );
    return Errors.unauthenticated('Invalid email or password');
  };

  if (!user) {
    await bcrypt.compare(input.password, getDummyHash());
    throw await fail('unknown_email');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw await fail('locked');
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    await UserModel.updateOne(
      { _id: user._id },
      failed >= MAX_FAILED_LOGINS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } }
        : { $set: { failedLoginCount: failed } },
    );
    throw await fail('bad_password');
  }
  if (user.status !== 'ACTIVE') throw await fail('deactivated');

  const memberships = await activeTenantIdsFor(user._id);
  let tenantId: string | undefined;
  if (input.tenantSlug) {
    const m = memberships.find((t) => t.slug === input.tenantSlug && t.status === 'ACTIVE');
    if (!m) throw await fail('no_membership');
    tenantId = m.tenantId;
  } else if (memberships.filter((m) => m.status === 'ACTIVE').length === 1) {
    tenantId = memberships.find((m) => m.status === 'ACTIVE')!.tenantId;
  }

  await UserModel.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
  );
  const tokens = await issueTokens(user, tenantId, client);
  await audit(
    {
      actorType: 'user',
      actorUserId: user._id.toString(),
      tenantId: tenantId ? new Types.ObjectId(tenantId) : undefined,
      ...client,
    },
    { action: 'auth.login', resourceType: 'user', resourceId: user._id },
  );
  return {
    user: { id: user._id, email: user.email, name: user.name, platformRole: user.platformRole },
    memberships,
    tokens,
  };
}

/**
 * Rotation with reuse detection: each refresh token works once. Presenting an already-rotated
 * token revokes the whole session family (likely theft).
 */
export async function refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
  const hash = sha256(refreshToken);
  const record = await RefreshTokenModel.findOne({ tokenHash: hash }).lean();
  if (!record || record.expiresAt < new Date()) throw Errors.unauthenticated('Invalid refresh token');
  if (record.revokedAt) {
    if (record.revokedReason === 'rotated') {
      await RefreshTokenModel.updateMany(
        { familyId: record.familyId, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } },
      );
      await audit(
        { actorType: 'public', actorUserId: record.userId.toString(), ...client },
        {
          action: 'auth.refresh_reuse_detected',
          resourceType: 'session',
          resourceId: record.familyId,
          outcome: 'FAILURE',
        },
      );
    }
    throw Errors.unauthenticated('Refresh token has been revoked');
  }

  // Atomic claim: only one concurrent refresh can win the rotation.
  const claimed = await RefreshTokenModel.findOneAndUpdate(
    { _id: record._id, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'rotated' } },
  );
  if (!claimed) throw Errors.unauthenticated('Refresh token has been revoked');

  const user = await UserModel.findById(record.userId, 'platformRole status').lean();
  if (!user || user.status !== 'ACTIVE') throw Errors.unauthenticated('Account is not active');

  // Keep the selected tenant only while the membership is still active.
  let tenantId = record.tenantId?.toString();
  if (tenantId) {
    const still = await MembershipModel.exists({
      tenantId: record.tenantId,
      userId: user._id,
      status: 'ACTIVE',
    });
    if (!still) tenantId = undefined;
  }
  const pair = await issueTokens(user, tenantId, client, record.familyId);
  await RefreshTokenModel.updateOne(
    { _id: record._id },
    { $set: { replacedByHash: sha256(pair.refreshToken) } },
  );
  return pair;
}

export async function switchTenant(
  userId: string,
  sessionId: string,
  tenantId: string,
  client: ClientInfo,
): Promise<TokenPair> {
  if (!Types.ObjectId.isValid(tenantId)) throw Errors.forbidden('You are not a member of this tenant');
  const [membership, tenant, user] = await Promise.all([
    MembershipModel.findOne({ tenantId: new Types.ObjectId(tenantId), userId, status: 'ACTIVE' }).lean(),
    TenantModel.findById(tenantId, 'status').lean(),
    UserModel.findById(userId, 'platformRole').lean(),
  ]);
  if (!membership || !tenant || !user) throw Errors.forbidden('You are not a member of this tenant');
  if (tenant.status !== 'ACTIVE') throw Errors.tenantInactive();
  // Rotate inside the same session family so logout still revokes everything.
  await RefreshTokenModel.updateMany(
    { familyId: sessionId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'tenant_switched' } },
  );
  return issueTokens(user, tenantId, client, sessionId);
}

export async function logout(sessionId: string, userId: string, allSessions: boolean) {
  const filter = allSessions ? { userId } : { familyId: sessionId, userId };
  await RefreshTokenModel.updateMany(
    { ...filter, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
  await audit(
    { actorType: 'user', actorUserId: userId },
    { action: 'auth.logout', resourceType: 'session', resourceId: sessionId },
  );
}

/** Always resolves identically whether or not the email exists (no account enumeration). */
export async function forgotPassword(email: string, client: ClientInfo): Promise<void> {
  const user = await UserModel.findOne({ email, status: 'ACTIVE' }, '_id email name').lean();
  if (!user) return;
  const token = randomToken(32);
  await PasswordResetModel.updateMany(
    { userId: user._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } },
  );
  await PasswordResetModel.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env().PASSWORD_RESET_TTL_MINUTES * 60_000),
  });
  await audit(
    { actorType: 'public', actorUserId: user._id.toString(), ...client },
    {
      action: 'auth.password_reset_requested',
      resourceType: 'user',
      resourceId: user._id,
    },
  );
  const provider = getEmailProvider();
  if (!provider) {
    logger.warn(
      { userId: user._id },
      'Password reset requested but no email provider is configured; token not delivered',
    );
    return;
  }
  await provider.send({
    to: user.email,
    subject: 'Reset your password',
    text: `Use this code to reset your password. It expires in ${env().PASSWORD_RESET_TTL_MINUTES} minutes.\n\n${token}`,
  });
}

export async function resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
  const record = await PasswordResetModel.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  ).lean();
  if (!record) throw Errors.validation('Invalid or expired reset token');
  await UserModel.updateOne(
    { _id: record.userId },
    {
      $set: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
      },
      $unset: { lockedUntil: 1 },
    },
  );
  // A password reset terminates every existing session.
  await RefreshTokenModel.updateMany(
    { userId: record.userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'password_reset' } },
  );
  await audit(
    { actorType: 'public', actorUserId: record.userId.toString(), ...client },
    {
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: record.userId,
    },
  );
}

export async function me(userId: string) {
  const user = await UserModel.findById(userId, 'email name phone platformRole status createdAt').lean();
  if (!user) throw Errors.notFound('User');
  return { user, memberships: await activeTenantIdsFor(user._id) };
}
