import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface MembershipDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  roleKeys: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  staffId?: Types.ObjectId;
  invitedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<MembershipDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  roleKeys: { type: [String], required: true, validate: (v: string[]) => v.length > 0 && v.length <= 10 },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'], default: 'ACTIVE' },
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
});
schema.index({ tenantId: 1, userId: 1 }, { unique: true });
// Cross-tenant lookup "which tenants does this user belong to" is a platform query by userId.
schema.index({ userId: 1, status: 1 });

export const MembershipModel = model<MembershipDoc>('Membership', schema, 'memberships');
