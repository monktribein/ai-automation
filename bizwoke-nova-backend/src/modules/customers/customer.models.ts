import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

/**
 * Generic contact record. Deliberately has NO fields for medical history, symptoms or
 * diagnoses; `notes` is bounded and documented as operational only.
 */
export interface CustomerDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  emailNormalized?: string;
  phoneNormalized?: string;
  consent: { email: boolean; whatsapp: boolean; sms: boolean; marketing: boolean; updatedAt?: Date };
  preferredLanguage?: string;
  source: 'MANUAL' | 'PUBLIC_BOOKING' | 'WHATSAPP' | 'AI' | 'IMPORT' | 'LEAD';
  tags: string[];
  notes?: string;
  status: 'ACTIVE' | 'ANONYMIZED';
  anonymizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = tenantSchema<CustomerDoc>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, maxlength: 254 },
  phone: { type: String, maxlength: 32 },
  emailNormalized: String,
  phoneNormalized: String,
  consent: {
    email: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    marketing: { type: Boolean, default: false },
    updatedAt: Date,
  },
  preferredLanguage: { type: String, maxlength: 10 },
  source: {
    type: String,
    enum: ['MANUAL', 'PUBLIC_BOOKING', 'WHATSAPP', 'AI', 'IMPORT', 'LEAD'],
    default: 'MANUAL',
  },
  tags: { type: [String], default: [] },
  notes: { type: String, maxlength: 1000 },
  status: { type: String, enum: ['ACTIVE', 'ANONYMIZED'], default: 'ACTIVE' },
  anonymizedAt: Date,
});
// Duplicate detection is per tenant: the same person may be a customer of many tenants.
customerSchema.index(
  { tenantId: 1, emailNormalized: 1 },
  { unique: true, partialFilterExpression: { emailNormalized: { $type: 'string' } } },
);
customerSchema.index(
  { tenantId: 1, phoneNormalized: 1 },
  { unique: true, partialFilterExpression: { phoneNormalized: { $type: 'string' } } },
);
customerSchema.index({ tenantId: 1, createdAt: -1 });
customerSchema.index({ tenantId: 1, name: 1 });

export const CustomerModel = model<CustomerDoc>('Customer', customerSchema, 'customers');

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;

export interface LeadDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  emailNormalized?: string;
  phoneNormalized?: string;
  message?: string;
  interest?: string;
  source: 'MANUAL' | 'PUBLIC' | 'WHATSAPP' | 'AI' | 'IMPORT';
  sourceDetail?: string;
  status: (typeof LEAD_STATUSES)[number];
  assignedMembershipId?: Types.ObjectId;
  customerId?: Types.ObjectId;
  possibleDuplicateOf?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = tenantSchema<LeadDoc>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, maxlength: 254 },
  phone: { type: String, maxlength: 32 },
  emailNormalized: String,
  phoneNormalized: String,
  message: { type: String, maxlength: 2000 },
  interest: { type: String, maxlength: 200 },
  source: { type: String, enum: ['MANUAL', 'PUBLIC', 'WHATSAPP', 'AI', 'IMPORT'], default: 'MANUAL' },
  sourceDetail: { type: String, maxlength: 200 },
  status: { type: String, enum: LEAD_STATUSES, default: 'NEW' },
  assignedMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  possibleDuplicateOf: { type: Schema.Types.ObjectId, ref: 'Lead' },
});
leadSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
leadSchema.index({ tenantId: 1, emailNormalized: 1 });
leadSchema.index({ tenantId: 1, phoneNormalized: 1 });

export const LeadModel = model<LeadDoc>('Lead', leadSchema, 'leads');
