import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const TEMPLATE_KEYS = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'appointment_access',
  'handoff_ack',
  'handoff_alert',
  'operational_alert',
  'free_text',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface NotificationDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  channel: 'EMAIL' | 'WHATSAPP';
  to: string;
  templateKey: TemplateKey;
  data: Record<string, string>;
  status: NotificationStatus;
  scheduledFor: Date;
  attempts: number;
  lastError?: string;
  /** SENT means accepted by the provider; DELIVERED/READ only after provider confirmation. */
  providerMessageId?: string;
  dedupeKey?: string;
  appointmentId?: Types.ObjectId;
  customerId?: Types.ObjectId;
  sentAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<NotificationDoc>({
  channel: { type: String, enum: ['EMAIL', 'WHATSAPP'], required: true },
  to: { type: String, required: true, maxlength: 254 },
  templateKey: { type: String, enum: TEMPLATE_KEYS, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: NOTIFICATION_STATUSES, default: 'QUEUED' },
  scheduledFor: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, maxlength: 500 },
  providerMessageId: String,
  dedupeKey: { type: String, maxlength: 200 },
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  sentAt: Date,
  deliveredAt: Date,
});
schema.index(
  { tenantId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
schema.index({ status: 1, scheduledFor: 1 });
schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ tenantId: 1, appointmentId: 1 });
schema.index({ providerMessageId: 1 }, { sparse: true });

export const NotificationModel = model<NotificationDoc>('Notification', schema, 'notifications');
