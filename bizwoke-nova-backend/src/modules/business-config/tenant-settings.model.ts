import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface OperatingHours {
  dayOfWeek: number; // ISO: 1 = Monday ... 7 = Sunday
  open: string; // HH:mm in business timezone
  close: string;
}

export interface BookingPolicy {
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  allowGuestBooking: boolean;
  requireConfirmation: boolean;
  cancellationCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
}

export interface TenantSettingsDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  profile: {
    displayName: string;
    description?: string;
    category?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
  };
  branding: { logoUrl?: string; primaryColor?: string; accentColor?: string };
  timezone: string;
  locale: string;
  currency?: string;
  operatingHours: OperatingHours[];
  bookingPolicy: BookingPolicy;
  features: { ai: boolean; whatsapp: boolean; excel: boolean; publicBooking: boolean; workflows: boolean };
  ai: { enabled: boolean; maxTurns: number; instructions?: string; model?: string; handoffMessage?: string };
  integrations: {
    whatsapp?: {
      phoneNumberId?: string;
      displayNumber?: string;
      enabled: boolean;
      /** Maps internal notification keys to provider-approved WhatsApp templates. */
      templates: { key: string; name: string; language: string }[];
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

const hours = new Schema(
  { dayOfWeek: { type: Number, min: 1, max: 7 }, open: String, close: String },
  { _id: false },
);

const schema = tenantSchema<TenantSettingsDoc>({
  profile: {
    displayName: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 2000 },
    category: { type: String, maxlength: 60 },
    email: { type: String, maxlength: 254 },
    phone: { type: String, maxlength: 32 },
    website: { type: String, maxlength: 300 },
    address: { type: String, maxlength: 500 },
  },
  branding: {
    logoUrl: { type: String, maxlength: 500 },
    primaryColor: { type: String, maxlength: 16 },
    accentColor: { type: String, maxlength: 16 },
  },
  timezone: { type: String, required: true, default: 'UTC' },
  locale: { type: String, required: true, default: 'en' },
  currency: { type: String, maxlength: 3 },
  operatingHours: { type: [hours], default: [] },
  bookingPolicy: {
    minNoticeMinutes: { type: Number, default: 60, min: 0 },
    maxAdvanceDays: { type: Number, default: 60, min: 1, max: 730 },
    slotIntervalMinutes: { type: Number, default: 15, enum: [5, 10, 15, 20, 30, 60] },
    allowGuestBooking: { type: Boolean, default: true },
    requireConfirmation: { type: Boolean, default: false },
    cancellationCutoffMinutes: { type: Number, default: 120, min: 0 },
    rescheduleCutoffMinutes: { type: Number, default: 120, min: 0 },
  },
  features: {
    ai: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    excel: { type: Boolean, default: true },
    publicBooking: { type: Boolean, default: true },
    workflows: { type: Boolean, default: true },
  },
  ai: {
    enabled: { type: Boolean, default: false },
    maxTurns: { type: Number, default: 30, min: 1, max: 200 },
    instructions: { type: String, maxlength: 4000 },
    model: { type: String, maxlength: 100 },
    handoffMessage: { type: String, maxlength: 500 },
  },
  integrations: {
    whatsapp: {
      phoneNumberId: { type: String, maxlength: 64 },
      displayNumber: { type: String, maxlength: 32 },
      enabled: { type: Boolean, default: false },
      templates: { type: [{ _id: false, key: String, name: String, language: String }], default: [] },
    },
  },
});
schema.index({ tenantId: 1 }, { unique: true });
// Webhook routing: a WhatsApp business number belongs to exactly one tenant platform-wide.
schema.index(
  { 'integrations.whatsapp.phoneNumberId': 1 },
  { unique: true, partialFilterExpression: { 'integrations.whatsapp.phoneNumberId': { $type: 'string' } } },
);

export const TenantSettingsModel = model<TenantSettingsDoc>('TenantSettings', schema, 'tenantSettings');
