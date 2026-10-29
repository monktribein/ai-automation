import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface ServiceDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes: number;
  price?: number;
  currency?: string;
  category?: string;
  locationIds: Types.ObjectId[];
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  publiclyBookable: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<ServiceDoc>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, maxlength: 2000 },
  durationMinutes: { type: Number, required: true, min: 5, max: 1440 },
  bufferMinutes: { type: Number, default: 0, min: 0, max: 240 },
  price: { type: Number, min: 0 },
  currency: { type: String, maxlength: 3 },
  category: { type: String, maxlength: 60 },
  locationIds: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  publiclyBookable: { type: Boolean, default: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
});
schema.index(
  { tenantId: 1, name: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['ACTIVE', 'INACTIVE'] } } },
);
schema.index({ tenantId: 1, status: 1 });

export const ServiceModel = model<ServiceDoc>('Service', schema, 'services');
