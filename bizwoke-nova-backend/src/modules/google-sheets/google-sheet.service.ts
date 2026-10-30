import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { events } from '../../common/utils/events';
import { assertTenantJob, getQueue, registerJobHandler } from '../../infrastructure/queue/queue';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.models';
import { CustomerModel, type CustomerDoc } from '../customers/customer.models';
import { ServiceModel } from '../services/service.model';
import { StaffModel } from '../staff/staff.models';

/** Column order of the sheet; the Apps Script matches rows on the first column (Reference). */
export const SHEET_HEADERS = [
  'Reference',
  'Customer Name',
  'Phone',
  'Service',
  'Doctor',
  'Date',
  'Time',
  'Booking Status',
  'Payment Status',
  'Source',
  'Updated At',
];

export function googleSheetEnabled(): boolean {
  return Boolean(env().GOOGLE_SHEET_WEBHOOK_URL && env().GOOGLE_SHEET_SECRET);
}

async function buildRow(tenantIdStr: string, appointmentId: string): Promise<string[] | null> {
  const tenantId = new Types.ObjectId(tenantIdStr);
  const appt = await new TenantRepository<AppointmentDoc>(AppointmentModel, tenantId).findById(appointmentId);
  if (!appt) return null;
  const [customer, service, staff] = await Promise.all([
    new TenantRepository<CustomerDoc>(CustomerModel, tenantId).findById(appt.customerId),
    new TenantRepository(ServiceModel, tenantId).findById(appt.serviceId),
    new TenantRepository(StaffModel, tenantId).findById(appt.staffId),
  ]);
  const local = DateTime.fromJSDate(appt.startAt, { zone: appt.timezone });
  return [
    appt.reference,
    customer?.name ?? '',
    customer?.phone ?? '',
    service?.name ?? '',
    staff?.name ?? '',
    local.toFormat('dd LLL yyyy'),
    local.toFormat('h:mm a'),
    appt.status,
    appt.paymentStatus ?? 'UNPAID',
    appt.source,
    DateTime.now().setZone(appt.timezone).toFormat('dd LLL yyyy h:mm a'),
  ];
}

/** Upserts the appointment's row (always the latest DB state, so job ordering does not matter). */
async function syncAppointment(tenantId: string, appointmentId: string) {
  const row = await buildRow(tenantId, appointmentId);
  if (!row) return;
  const { GOOGLE_SHEET_WEBHOOK_URL, GOOGLE_SHEET_SECRET, GOOGLE_SHEET_NAME } = env();
  const res = await fetch(GOOGLE_SHEET_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: GOOGLE_SHEET_SECRET,
      sheet: GOOGLE_SHEET_NAME,
      headers: SHEET_HEADERS,
      row,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(`Google Sheet sync failed (HTTP ${res.status}): ${json.error ?? 'unexpected response'}`);
  }
}

export function registerGoogleSheetHandlers() {
  registerJobHandler('google-sheet.sync', async (data) => {
    assertTenantJob(data);
    const id = String(data.appointmentId ?? '');
    if (!Types.ObjectId.isValid(id)) throw new Error('Invalid appointmentId');
    await syncAppointment(data.tenantId, id);
  });

  const enqueue = async ({ tenantId, appointmentId }: { tenantId: string; appointmentId: string }) => {
    if (!googleSheetEnabled()) return;
    await getQueue().enqueue('google-sheet.sync', { tenantId, appointmentId });
  };
  events.on('appointment.created', enqueue);
  events.on('appointment.status_changed', enqueue);
  events.on('appointment.rescheduled', enqueue);
  events.on('appointment.payment_changed', enqueue);
}
