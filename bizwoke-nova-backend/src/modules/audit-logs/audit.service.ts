import type { Types } from 'mongoose';
import type { Request } from 'express';
import { logger } from '../../common/logging/logger';
import type { TenantContext } from '../../common/types/context';
import { AuditLogModel, type AuditLogDoc } from './audit-log.model';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | Types.ObjectId;
  outcome?: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
}

interface AuditOrigin {
  tenantId?: Types.ObjectId;
  actorType: AuditLogDoc['actorType'];
  actorUserId?: string;
  ip?: string;
  requestId?: string;
}

export function originFromRequest(req: Request): AuditOrigin {
  return {
    tenantId: req.tenant?.tenantId,
    actorType: req.tenant?.actor.type ?? (req.auth ? 'user' : 'public'),
    actorUserId: req.auth?.userId,
    ip: req.ip,
    requestId: req.requestId,
  };
}

export function originFromTenant(ctx: TenantContext, requestId?: string): AuditOrigin {
  return { tenantId: ctx.tenantId, actorType: ctx.actor.type, actorUserId: ctx.actor.userId, requestId };
}

/** Audit writes never break the business operation, but failures are logged loudly. */
export async function audit(origin: AuditOrigin, input: AuditInput): Promise<void> {
  try {
    await AuditLogModel.create({
      // Explicit fields only: callers may pass richer client objects (e.g. userAgent).
      tenantId: origin.tenantId,
      actorType: origin.actorType,
      actorUserId: origin.actorUserId,
      ip: origin.ip,
      requestId: origin.requestId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId?.toString(),
      outcome: input.outcome ?? 'SUCCESS',
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write audit log');
  }
}
