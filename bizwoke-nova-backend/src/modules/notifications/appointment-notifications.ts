import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { events } from '../../common/utils/events';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.models';
import { CustomerModel, type CustomerDoc } from '../customers/customer.models';
import { ServiceModel } from '../services/service.model';
import { StaffModel } from '../staff/staff.models';
import { TenantSettingsModel } from '../business-config/tenant-settings.model';
import type { TemplateKey } from './notification.model';
import { cancelPendingNotifications, formatWhen, queueNotification } from './notification.service';

const DEFAULT_REMINDER_LEAD_MINUTES = 1440;

async function load(tenantIdStr: string, appointmentId: string) {
  const tenantId = new Types.ObjectId(tenantIdStr);
  const appt = await new TenantRepository<AppointmentDoc>(AppointmentModel, tenantId).findById(appointmentId);
  if (!appt) return null;
  const [customer, service, settings, staff] = await Promise.all([
    new TenantRepository<CustomerDoc>(CustomerModel, tenantId).findById(appt.customerId),
    new TenantRepository(ServiceModel, tenantId).findById(appt.serviceId),
    new TenantRepository(TenantSettingsModel, tenantId).findOne({}),
    new TenantRepository(StaffModel, tenantId).findById(appt.staffId),
  ]);
  if (!customer || customer.status !== 'ACTIVE') return null;
  return {
    tenantId,
    appt,
    customer,
    serviceName: service?.name ?? '',
    staffName: staff?.name ?? '',
    locale: settings?.locale ?? 'en',
    reminderLeadMinutes: settings?.notifications?.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES,
  };
}

/** Transactional messages: email when available; WhatsApp only with explicit opt-in. */
async function notifyCustomer(
  ctx: NonNullable<Awaited<ReturnType<typeof load>>>,
  templateKey: TemplateKey,
  opts: { scheduledFor?: Date; dedupe: string },
) {
  const { tenantId, appt, customer } = ctx;
  const local = DateTime.fromJSDate(appt.startAt, { zone: appt.timezone }).setLocale(ctx.locale);
  const data = {
    staffName: ctx.staffName,
    date: local.toFormat('ccc d LLL yyyy'),
    time: local.toFormat('h:mm a'),
    customerName: customer.name,
    serviceName: ctx.serviceName,
    reference: appt.reference,
    when: formatWhen(appt.startAt, appt.timezone, ctx.locale),
    statusText: appt.status === 'CONFIRMED' ? 'confirmed' : 'received and awaiting confirmation',
  };
  const base = {
    templateKey,
    data,
    scheduledFor: opts.scheduledFor,
    appointmentId: appt._id,
    customerId: customer._id,
  };
  if (customer.email)
    await queueNotification(tenantId, {
      ...base,
      channel: 'EMAIL',
      to: customer.email,
      dedupeKey: `${opts.dedupe}:email`,
    });
  if (customer.phone && customer.consent?.whatsapp) {
    await queueNotification(tenantId, {
      ...base,
      channel: 'WHATSAPP',
      to: customer.phone,
      dedupeKey: `${opts.dedupe}:wa`,
    });
  }
}

async function scheduleReminder(ctx: NonNullable<Awaited<ReturnType<typeof load>>>) {
  if (ctx.reminderLeadMinutes <= 0) return; // reminders disabled by the business
  const at = new Date(ctx.appt.startAt.getTime() - ctx.reminderLeadMinutes * 60_000);
  if (at.getTime() <= Date.now()) return;
  await notifyCustomer(ctx, 'appointment_reminder', {
    scheduledFor: at,
    dedupe: `reminder:${ctx.appt._id}:${ctx.appt.startAt.getTime()}`,
  });
}

export function registerAppointmentNotificationHandlers() {
  events.on('appointment.created', async ({ tenantId, appointmentId }) => {
    const ctx = await load(tenantId, appointmentId);
    if (!ctx) return;
    await notifyCustomer(ctx, 'appointment_confirmation', {
      dedupe: `confirm:${appointmentId}:${ctx.appt.status}`,
    });
    if (ctx.appt.status === 'CONFIRMED') await scheduleReminder(ctx);
  });

  events.on('appointment.status_changed', async ({ tenantId, appointmentId, to }) => {
    const ctx = await load(tenantId, appointmentId);
    if (!ctx) return;
    if (to === 'CONFIRMED') {
      await notifyCustomer(ctx, 'appointment_confirmation', { dedupe: `confirm:${appointmentId}:CONFIRMED` });
      await scheduleReminder(ctx);
    }
    if (to === 'CANCELLED' || to === 'NO_SHOW')
      await cancelPendingNotifications(ctx.tenantId, ctx.appt._id, 'appointment_reminder');
    if (to === 'CANCELLED')
      await notifyCustomer(ctx, 'appointment_cancelled', { dedupe: `cancel:${appointmentId}` });
  });

  events.on('appointment.rescheduled', async ({ tenantId, appointmentId }) => {
    const ctx = await load(tenantId, appointmentId);
    if (!ctx) return;
    await cancelPendingNotifications(ctx.tenantId, ctx.appt._id, 'appointment_reminder');
    await notifyCustomer(ctx, 'appointment_rescheduled', {
      dedupe: `resched:${appointmentId}:${ctx.appt.startAt.getTime()}`,
    });
    if (ctx.appt.status === 'CONFIRMED') await scheduleReminder(ctx);
  });
}
