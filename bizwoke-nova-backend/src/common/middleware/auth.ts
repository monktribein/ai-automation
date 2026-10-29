import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { Errors } from '../errors/app-error';
import { verifyAccessToken } from '../../modules/auth/token.service';
import { RefreshTokenModel } from '../../modules/auth/auth.models';
import { UserModel } from '../../modules/users/user.model';
import { resolveMembershipContext } from '../../modules/memberships/membership-context';

/** Verifies the bearer token AND that the backing session is still live (revocation is immediate). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw Errors.unauthenticated();
  const claims = verifyAccessToken(header.slice(7).trim());

  const [session, user] = await Promise.all([
    RefreshTokenModel.exists({ familyId: claims.sid, userId: claims.sub, revokedAt: { $exists: false } }),
    UserModel.findById(claims.sub, 'status platformRole').lean(),
  ]);
  if (!session) throw Errors.unauthenticated('Session has been revoked');
  if (!user || user.status !== 'ACTIVE') throw Errors.unauthenticated('Account is not active');

  // Platform role is read from the database, never trusted from the token alone.
  req.auth = {
    userId: claims.sub,
    sessionId: claims.sid,
    platformRole: user.platformRole,
    tenantId: claims.tid,
  };
  next();
}

/**
 * Resolves tenant context from the authenticated session's selected tenant and a live,
 * ACTIVE membership. Request bodies, query strings and headers can never select a tenant.
 */
export async function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw Errors.unauthenticated();
  if (!req.auth.tenantId || !Types.ObjectId.isValid(req.auth.tenantId)) {
    throw Errors.forbidden('No active tenant selected. Use POST /auth/switch-tenant first.');
  }
  req.tenant = await resolveMembershipContext(req.auth.userId, new Types.ObjectId(req.auth.tenantId));
  next();
}

export function requirePermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.tenant;
    if (!ctx) throw Errors.forbidden('Tenant context required');
    if (!perms.every((p) => ctx.permissions.has(p))) throw Errors.forbidden();
    next();
  };
}

export function requireAnyPermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.tenant;
    if (!ctx || !perms.some((p) => ctx.permissions.has(p))) throw Errors.forbidden();
    next();
  };
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.platformRole !== 'SUPER_ADMIN')
    throw Errors.forbidden('Platform administrator access required');
  next();
}
