import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface LocationDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  timezone?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  metadata: Record<string, unknown>;
}

const schema = tenantSchema<LocationDoc>({
  name: { type: String, required: true, maxlength: 120 },
  address: { type: String, maxlength: 500 },
  city: { type: String, maxlength: 100 },
  country: { type: String, maxlength: 100 },
  phone: { type: String, maxlength: 32 },
  timezone: String,
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  metadata: { type: Schema.Types.Mixed, default: {} },
});
schema.index({ tenantId: 1, name: 1 }, { unique: true });

export const LocationModel = model<LocationDoc>('Location', schema, 'businessLocations');
