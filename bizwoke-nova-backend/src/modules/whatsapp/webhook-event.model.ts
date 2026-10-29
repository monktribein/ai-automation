import { model, Schema, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';

/**
 * Platform-owned inbox of raw provider webhooks. The tenant is unknown on receipt and is
 * resolved server-side from the business phone number id during processing.
 */
export interface WebhookEventDoc {
  _id: Types.ObjectId;
  provider: 'whatsapp';
  eventKey: string;
  tenantId?: Types.ObjectId;
  payload: Record<string, unknown>;
  status: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';
  error?: string;
  attempts: number;
  processedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

const schema = platformSchema<WebhookEventDoc>({
  provider: { type: String, enum: ['whatsapp'], required: true },
  eventKey: { type: String, required: true, maxlength: 128 },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'], default: 'RECEIVED' },
  error: { type: String, maxlength: 500 },
  attempts: { type: Number, default: 0 },
  processedAt: Date,
  expiresAt: { type: Date, required: true },
});
// Duplicate webhook detection: providers retry deliveries; the same body is stored once.
schema.index({ provider: 1, eventKey: 1 }, { unique: true });
schema.index({ status: 1, createdAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookEventModel = model<WebhookEventDoc>('WebhookEvent', schema, 'webhookEvents');
