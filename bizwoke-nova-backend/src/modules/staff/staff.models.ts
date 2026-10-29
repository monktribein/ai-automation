import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface StaffDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  bio?: string;
  userId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  /** Max concurrent appointments (1 = single-capacity resource). */
  capacity: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  publiclyVisible: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = tenantSchema<StaffDoc>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, lowercase: true, maxlength: 254 },
  phone: { type: String, maxlength: 32 },
  title: { type: String, maxlength: 120 },
  bio: { type: String, maxlength: 2000 },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
  capacity: { type: Number, default: 1, min: 1, max: 50 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  publiclyVisible: { type: Boolean, default: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
});
staffSchema.index({ tenantId: 1, status: 1 });
staffSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

export const StaffModel = model<StaffDoc>('Staff', staffSchema, 'staff');

export interface StaffServiceAssignmentDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  staffId: Types.ObjectId;
  serviceId: Types.ObjectId;
}

const assignSchema = tenantSchema<StaffServiceAssignmentDoc>({
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
});
assignSchema.index({ tenantId: 1, staffId: 1, serviceId: 1 }, { unique: true });
assignSchema.index({ tenantId: 1, serviceId: 1 });

export const StaffServiceAssignmentModel = model<StaffServiceAssignmentDoc>(
  'StaffServiceAssignment',
  assignSchema,
  'staffServiceAssignments',
);

export interface TimeRange {
  dayOfWeek: number; // ISO 1..7
  start: string; // HH:mm local
  end: string;
}

/** One weekly schedule per staff member, interpreted in the business timezone. */
export interface StaffAvailabilityDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  staffId: Types.ObjectId;
  weekly: TimeRange[];
  breaks: TimeRange[];
}

const range = new Schema(
  {
    dayOfWeek: { type: Number, min: 1, max: 7, required: true },
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/ },
  },
  { _id: false },
);

const availSchema = tenantSchema<StaffAvailabilityDoc>({
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  weekly: { type: [range], default: [] },
  breaks: { type: [range], default: [] },
});
availSchema.index({ tenantId: 1, staffId: 1 }, { unique: true });

export const StaffAvailabilityModel = model<StaffAvailabilityDoc>(
  'StaffAvailability',
  availSchema,
  'staffAvailability',
);

/** Blocked periods. `staffId` absent => applies to the whole business (e.g. public holiday). */
export interface AvailabilityExceptionDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  staffId?: Types.ObjectId;
  type: 'LEAVE' | 'HOLIDAY' | 'BLOCK';
  startsAt: Date;
  endsAt: Date;
  reason?: string;
}

const exceptionSchema = tenantSchema<AvailabilityExceptionDoc>({
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
  type: { type: String, enum: ['LEAVE', 'HOLIDAY', 'BLOCK'], required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  reason: { type: String, maxlength: 300 },
});
exceptionSchema.index({ tenantId: 1, staffId: 1, startsAt: 1, endsAt: 1 });

export const AvailabilityExceptionModel = model<AvailabilityExceptionDoc>(
  'AvailabilityException',
  exceptionSchema,
  'availabilityExceptions',
);
