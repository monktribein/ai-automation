import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export const APPOINTMENT_STATUSES = [
  'REQUESTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that hold a reservation on the resource's time. */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  'REQUESTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CHECKED_IN',
];

export type AppointmentSource = 'STAFF' | 'PUBLIC' | 'AI' | 'WHATSAPP' | 'IMPORT';

export interface AppointmentDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  reference: string;
  customerId: Types.ObjectId;
  serviceId: Types.ObjectId;
  staffId: Types.ObjectId;
  locationId?: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  /** End of the reserved block including service buffer. */
  blockEndAt: Date;
  timezone: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  seat: number;
  customerNotes?: string;
  cancellation?: { reason?: string; at: Date; by: string };
  rescheduledFrom?: { startAt: Date; endAt: Date; staffId: Types.ObjectId }[];
  createdByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<AppointmentDoc>({
  reference: { type: String, required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  blockEndAt: { type: Date, required: true },
  timezone: { type: String, required: true },
  status: { type: String, enum: APPOINTMENT_STATUSES, required: true },
  source: { type: String, enum: ['STAFF', 'PUBLIC', 'AI', 'WHATSAPP', 'IMPORT'], required: true },
  seat: { type: Number, default: 0, min: 0 },
  customerNotes: { type: String, maxlength: 500 },
  cancellation: { reason: { type: String, maxlength: 500 }, at: Date, by: String },
  rescheduledFrom: [{ _id: false, startAt: Date, endAt: Date, staffId: Schema.Types.ObjectId }],
  createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
});
schema.index({ tenantId: 1, reference: 1 }, { unique: true });
schema.index({ tenantId: 1, startAt: 1 });
schema.index({ tenantId: 1, staffId: 1, startAt: 1 });
schema.index({ tenantId: 1, customerId: 1, startAt: -1 });
schema.index({ tenantId: 1, status: 1, startAt: 1 });

export const AppointmentModel = model<AppointmentDoc>('Appointment', schema, 'appointments');

/** Append-only history. Never updated or deleted by application code. */
export interface AppointmentEventDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  appointmentId: Types.ObjectId;
  type: 'CREATED' | 'STATUS_CHANGED' | 'RESCHEDULED' | 'NOTE';
  fromStatus?: AppointmentStatus;
  toStatus?: AppointmentStatus;
  actorType: string;
  actorUserId?: Types.ObjectId;
  data: Record<string, unknown>;
  createdAt: Date;
}

const eventSchema = tenantSchema<AppointmentEventDoc>(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    type: { type: String, enum: ['CREATED', 'STATUS_CHANGED', 'RESCHEDULED', 'NOTE'], required: true },
    fromStatus: { type: String, enum: APPOINTMENT_STATUSES },
    toStatus: { type: String, enum: APPOINTMENT_STATUSES },
    actorType: { type: String, required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ tenantId: 1, appointmentId: 1, createdAt: 1 });

export const AppointmentEventModel = model<AppointmentEventDoc>(
  'AppointmentEvent',
  eventSchema,
  'appointmentEvents',
);

/**
 * Database-enforced allocation. Each appointment occupies one document per slot unit
 * (slot-interval granularity) for its seat. The unique index makes double-booking the same
 * seat/time impossible across any number of application instances.
 */
export interface ReservationSlotDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  staffId: Types.ObjectId;
  slotStart: Date;
  seat: number;
  appointmentId: Types.ObjectId;
}

const slotSchema = tenantSchema<ReservationSlotDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, required: true },
    slotStart: { type: Date, required: true },
    seat: { type: Number, required: true, min: 0 },
    appointmentId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: false },
);
slotSchema.index({ tenantId: 1, staffId: 1, slotStart: 1, seat: 1 }, { unique: true });
slotSchema.index({ tenantId: 1, appointmentId: 1 });

export const ReservationSlotModel = model<ReservationSlotDoc>(
  'ReservationSlot',
  slotSchema,
  'reservationSlots',
);

export interface IdempotencyRecordDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  scope: string;
  key: string;
  requestHash: string;
  resourceId?: Types.ObjectId;
  status: 'IN_PROGRESS' | 'COMPLETED';
  expiresAt: Date;
}

const idemSchema = tenantSchema<IdempotencyRecordDoc>({
  scope: { type: String, required: true },
  key: { type: String, required: true, maxlength: 128 },
  requestHash: { type: String, required: true },
  resourceId: Schema.Types.ObjectId,
  status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED'], default: 'IN_PROGRESS' },
  expiresAt: { type: Date, required: true },
});
idemSchema.index({ tenantId: 1, scope: 1, key: 1 }, { unique: true });
idemSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecordModel = model<IdempotencyRecordDoc>(
  'IdempotencyRecord',
  idemSchema,
  'idempotencyRecords',
);
