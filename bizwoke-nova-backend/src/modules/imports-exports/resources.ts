import { Types } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import { DateTime } from 'luxon';
import { AppError, Errors } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { normalizeEmail, normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { PERMISSIONS } from '../permissions/permissions';
import {
  CustomerModel,
  LeadModel,
  LEAD_STATUSES,
  type CustomerDoc,
  type LeadDoc,
} from '../customers/customer.models';
import { ServiceModel, type ServiceDoc } from '../services/service.model';
import { StaffModel, type StaffDoc } from '../staff/staff.models';
import {
  AppointmentModel,
  APPOINTMENT_STATUSES,
  type AppointmentDoc,
} from '../appointments/appointment.models';
import { createAppointment } from '../appointments/appointment.service';
import { RESERVATION_UNIT_MINUTES } from '../availability/time';
import type { CellPrimitive } from './excel';
import type { ExcelResource } from './import-export.models';

export type DuplicateStrategy = 'skip' | 'update' | 'fail';
export type RowOutcome = 'created' | 'updated' | 'skipped';

export interface ExportFilters {
  from?: Date;
  to?: Date;
  status?: string;
}

export interface ResourceDef {
  readPermission: string;
  writePermission: string;
  columns: { key: string; required?: boolean; example: CellPrimitive }[];
  rowSchema: ZodTypeAny;
  /** Natural key used for duplicate detection inside the file and against the tenant's data. */
  naturalKey?: (row: Record<string, unknown>) => string | undefined;
  existing?: (
    tenantId: Types.ObjectId,
    row: Record<string, unknown>,
  ) => Promise<{ _id: Types.ObjectId } | null>;
  write: (
    ctx: TenantContext,
    row: Record<string, unknown>,
    existingId: Types.ObjectId | null,
    strategy: DuplicateStrategy,
  ) => Promise<RowOutcome>;
  exportColumns: { key: string; header: string; pii?: boolean }[];
  exportRows: (
    tenantId: Types.ObjectId,
    f: ExportFilters,
    limit: number,
  ) => AsyncIterable<Record<string, CellPrimitive>>;
}

// ---- cell coercion -------------------------------------------------------------------------
const text = (max: number) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? undefined : String(v).trim()),
    z.string().max(max).optional(),
  );
const reqText = (max: number) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : String(v).trim()),
    z.string().min(1, 'Required').max(max),
  );
const num = z.preprocess(
  (v) =>
    v === null || v === '' || v === undefined
      ? undefined
      : typeof v === 'number'
        ? v
        : Number(String(v).trim()),
  z.number().finite().optional(),
);
const bool = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(s) ? true : ['false', 'no', 'n', '0'].includes(s) ? false : s;
}, z.boolean().optional());
const list = z.preprocess(
  (v) =>
    v === null || v === undefined || v === ''
      ? []
      : String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  z.array(z.string().max(40)).max(20),
);
const emailCell = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? undefined : String(v).trim().toLowerCase()),
  z.string().email().max(254).optional(),
);
const phoneCell = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? undefined : String(v).trim()),
  z
    .string()
    .regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number')
    .optional(),
);
const dateTimeCell = z.preprocess(
  (v) => {
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const d = DateTime.fromISO(v.trim(), { setZone: true });
      return d.isValid ? d.toJSDate() : v;
    }
    return v;
  },
  z.date({ error: 'Expected an ISO-8601 date-time with offset, e.g. 2026-11-02T10:00:00+05:30' }),
);

const contactRequired = (r: { email?: string; phone?: string }) => Boolean(r.email || r.phone);
const iso = (d?: Date) => (d ? d.toISOString() : null);

async function* cursorRows<T>(
  cursor: AsyncIterable<T>,
  map: (d: T) => Promise<Record<string, CellPrimitive>> | Record<string, CellPrimitive>,
) {
  for await (const d of cursor) yield await map(d);
}

function rangeFilter(f: ExportFilters, field: string) {
  const filter: Record<string, unknown> = {};
  if (f.from || f.to) filter[field] = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lt: f.to } : {}) };
  return filter;
}

function exportCursor<T>(
  model: import('mongoose').Model<T>,
  tenantId: Types.ObjectId,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit: number,
) {
  // Explicit tenant equality is part of every export query.
  return model
    .find({ ...filter, tenantId })
    .sort(sort)
    .limit(limit)
    .lean()
    .cursor() as unknown as AsyncIterable<T>;
}

// ---- resources -----------------------------------------------------------------------------
const customers: ResourceDef = {
  readPermission: PERMISSIONS.CUSTOMERS_READ,
  writePermission: PERMISSIONS.CUSTOMERS_WRITE,
  columns: [
    { key: 'name', required: true, example: 'Example Customer' },
    { key: 'email', example: 'customer@example.com' },
    { key: 'phone', example: '+15550100000' },
    { key: 'preferredLanguage', example: 'en' },
    { key: 'tags', example: 'vip, referral' },
    { key: 'consentEmail', example: 'yes' },
    { key: 'consentWhatsapp', example: 'no' },
    { key: 'consentMarketing', example: 'no' },
    { key: 'notes', example: 'Prefers mornings' },
  ],
  rowSchema: z
    .object({
      name: reqText(120),
      email: emailCell,
      phone: phoneCell,
      preferredLanguage: text(10),
      tags: list,
      consentEmail: bool,
      consentWhatsapp: bool,
      consentMarketing: bool,
      notes: text(1000),
    })
    .refine(contactRequired, 'Email or phone is required'),
  naturalKey: (r) =>
    r.email
      ? `e:${normalizeEmail(r.email as string)}`
      : r.phone
        ? `p:${normalizePhone(r.phone as string)}`
        : undefined,
  existing: async (tenantId, r) => {
    const or = [
      ...(r.email ? [{ emailNormalized: normalizeEmail(r.email as string) }] : []),
      ...(r.phone ? [{ phoneNormalized: normalizePhone(r.phone as string) }] : []),
    ];
    return new TenantRepository<CustomerDoc>(CustomerModel, tenantId).findOne(
      { $or: or, status: 'ACTIVE' },
      { projection: { _id: 1 } },
    );
  },
  write: async (ctx, r, existingId) => {
    const repo = new TenantRepository<CustomerDoc>(CustomerModel, ctx.tenantId);
    const data = {
      name: r.name,
      email: r.email,
      phone: r.phone,
      emailNormalized: r.email ? normalizeEmail(r.email as string) : undefined,
      phoneNormalized: r.phone ? normalizePhone(r.phone as string) : undefined,
      preferredLanguage: r.preferredLanguage,
      tags: r.tags,
      notes: r.notes,
      consent: {
        email: Boolean(r.consentEmail),
        whatsapp: Boolean(r.consentWhatsapp),
        sms: false,
        marketing: Boolean(r.consentMarketing),
        updatedAt: new Date(),
      },
    };
    if (existingId) {
      await repo.updateOne(
        { _id: existingId },
        { $set: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) },
      );
      return 'updated';
    }
    await repo.create({ ...data, source: 'IMPORT' });
    return 'created';
  },
  exportColumns: [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'email', header: 'email', pii: true },
    { key: 'phone', header: 'phone', pii: true },
    { key: 'tags', header: 'tags' },
    { key: 'consentEmail', header: 'consentEmail' },
    { key: 'consentWhatsapp', header: 'consentWhatsapp' },
    { key: 'consentMarketing', header: 'consentMarketing' },
    { key: 'source', header: 'source' },
    { key: 'createdAt', header: 'createdAt' },
  ],
  exportRows: (tenantId, f, limit) =>
    cursorRows(
      exportCursor<CustomerDoc>(
        CustomerModel,
        tenantId,
        { status: 'ACTIVE', ...rangeFilter(f, 'createdAt') },
        { createdAt: 1 },
        limit,
      ),
      (c) => ({
        id: c._id.toString(),
        name: c.name,
        email: c.email ?? null,
        phone: c.phone ?? null,
        tags: c.tags.join(', '),
        consentEmail: c.consent.email,
        consentWhatsapp: c.consent.whatsapp,
        consentMarketing: c.consent.marketing,
        source: c.source,
        createdAt: iso(c.createdAt),
      }),
    ),
};

const leads: ResourceDef = {
  readPermission: PERMISSIONS.LEADS_READ,
  writePermission: PERMISSIONS.LEADS_WRITE,
  columns: [
    { key: 'name', required: true, example: 'Example Lead' },
    { key: 'email', example: 'lead@example.com' },
    { key: 'phone', example: '+15550100001' },
    { key: 'interest', example: 'Consultation' },
    { key: 'message', example: 'Asked about weekend availability' },
    { key: 'status', example: 'NEW' },
  ],
  rowSchema: z
    .object({
      name: reqText(120),
      email: emailCell,
      phone: phoneCell,
      interest: text(200),
      message: text(2000),
      status: z.preprocess(
        (v) => (v ? String(v).trim().toUpperCase() : undefined),
        z.enum(LEAD_STATUSES).optional(),
      ),
    })
    .refine(contactRequired, 'Email or phone is required'),
  naturalKey: (r) =>
    r.email
      ? `e:${normalizeEmail(r.email as string)}`
      : r.phone
        ? `p:${normalizePhone(r.phone as string)}`
        : undefined,
  existing: async (tenantId, r) => {
    const or = [
      ...(r.email ? [{ emailNormalized: normalizeEmail(r.email as string) }] : []),
      ...(r.phone ? [{ phoneNormalized: normalizePhone(r.phone as string) }] : []),
    ];
    return new TenantRepository<LeadDoc>(LeadModel, tenantId).findOne(
      { $or: or },
      { projection: { _id: 1 } },
    );
  },
  write: async (ctx, r, existingId) => {
    const repo = new TenantRepository<LeadDoc>(LeadModel, ctx.tenantId);
    const data = {
      name: r.name,
      email: r.email,
      phone: r.phone,
      emailNormalized: r.email ? normalizeEmail(r.email as string) : undefined,
      phoneNormalized: r.phone ? normalizePhone(r.phone as string) : undefined,
      interest: r.interest,
      message: r.message,
      ...(r.status ? { status: r.status } : {}),
    };
    if (existingId) {
      await repo.updateOne(
        { _id: existingId },
        { $set: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) },
      );
      return 'updated';
    }
    await repo.create({ ...data, source: 'IMPORT' });
    return 'created';
  },
  exportColumns: [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'email', header: 'email', pii: true },
    { key: 'phone', header: 'phone', pii: true },
    { key: 'interest', header: 'interest' },
    { key: 'status', header: 'status' },
    { key: 'source', header: 'source' },
    { key: 'createdAt', header: 'createdAt' },
  ],
  exportRows: (tenantId, f, limit) =>
    cursorRows(
      exportCursor<LeadDoc>(
        LeadModel,
        tenantId,
        { ...(f.status ? { status: f.status } : {}), ...rangeFilter(f, 'createdAt') },
        { createdAt: 1 },
        limit,
      ),
      (l) => ({
        id: l._id.toString(),
        name: l.name,
        email: l.email ?? null,
        phone: l.phone ?? null,
        interest: l.interest ?? null,
        status: l.status,
        source: l.source,
        createdAt: iso(l.createdAt),
      }),
    ),
};

const minutesCell = (min: number, max: number) =>
  num.pipe(
    z
      .number()
      .int()
      .min(min)
      .max(max)
      .refine((v) => v % RESERVATION_UNIT_MINUTES === 0, `Must be a multiple of ${RESERVATION_UNIT_MINUTES}`)
      .optional(),
  );

const services: ResourceDef = {
  readPermission: PERMISSIONS.SERVICES_READ,
  writePermission: PERMISSIONS.SERVICES_WRITE,
  columns: [
    { key: 'name', required: true, example: 'Standard session' },
    { key: 'description', example: '45 minute session' },
    { key: 'durationMinutes', required: true, example: 45 },
    { key: 'bufferMinutes', example: 15 },
    { key: 'price', example: 50 },
    { key: 'currency', example: 'USD' },
    { key: 'category', example: 'General' },
  ],
  rowSchema: z.object({
    name: reqText(120),
    description: text(2000),
    durationMinutes: minutesCell(5, 1440).refine((v) => v !== undefined, 'Required'),
    bufferMinutes: minutesCell(0, 240),
    price: num.pipe(z.number().min(0).optional()),
    currency: z.preprocess(
      (v) => (v ? String(v).trim().toUpperCase() : undefined),
      z.string().length(3).optional(),
    ),
    category: text(60),
  }),
  naturalKey: (r) => `n:${String(r.name).toLowerCase()}`,
  existing: (tenantId, r) =>
    new TenantRepository<ServiceDoc>(ServiceModel, tenantId).findOne(
      { name: r.name as string, status: { $in: ['ACTIVE', 'INACTIVE'] } },
      { projection: { _id: 1 } },
    ),
  write: async (ctx, r, existingId) => {
    const repo = new TenantRepository<ServiceDoc>(ServiceModel, ctx.tenantId);
    const data = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
    if (existingId) {
      await repo.updateOne({ _id: existingId }, { $set: data });
      return 'updated';
    }
    await repo.create({ bufferMinutes: 0, ...data });
    return 'created';
  },
  exportColumns: [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'description', header: 'description' },
    { key: 'durationMinutes', header: 'durationMinutes' },
    { key: 'bufferMinutes', header: 'bufferMinutes' },
    { key: 'price', header: 'price' },
    { key: 'currency', header: 'currency' },
    { key: 'status', header: 'status' },
  ],
  exportRows: (tenantId, f, limit) =>
    cursorRows(
      exportCursor<ServiceDoc>(
        ServiceModel,
        tenantId,
        f.status ? { status: f.status } : {},
        { name: 1 },
        limit,
      ),
      (s) => ({
        id: s._id.toString(),
        name: s.name,
        description: s.description ?? null,
        durationMinutes: s.durationMinutes,
        bufferMinutes: s.bufferMinutes,
        price: s.price ?? null,
        currency: s.currency ?? null,
        status: s.status,
      }),
    ),
};

const staff: ResourceDef = {
  readPermission: PERMISSIONS.STAFF_READ,
  writePermission: PERMISSIONS.STAFF_WRITE,
  columns: [
    { key: 'name', required: true, example: 'Example Staff' },
    { key: 'email', example: 'staff@example.com' },
    { key: 'phone', example: '+15550100002' },
    { key: 'title', example: 'Specialist' },
    { key: 'capacity', example: 1 },
  ],
  rowSchema: z.object({
    name: reqText(120),
    email: emailCell,
    phone: phoneCell,
    title: text(120),
    capacity: num.pipe(z.number().int().min(1).max(50).optional()),
  }),
  naturalKey: (r) => (r.email ? `e:${r.email}` : undefined),
  existing: async (tenantId, r) =>
    r.email
      ? new TenantRepository<StaffDoc>(StaffModel, tenantId).findOne(
          { email: r.email as string },
          { projection: { _id: 1 } },
        )
      : null,
  write: async (ctx, r, existingId) => {
    const repo = new TenantRepository<StaffDoc>(StaffModel, ctx.tenantId);
    const data = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
    if (existingId) {
      await repo.updateOne({ _id: existingId }, { $set: data });
      return 'updated';
    }
    await repo.create({ capacity: 1, ...data });
    return 'created';
  },
  exportColumns: [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'email', header: 'email', pii: true },
    { key: 'phone', header: 'phone', pii: true },
    { key: 'title', header: 'title' },
    { key: 'capacity', header: 'capacity' },
    { key: 'status', header: 'status' },
  ],
  exportRows: (tenantId, f, limit) =>
    cursorRows(
      exportCursor<StaffDoc>(StaffModel, tenantId, f.status ? { status: f.status } : {}, { name: 1 }, limit),
      (s) => ({
        id: s._id.toString(),
        name: s.name,
        email: s.email ?? null,
        phone: s.phone ?? null,
        title: s.title ?? null,
        capacity: s.capacity,
        status: s.status,
      }),
    ),
};

const appointments: ResourceDef = {
  readPermission: PERMISSIONS.APPOINTMENTS_READ,
  writePermission: PERMISSIONS.APPOINTMENTS_WRITE,
  columns: [
    { key: 'serviceName', required: true, example: 'Standard session' },
    { key: 'staffEmail', example: 'staff@example.com' },
    { key: 'startAt', required: true, example: '2030-01-07T10:00:00+00:00' },
    { key: 'customerName', required: true, example: 'Example Customer' },
    { key: 'customerEmail', example: 'customer@example.com' },
    { key: 'customerPhone', example: '+15550100000' },
    { key: 'notes', example: '' },
  ],
  rowSchema: z
    .object({
      serviceName: reqText(120),
      staffEmail: emailCell,
      startAt: dateTimeCell,
      customerName: reqText(120),
      customerEmail: emailCell,
      customerPhone: phoneCell,
      notes: text(500),
    })
    .refine(
      (r) => contactRequired({ email: r.customerEmail, phone: r.customerPhone }),
      'customerEmail or customerPhone is required',
    ),
  // Imported appointments go through the booking engine: availability and overlap are enforced.
  write: async (ctx, r) => {
    const service = await new TenantRepository<ServiceDoc>(ServiceModel, ctx.tenantId).findOne({
      name: r.serviceName as string,
      status: 'ACTIVE',
    });
    if (!service) throw Errors.validation(`Unknown service "${r.serviceName}"`);
    let staffId: string | undefined;
    if (r.staffEmail) {
      const s = await new TenantRepository<StaffDoc>(StaffModel, ctx.tenantId).findOne({
        email: r.staffEmail as string,
        status: 'ACTIVE',
      });
      if (!s) throw Errors.validation(`Unknown staff "${r.staffEmail}"`);
      staffId = s._id.toString();
    }
    await createAppointment(
      ctx,
      {
        serviceId: service._id.toString(),
        staffId,
        startAt: r.startAt as Date,
        customer: {
          name: r.customerName as string,
          email: r.customerEmail as string | undefined,
          phone: r.customerPhone as string | undefined,
        },
        customerNotes: r.notes as string | undefined,
      },
      { source: 'IMPORT', enforcePolicy: false },
    );
    return 'created';
  },
  exportColumns: [
    { key: 'reference', header: 'reference' },
    { key: 'status', header: 'status' },
    { key: 'startAt', header: 'startAt' },
    { key: 'endAt', header: 'endAt' },
    { key: 'serviceName', header: 'serviceName' },
    { key: 'staffName', header: 'staffName' },
    { key: 'customerName', header: 'customerName' },
    { key: 'customerEmail', header: 'customerEmail', pii: true },
    { key: 'customerPhone', header: 'customerPhone', pii: true },
    { key: 'source', header: 'source' },
  ],
  exportRows: (tenantId, f, limit) => {
    const svc = new Map<string, string>();
    const stf = new Map<string, string>();
    const customersRepo = new TenantRepository<CustomerDoc>(CustomerModel, tenantId);
    const filter = {
      ...(f.status && (APPOINTMENT_STATUSES as readonly string[]).includes(f.status)
        ? { status: f.status }
        : {}),
      ...rangeFilter(f, 'startAt'),
    };
    return cursorRows(
      exportCursor<AppointmentDoc>(AppointmentModel, tenantId, filter, { startAt: 1 }, limit),
      async (a) => {
        if (!svc.has(a.serviceId.toString()))
          svc.set(
            a.serviceId.toString(),
            (await new TenantRepository(ServiceModel, tenantId).findById(a.serviceId))?.name ?? '',
          );
        if (!stf.has(a.staffId.toString()))
          stf.set(
            a.staffId.toString(),
            (await new TenantRepository(StaffModel, tenantId).findById(a.staffId))?.name ?? '',
          );
        const c = await customersRepo.findById(a.customerId, { projection: { name: 1, email: 1, phone: 1 } });
        return {
          reference: a.reference,
          status: a.status,
          startAt: iso(a.startAt),
          endAt: iso(a.endAt),
          serviceName: svc.get(a.serviceId.toString()) ?? '',
          staffName: stf.get(a.staffId.toString()) ?? '',
          customerName: c?.name ?? '',
          customerEmail: c?.email ?? null,
          customerPhone: c?.phone ?? null,
          source: a.source,
        };
      },
    );
  },
};

export const RESOURCES: Record<ExcelResource, ResourceDef> = {
  customers,
  leads,
  services,
  staff,
  appointments,
};

export function rowErrorFromException(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if ((err as { code?: number }).code === 11000) return 'Duplicate record';
  return 'Failed to save row';
}
