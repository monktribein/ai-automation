import { DateTime } from 'luxon';
import { Types, type ClientSession } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { TenantSettingsModel, type TenantSettingsDoc } from '../business-config/tenant-settings.model';
import { ServiceModel, type ServiceDoc } from '../services/service.model';
import {
  AvailabilityExceptionModel,
  StaffAvailabilityModel,
  StaffModel,
  StaffServiceAssignmentModel,
  type StaffDoc,
  type TimeRange,
} from '../staff/staff.models';
import { AppointmentModel, ACTIVE_STATUSES } from '../appointments/appointment.models';
import {
  dateRange,
  intersect,
  isoWeekday,
  isUnitAligned,
  localToEpoch,
  subtract,
  type Interval,
  RESERVATION_UNIT_MINUTES,
} from './time';

export interface Slot {
  startAt: string;
  endAt: string;
  staffId: string;
  staffName: string;
}

const MAX_RANGE_DAYS = 31;

export async function loadSettings(
  tenantId: Types.ObjectId,
  session?: ClientSession,
): Promise<TenantSettingsDoc> {
  const s = await new TenantRepository<TenantSettingsDoc>(TenantSettingsModel, tenantId).findOne(
    {},
    { session },
  );
  if (!s) throw Errors.notFound('Business settings');
  return s;
}

function rangesFor(
  ranges: TimeRange[] | { dayOfWeek: number; open: string; close: string }[],
  isoDate: string,
  zone: string,
  weekday: number,
): Interval[] {
  return ranges
    .filter((r) => r.dayOfWeek === weekday)
    .map((r) => {
      const start = 'start' in r ? r.start : r.open;
      const end = 'end' in r ? r.end : r.close;
      return { start: localToEpoch(isoDate, start, zone), end: localToEpoch(isoDate, end, zone) };
    })
    .filter((i) => i.start < i.end);
}

/** Working windows for one staff member over a UTC window, after schedules, breaks and exceptions. */
async function workingWindows(
  tenantId: Types.ObjectId,
  settings: TenantSettingsDoc,
  staffIds: Types.ObjectId[],
  dates: string[],
  session?: ClientSession,
): Promise<Map<string, Interval[]>> {
  const zone = settings.timezone;
  const windowStart = localToEpoch(dates[0]!, '00:00', zone);
  const windowEnd = localToEpoch(dates[dates.length - 1]!, '24:00', zone);

  const [schedules, exceptions] = await Promise.all([
    new TenantRepository(StaffAvailabilityModel, tenantId).find({ staffId: { $in: staffIds } }, { session }),
    new TenantRepository(AvailabilityExceptionModel, tenantId).find(
      {
        $or: [{ staffId: { $in: staffIds } }, { staffId: { $exists: false } }],
        startsAt: { $lt: new Date(windowEnd) },
        endsAt: { $gt: new Date(windowStart) },
      },
      { session },
    ),
  ]);

  const result = new Map<string, Interval[]>();
  for (const staffId of staffIds) {
    const schedule = schedules.find((s) => s.staffId.equals(staffId));
    const blocked = exceptions
      .filter((e) => !e.staffId || e.staffId.equals(staffId))
      .map((e) => ({ start: e.startsAt.getTime(), end: e.endsAt.getTime() }));
    const windows: Interval[] = [];
    for (const date of dates) {
      const weekday = isoWeekday(date, zone);
      const business = rangesFor(settings.operatingHours, date, zone, weekday);
      // Staff without an explicit schedule follow business operating hours.
      const staffHours = schedule ? rangesFor(schedule.weekly, date, zone, weekday) : business;
      let day = intersect(business, staffHours);
      if (schedule) day = subtract(day, rangesFor(schedule.breaks, date, zone, weekday));
      windows.push(...subtract(day, blocked));
    }
    result.set(staffId.toString(), windows);
  }
  return result;
}

async function busyCounts(
  tenantId: Types.ObjectId,
  staffIds: Types.ObjectId[],
  from: Date,
  to: Date,
  session?: ClientSession,
  excludeAppointmentId?: Types.ObjectId,
) {
  const filter: Record<string, unknown> = {
    staffId: { $in: staffIds },
    status: { $in: ACTIVE_STATUSES },
    startAt: { $lt: to },
    blockEndAt: { $gt: from },
  };
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId };
  return new TenantRepository(AppointmentModel, tenantId).find(filter, {
    projection: { staffId: 1, startAt: 1, blockEndAt: 1 },
    session,
  });
}

function bookingWindow(settings: TenantSettingsDoc, now = Date.now()) {
  return {
    earliest: now + settings.bookingPolicy.minNoticeMinutes * 60_000,
    latest: now + settings.bookingPolicy.maxAdvanceDays * 86_400_000,
  };
}

export async function eligibleStaff(
  tenantId: Types.ObjectId,
  serviceId: Types.ObjectId,
  staffId?: Types.ObjectId,
  opts: { publicOnly?: boolean; session?: ClientSession } = {},
): Promise<StaffDoc[]> {
  const assignments = await new TenantRepository(StaffServiceAssignmentModel, tenantId).find(
    { serviceId, ...(staffId ? { staffId } : {}) },
    { session: opts.session },
  );
  if (assignments.length === 0) return [];
  const filter: Record<string, unknown> = {
    _id: { $in: assignments.map((a) => a.staffId) },
    status: 'ACTIVE',
  };
  if (opts.publicOnly) filter.publiclyVisible = true;
  return new TenantRepository<StaffDoc>(StaffModel, tenantId).find(filter, {
    sort: { name: 1 },
    session: opts.session,
  });
}

export async function getBookableService(
  tenantId: Types.ObjectId,
  serviceId: string | Types.ObjectId,
  publicOnly = false,
  session?: ClientSession,
) {
  const filter: Record<string, unknown> = { _id: serviceId, status: 'ACTIVE' };
  if (publicOnly) filter.publiclyBookable = true;
  const svc = await new TenantRepository<ServiceDoc>(ServiceModel, tenantId).findOne(filter, { session });
  if (!svc) throw Errors.notFound('Service');
  return svc;
}

/** Real availability computed from schedules, exceptions, policy and existing bookings. */
export async function getAvailableSlots(
  ctx: TenantContext,
  q: { serviceId: string; from: string; to?: string; staffId?: string; publicOnly?: boolean },
): Promise<Slot[]> {
  const tenantId = ctx.tenantId;
  const settings = await loadSettings(tenantId);
  const to = q.to ?? q.from;
  const dates = dateRange(q.from, to);
  if (dates.length === 0) throw Errors.validation('`to` must not be before `from`');
  if (dates.length > MAX_RANGE_DAYS)
    throw Errors.validation(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);

  const service = await getBookableService(tenantId, q.serviceId, q.publicOnly);
  const staff = await eligibleStaff(
    tenantId,
    service._id,
    q.staffId ? new Types.ObjectId(q.staffId) : undefined,
    {
      publicOnly: q.publicOnly,
    },
  );
  if (staff.length === 0) return [];

  const staffIds = staff.map((s) => s._id);
  const windows = await workingWindows(tenantId, settings, staffIds, dates);
  const zone = settings.timezone;
  const rangeStart = new Date(localToEpoch(dates[0]!, '00:00', zone));
  const rangeEnd = new Date(localToEpoch(dates[dates.length - 1]!, '24:00', zone) + 86_400_000);
  const busy = await busyCounts(tenantId, staffIds, rangeStart, rangeEnd);
  const { earliest, latest } = bookingWindow(settings);

  const durationMs = service.durationMinutes * 60_000;
  const blockMs = (service.durationMinutes + service.bufferMinutes) * 60_000;
  const stepMs = settings.bookingPolicy.slotIntervalMinutes * 60_000;

  const slots: Slot[] = [];
  for (const s of staff) {
    const mine = busy.filter((b) => b.staffId.equals(s._id));
    for (const w of windows.get(s._id.toString()) ?? []) {
      for (let t = w.start; t + blockMs <= w.end; t += stepMs) {
        if (t < earliest || t > latest) continue;
        const overlapping = mine.filter(
          (b) => b.startAt.getTime() < t + blockMs && b.blockEndAt.getTime() > t,
        ).length;
        if (overlapping >= s.capacity) continue;
        slots.push({
          startAt: new Date(t).toISOString(),
          endAt: new Date(t + durationMs).toISOString(),
          staffId: s._id.toString(),
          staffName: s.name,
        });
      }
    }
  }
  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.staffName.localeCompare(b.staffName));
}

/**
 * Re-validates that `startAt` falls inside the staff member's working windows and the
 * booking policy. Overlap with other bookings is enforced separately by reservation slots.
 */
export async function assertWithinSchedule(
  tenantId: Types.ObjectId,
  settings: TenantSettingsDoc,
  staff: StaffDoc,
  service: ServiceDoc,
  startAt: Date,
  opts: { enforcePolicy: boolean; session?: ClientSession },
): Promise<void> {
  if (!isUnitAligned(startAt)) {
    throw Errors.validation(`Start time must align to ${RESERVATION_UNIT_MINUTES}-minute boundaries`);
  }
  const t = startAt.getTime();
  if (opts.enforcePolicy) {
    const { earliest, latest } = bookingWindow(settings);
    if (t < earliest) throw Errors.slotUnavailable('Start time is inside the minimum notice period');
    if (t > latest) throw Errors.slotUnavailable('Start time is beyond the maximum advance booking window');
  } else if (t < Date.now() - 60_000) {
    throw Errors.slotUnavailable('Start time is in the past');
  }
  const local = DateTime.fromJSDate(startAt, { zone: settings.timezone });
  const dates = [local.minus({ days: 1 }).toISODate()!, local.toISODate()!];
  const windows =
    (await workingWindows(tenantId, settings, [staff._id], dates, opts.session)).get(staff._id.toString()) ??
    [];
  const blockEnd = t + (service.durationMinutes + service.bufferMinutes) * 60_000;
  if (!windows.some((w) => w.start <= t && blockEnd <= w.end)) {
    throw Errors.slotUnavailable("The requested time is outside the staff member's availability");
  }
}
