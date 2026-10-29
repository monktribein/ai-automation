import { model, Schema, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';

/**
 * Platform-owned, append-only. `tenantId` is set for tenant-scoped events and absent for
 * platform/account events. Tenant APIs always filter by the caller's tenantId.
 */
export interface AuditLogDoc {
  _id: Types.ObjectId;
  tenantId?: Types.ObjectId;
  actorType: 'user' | 'public' | 'system' | 'ai';
  actorUserId?: Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: 'SUCCESS' | 'FAILURE';
  metadata: Record<string, unknown>;
  ip?: string;
  requestId?: string;
  createdAt: Date;
}

const schema = platformSchema<AuditLogDoc>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    actorType: { type: String, enum: ['user', 'public', 'system', 'ai'], required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, maxlength: 100 },
    resourceType: { type: String, required: true, maxlength: 60 },
    resourceId: { type: String, maxlength: 64 },
    outcome: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, maxlength: 64 },
    requestId: { type: String, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ tenantId: 1, action: 1, createdAt: -1 });
schema.index({ actorUserId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDoc>('AuditLog', schema, 'auditLogs');
