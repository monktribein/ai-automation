import { model, Schema, type Types } from 'mongoose';
import { platformSchema, tenantSchema } from '../../infrastructure/mongodb/base-schema';

export const USAGE_METRICS = [
  'appointments',
  'aiMessages',
  'aiTokens',
  'whatsappMessages',
  'exports',
  'imports',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface PlanLimits {
  appointmentsPerMonth?: number;
  aiMessagesPerMonth?: number;
  aiTokensPerMonth?: number;
  whatsappMessagesPerMonth?: number;
  exportsPerMonth?: number;
  importsPerMonth?: number;
  staff?: number;
  services?: number;
}

/**
 * Globally shared catalog (platform-owned, managed by SUPER_ADMIN). A tenant gains access
 * to a plan's entitlements only through its own TenantSubscription record.
 */
export interface SubscriptionPlanDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  features: string[];
  limits: PlanLimits;
  isDefault: boolean;
  active: boolean;
}

const limitsDef = {
  appointmentsPerMonth: { type: Number, min: 0 },
  aiMessagesPerMonth: { type: Number, min: 0 },
  aiTokensPerMonth: { type: Number, min: 0 },
  whatsappMessagesPerMonth: { type: Number, min: 0 },
  exportsPerMonth: { type: Number, min: 0 },
  importsPerMonth: { type: Number, min: 0 },
  staff: { type: Number, min: 0 },
  services: { type: Number, min: 0 },
};

const planSchema = platformSchema<SubscriptionPlanDoc>({
  code: { type: String, required: true, lowercase: true, match: /^[a-z0-9_-]{2,40}$/ },
  name: { type: String, required: true, maxlength: 80 },
  features: { type: [String], default: [] },
  limits: { type: limitsDef, default: {} },
  isDefault: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
});
planSchema.index({ code: 1 }, { unique: true });
planSchema.index({ isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

export const SubscriptionPlanModel = model<SubscriptionPlanDoc>(
  'SubscriptionPlan',
  planSchema,
  'subscriptionPlans',
);

export interface TenantSubscriptionDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  planId: Types.ObjectId;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  startedAt: Date;
  endsAt?: Date;
  limitOverrides: PlanLimits;
}

const subSchema = tenantSchema<TenantSubscriptionDoc>({
  planId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
  status: { type: String, enum: ['ACTIVE', 'PAST_DUE', 'CANCELLED'], default: 'ACTIVE' },
  startedAt: { type: Date, required: true },
  endsAt: Date,
  limitOverrides: { type: limitsDef, default: {} },
});
subSchema.index({ tenantId: 1 }, { unique: true });

export const TenantSubscriptionModel = model<TenantSubscriptionDoc>(
  'TenantSubscription',
  subSchema,
  'tenantSubscriptions',
);

export interface UsageRecordDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  metric: UsageMetric;
  period: string; // YYYY-MM (UTC)
  count: number;
}

const usageSchema = tenantSchema<UsageRecordDoc>({
  metric: { type: String, enum: USAGE_METRICS, required: true },
  period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  count: { type: Number, default: 0, min: 0 },
});
usageSchema.index({ tenantId: 1, metric: 1, period: 1 }, { unique: true });

export const UsageRecordModel = model<UsageRecordDoc>('UsageRecord', usageSchema, 'usageRecords');
