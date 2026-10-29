import { model, Schema, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

/** Platform-owned: the tenant registry itself. Managed by SUPER_ADMIN; read by members. */
export interface TenantDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  locale: string;
  createdBy?: Types.ObjectId;
  statusReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = platformSchema<TenantDoc>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 60 },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'], default: 'ACTIVE' },
  timezone: { type: String, required: true, default: 'UTC' },
  locale: { type: String, required: true, default: 'en' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  statusReason: { type: String, maxlength: 500 },
});
schema.index({ slug: 1 }, { unique: true });
schema.index({ status: 1, createdAt: -1 });

export const TenantModel = model<TenantDoc>('Tenant', schema, 'tenants');
