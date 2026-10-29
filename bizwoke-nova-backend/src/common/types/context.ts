import type { Types } from 'mongoose';

export type PlatformRole = 'SUPER_ADMIN' | 'USER';

export interface AuthContext {
  userId: string;
  platformRole: PlatformRole;
  sessionId: string;
  /** Tenant selected at login / switch-tenant; re-verified against memberships on every request. */
  tenantId?: string;
}

export type ActorType = 'user' | 'public' | 'system' | 'ai';

/**
 * The only trusted source of tenant scope. Built server-side from a verified membership
 * (authenticated routes), a server-side slug lookup (public routes), or a job payload
 * whose tenant was set by trusted code.
 */
export interface TenantContext {
  tenantId: Types.ObjectId;
  slug: string;
  timezone: string;
  permissions: ReadonlySet<string>;
  actor: { type: ActorType; userId?: string; membershipId?: string; roleKeys?: string[] };
}
