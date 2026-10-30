import { Types, type ClientSession } from 'mongoose';
import { Errors, AppError } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { fingerprint, humanReference } from '../../common/utils/crypto';
import { events } from '../../common/utils/events';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { withTransaction, isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import {
  assertWithinSchedule,
  eligibleStaff,
  getBookableService,
  loadSettings,
} from '../availability/availability.service';
import { unitStarts } from '../availability/time';
import { findOrCreateCustomer, type CustomerInput } from '../customers/customer.service';
import { CustomerModel } from '../customers/customer.models';
import type { ServiceDoc } from '../services/service.model';
import type { StaffDoc } from '../staff/staff.models';
import { consumeQuota, releaseQuota } from '../usage/usage.service';
import {
  AppointmentEventModel,
  AppointmentModel,
  IdempotencyRecordModel,
  ReservationSlotModel,
  type AppointmentDoc,
  type AppointmentSource,
  type AppointmentStatus,
  type PaymentStatus,
} from './appointment.models';

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  REQUESTED: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
const RELEASES_TIME: AppointmentStatus[] = ['CANCELLED', 'NO_SHOW'];
const RESCHEDULABLE: AppointmentStatus[] = ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED'];
const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface CreateAppointmentInput {
  serviceId: string;
  staffId?: string;
  startAt: Date;
  customerId?: string;
  customer?: CustomerInput;
  customerNotes?: string;
  paymentStatus?: PaymentStatus;
}

interface CreateOptions {
  source: AppointmentSource;
  idempotencyKey?: string;
  /** Public/AI callers are bound by the tenant's booking policy; staff can override notice windows. */
  enforcePolicy: boolean;
  publicOnly?: boolean;
}

const repo = (tenantId: Types.ObjectId) => new TenantRepository<AppointmentDoc>(AppointmentModel, tenantId);

async function reserve(
  session: ClientSession,
  tenantId: Types.ObjectId,
  appointmentId: Types.ObjectId,
  staffId: Types.ObjectId,
  seat: number,
  start: Date,
  blockEnd: Date,
) {
  const rows = unitStarts(start, blockEnd).map((slotStart) => ({ staffId, slotStart, seat, appointmentId }));
  await new TenantRepository(ReservationSlotModel, tenantId).insertMany(rows, session);
}

/**
 * Atomic allocation: inside one transaction, insert one reservation-slot document per 5-minute
 * unit for a seat, then the appointment and its CREATED event. Any overlap with an existing
 * booking on that seat violates the unique index, aborting the whole transaction. Seats are
 * tried in order up to the staff member's capacity.
 */
async function allocate<T>(
  staff: StaffDoc,
  start: Date,
  blockEnd: Date,
  fn: (session: ClientSession, seat: number) => Promise<T>,
  reserveFn: (session: ClientSession, seat: number) => Promise<void>,
): Promise<T> {
  for (let seat = 0; seat < staff.capacity; seat++) {
    try {
      return await withTransaction(async (session) => {
        await reserveFn(session, seat);
        return fn(session, seat);
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) continue;
      throw err;
    }
  }
  throw Errors.slotUnavailable();
}

async function beginIdempotency(
  tenantId: Types.ObjectId,
  key: string,
  hash: string,
): Promise<AppointmentDoc | null> {
  try {
    await IdempotencyRecordModel.create({
      tenantId,
      scope: 'appointment.create',
      key,
      requestHash: hash,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
    return null;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await IdempotencyRecordModel.findOne({
      tenantId,
      scope: 'appointment.create',
      key,
    }).lean();
    if (!existing) throw Errors.conflict('Idempotent request is being processed, retry shortly');
    if (existing.requestHash !== hash) throw Errors.idempotencyConflict();
    if (existing.status !== 'COMPLETED' || !existing.resourceId) {
      throw Errors.conflict('An identical request is still being processed, retry shortly');
    }
    return repo(tenantId).getById(existing.resourceId, 'Appointment');
  }
}

export async function createAppointment(
  ctx: TenantContext,
  input: CreateAppointmentInput,
  opts: CreateOptions,
): Promise<{ appointment: AppointmentDoc; replayed: boolean }> {
  const tenantId = ctx.tenantId;
  const hash = fingerprint({ ...input, startAt: input.startAt.toISOString(), source: opts.source });
  if (opts.idempotencyKey) {
    const replay = await beginIdempotency(tenantId, opts.idempotencyKey, hash);
    if (replay) return { appointment: replay, replayed: true };
  }

  try {
    const appointment = await doCreate(ctx, input, opts);
    if (opts.idempotencyKey) {
      await IdempotencyRecordModel.updateOne(
        { tenantId, scope: 'appointment.create', key: opts.idempotencyKey },
        { $set: { status: 'COMPLETED', resourceId: appointment._id } },
      );
    }
    events.emit('appointment.created', {
      tenantId: tenantId.toString(),
      appointmentId: appointment._id.toString(),
      status: appointment.status,
    });
    return { appointment, replayed: false };
  } catch (err) {
    // Failed attempts must not poison the key: the client may retry with the same key.
    if (opts.idempotencyKey) {
      await IdempotencyRecordModel.deleteOne({
        tenantId,
        scope: 'appointment.create',
        key: opts.idempotencyKey,
        status: 'IN_PROGRESS',
      });
    }
    throw err;
  }
}

async function doCreate(
  ctx: TenantContext,
  input: CreateAppointmentInput,
  opts: CreateOptions,
): Promise<AppointmentDoc> {
  const tenantId = ctx.tenantId;
  const settings = await loadSettings(tenantId);
  const service = await getBookableService(tenantId, input.serviceId, opts.publicOnly);
  const candidates = await eligibleStaff(
    tenantId,
    service._id,
    input.staffId ? new Types.ObjectId(input.staffId) : undefined,
    {
      publicOnly: opts.publicOnly,
    },
  );
  if (candidates.length === 0) {
    throw input.staffId
      ? Errors.slotUnavailable('Staff member does not provide this service')
      : Errors.slotUnavailable('No staff available for this service');
  }
  if (input.customerId) {
    const exists = await new TenantRepository(CustomerModel, tenantId).findOne({
      _id: input.customerId,
      status: 'ACTIVE',
    });
    if (!exists) throw Errors.notFound('Customer');
  } else if (!input.customer) {
    throw Errors.validation('customerId or customer details are required');
  }

  const start = input.startAt;
  const end = new Date(start.getTime() + service.durationMinutes * 60_000);
  const blockEnd = new Date(end.getTime() + service.bufferMinutes * 60_000);
  const status: AppointmentStatus =
    opts.source === 'STAFF'
      ? 'CONFIRMED'
      : settings.bookingPolicy.requireConfirmation
        ? 'PENDING_CONFIRMATION'
        : 'CONFIRMED';

  await consumeQuota(tenantId, 'appointments');
  let lastError: unknown = Errors.slotUnavailable();
  try {
    for (const staff of candidates) {
      try {
        await assertWithinSchedule(tenantId, settings, staff, service, start, {
          enforcePolicy: opts.enforcePolicy,
        });
        return await bookWithStaff(
          ctx,
          input,
          opts,
          service,
          staff,
          start,
          end,
          blockEnd,
          status,
          settings.timezone,
        );
      } catch (err) {
        // With auto-assignment, an unavailable staff member just means "try the next one".
        if (err instanceof AppError && err.code === 'SLOT_UNAVAILABLE') {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  } catch (err) {
    await releaseQuota(tenantId, 'appointments');
    throw err;
  }
}

async function bookWithStaff(
  ctx: TenantContext,
  input: CreateAppointmentInput,
  opts: CreateOptions,
  service: ServiceDoc,
  staff: StaffDoc,
  start: Date,
  end: Date,
  blockEnd: Date,
  status: AppointmentStatus,
  timezone: string,
): Promise<AppointmentDoc> {
  const tenantId = ctx.tenantId;
  const appointmentId = new Types.ObjectId();
  return allocate(
    staff,
    start,
    blockEnd,
    async (session, seat) => {
      const customerId = input.customerId
        ? new Types.ObjectId(input.customerId)
        : (
            await findOrCreateCustomer(
              tenantId,
              input.customer!,
              opts.source === 'STAFF'
                ? 'MANUAL'
                : opts.source === 'PUBLIC'
                  ? 'PUBLIC_BOOKING'
                  : opts.source === 'IMPORT'
                    ? 'IMPORT'
                    : opts.source,
              session,
            )
          )._id;
      const appointment = await repo(tenantId).create(
        {
          reference: humanReference('BK'),
          customerId,
          serviceId: service._id,
          staffId: staff._id,
          locationId: staff.locationId,
          startAt: start,
          endAt: end,
          blockEndAt: blockEnd,
          timezone,
          status,
          paymentStatus: input.paymentStatus ?? 'UNPAID',
          source: opts.source,
          seat,
          customerNotes: input.customerNotes,
          createdByUserId: ctx.actor.userId ? new Types.ObjectId(ctx.actor.userId) : undefined,
        },
        session,
        appointmentId,
      );
      await new TenantRepository(AppointmentEventModel, tenantId).create(
        {
          appointmentId: appointment._id,
          type: 'CREATED',
          toStatus: status,
          actorType: ctx.actor.type,
          actorUserId: ctx.actor.userId ? new Types.ObjectId(ctx.actor.userId) : undefined,
          data: { source: opts.source, staffId: staff._id.toString(), startAt: start.toISOString() },
        },
        session,
      );
      return appointment;
    },
    (session, seat) => reserve(session, tenantId, appointmentId, staff._id, seat, start, blockEnd),
  );
}

export async function getAppointment(tenantId: Types.ObjectId, id: string) {
  return repo(tenantId).getById(id, 'Appointment');
}

export async function getAppointmentByReference(tenantId: Types.ObjectId, reference: string) {
  const a = await repo(tenantId).findOne({ reference });
  if (!a) throw Errors.notFound('Appointment');
  return a;
}

export async function listAppointments(
  tenantId: Types.ObjectId,
  q: {
    page: number;
    limit: number;
    status?: AppointmentStatus;
    staffId?: string;
    serviceId?: string;
    customerId?: string;
    customerIds?: Types.ObjectId[];
    from?: Date;
    to?: Date;
    sort: Record<string, 1 | -1>;
  },
) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.staffId) filter.staffId = new Types.ObjectId(q.staffId);
  if (q.serviceId) filter.serviceId = new Types.ObjectId(q.serviceId);
  if (q.customerId) filter.customerId = new Types.ObjectId(q.customerId);
  if (q.customerIds) filter.customerId = { $in: q.customerIds };
  if (q.from || q.to)
    filter.startAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lt: q.to } : {}) };
  const r = repo(tenantId);
  const [items, total] = await Promise.all([
    r.find(filter, { sort: q.sort, skip: (q.page - 1) * q.limit, limit: q.limit }),
    r.count(filter),
  ]);
  return { items, total };
}

export async function appointmentHistory(tenantId: Types.ObjectId, id: string) {
  await repo(tenantId).getById(id, 'Appointment');
  return new TenantRepository(AppointmentEventModel, tenantId).find(
    { appointmentId: new Types.ObjectId(id) },
    { sort: { createdAt: 1 } },
  );
}

export async function transition(
  ctx: TenantContext,
  id: string,
  to: AppointmentStatus,
  opts: { reason?: string; enforceCutoff?: boolean } = {},
): Promise<AppointmentDoc> {
  const tenantId = ctx.tenantId;
  const current = await repo(tenantId).getById(id, 'Appointment');
  if (!canTransition(current.status, to)) throw Errors.invalidTransition(current.status, to);
  if (opts.enforceCutoff && to === 'CANCELLED') {
    const settings = await loadSettings(tenantId);
    if (current.startAt.getTime() - Date.now() < settings.bookingPolicy.cancellationCutoffMinutes * 60_000) {
      throw Errors.forbidden('Cancellation window has passed; please contact the business');
    }
  }
  const updated = await withTransaction(async (session) => {
    const set: Record<string, unknown> = { status: to };
    if (to === 'CANCELLED') set.cancellation = { reason: opts.reason, at: new Date(), by: ctx.actor.type };
    // Optimistic concurrency: only succeeds if nobody changed the status in between.
    const doc = await repo(tenantId).findOneAndUpdate(
      { _id: id, status: current.status },
      { $set: set },
      { session },
    );
    if (!doc) throw Errors.conflict('Appointment was modified concurrently, please retry');
    if (RELEASES_TIME.includes(to)) {
      await new TenantRepository(ReservationSlotModel, tenantId).deleteMany(
        { appointmentId: doc._id },
        session,
      );
    }
    await new TenantRepository(AppointmentEventModel, tenantId).create(
      {
        appointmentId: doc._id,
        type: 'STATUS_CHANGED',
        fromStatus: current.status,
        toStatus: to,
        actorType: ctx.actor.type,
        actorUserId: ctx.actor.userId ? new Types.ObjectId(ctx.actor.userId) : undefined,
        data: opts.reason ? { reason: opts.reason } : {},
      },
      session,
    );
    return doc;
  });
  events.emit('appointment.status_changed', {
    tenantId: tenantId.toString(),
    appointmentId: id,
    from: current.status,
    to,
  });
  return updated;
}

export async function setPaymentStatus(
  ctx: TenantContext,
  id: string,
  to: PaymentStatus,
): Promise<AppointmentDoc> {
  const tenantId = ctx.tenantId;
  const current = await repo(tenantId).getById(id, 'Appointment');
  const from = current.paymentStatus ?? 'UNPAID';
  if (from === to) return current;
  const updated = await withTransaction(async (session) => {
    const doc = await repo(tenantId).findOneAndUpdate(
      { _id: id, paymentStatus: current.paymentStatus },
      { $set: { paymentStatus: to } },
      { session },
    );
    if (!doc) throw Errors.conflict('Appointment was modified concurrently, please retry');
    await new TenantRepository(AppointmentEventModel, tenantId).create(
      {
        appointmentId: doc._id,
        type: 'PAYMENT_UPDATED',
        actorType: ctx.actor.type,
        actorUserId: ctx.actor.userId ? new Types.ObjectId(ctx.actor.userId) : undefined,
        data: { from, to },
      },
      session,
    );
    return doc;
  });
  events.emit('appointment.payment_changed', {
    tenantId: tenantId.toString(),
    appointmentId: id,
    from,
    to,
  });
  return updated;
}

export async function reschedule(
  ctx: TenantContext,
  id: string,
  input: { startAt: Date; staffId?: string },
  opts: { enforcePolicy: boolean },
): Promise<AppointmentDoc> {
  const tenantId = ctx.tenantId;
  const current = await repo(tenantId).getById(id, 'Appointment');
  if (!RESCHEDULABLE.includes(current.status))
    throw Errors.invalidTransition(current.status, 'RESCHEDULED' as AppointmentStatus);
  const settings = await loadSettings(tenantId);
  if (
    opts.enforcePolicy &&
    current.startAt.getTime() - Date.now() < settings.bookingPolicy.rescheduleCutoffMinutes * 60_000
  ) {
    throw Errors.forbidden('Reschedule window has passed; please contact the business');
  }
  const service = await getBookableService(tenantId, current.serviceId);
  const staffId = input.staffId ? new Types.ObjectId(input.staffId) : current.staffId;
  const [staff] = await eligibleStaff(tenantId, service._id, staffId);
  if (!staff) throw Errors.slotUnavailable('Staff member does not provide this service');
  await assertWithinSchedule(tenantId, settings, staff, service, input.startAt, {
    enforcePolicy: opts.enforcePolicy,
  });

  const start = input.startAt;
  const end = new Date(start.getTime() + service.durationMinutes * 60_000);
  const blockEnd = new Date(end.getTime() + service.bufferMinutes * 60_000);
  const slots = new TenantRepository(ReservationSlotModel, tenantId);

  const updated = await allocate(
    staff,
    start,
    blockEnd,
    async (session, seat) => {
      const doc = await repo(tenantId).findOneAndUpdate(
        { _id: id, status: current.status, startAt: current.startAt },
        {
          $set: {
            startAt: start,
            endAt: end,
            blockEndAt: blockEnd,
            staffId: staff._id,
            seat,
            locationId: staff.locationId,
          },
          $push: {
            rescheduledFrom: { startAt: current.startAt, endAt: current.endAt, staffId: current.staffId },
          },
        },
        { session },
      );
      if (!doc) throw Errors.conflict('Appointment was modified concurrently, please retry');
      await new TenantRepository(AppointmentEventModel, tenantId).create(
        {
          appointmentId: doc._id,
          type: 'RESCHEDULED',
          actorType: ctx.actor.type,
          actorUserId: ctx.actor.userId ? new Types.ObjectId(ctx.actor.userId) : undefined,
          data: {
            from: current.startAt.toISOString(),
            to: start.toISOString(),
            staffId: staff._id.toString(),
          },
        },
        session,
      );
      return doc;
    },
    async (session, seat) => {
      // Free the old block first (same transaction) so moving within an overlapping window works.
      await slots.deleteMany({ appointmentId: current._id }, session);
      await reserve(session, tenantId, current._id, staff._id, seat, start, blockEnd);
    },
  );
  events.emit('appointment.rescheduled', { tenantId: tenantId.toString(), appointmentId: id });
  return updated;
}
