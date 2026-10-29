import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../common/logging/logger';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { getQueue, assertTenantJob, registerJobHandler } from '../../infrastructure/queue/queue';
import { getEmailProvider } from '../../infrastructure/email/email.provider';
import { getWhatsAppProvider, WhatsAppProviderError } from '../../infrastructure/messaging/whatsapp.provider';
import { TenantSettingsModel, type TenantSettingsDoc } from '../business-config/tenant-settings.model';
import { consumeQuota } from '../usage/usage.service';
import { NotificationModel, type NotificationDoc, type TemplateKey } from './notification.model';

const MAX_ATTEMPTS = 5;

export interface QueueNotificationInput {
  channel: NotificationDoc['channel'];
  to: string;
  templateKey: TemplateKey;
  data: Record<string, string>;
  scheduledFor?: Date;
  dedupeKey?: string;
  appointmentId?: Types.ObjectId;
  customerId?: Types.ObjectId;
}

const repo = (tenantId: Types.ObjectId) => new TenantRepository<NotificationDoc>(NotificationModel, tenantId);

/** Persists the notification first (durable), then enqueues delivery if it is due now. */
export async function queueNotification(
  tenantId: Types.ObjectId,
  input: QueueNotificationInput,
): Promise<NotificationDoc | null> {
  let doc: NotificationDoc;
  try {
    doc = await repo(tenantId).create({
      ...input,
      scheduledFor: input.scheduledFor ?? new Date(),
      status: 'QUEUED',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return null; // dedupeKey: already queued
    throw err;
  }
  if (doc.scheduledFor.getTime() <= Date.now() + 1000) {
    await getQueue().enqueue(
      'notification.send',
      { tenantId: tenantId.toString(), notificationId: doc._id.toString() },
      {
        jobId: `notification:${doc._id}:${doc.attempts}`,
      },
    );
  }
  return doc;
}

export async function cancelPendingNotifications(
  tenantId: Types.ObjectId,
  appointmentId: Types.ObjectId,
  templateKey?: TemplateKey,
) {
  await repo(tenantId).updateMany(
    { appointmentId, status: 'QUEUED', ...(templateKey ? { templateKey } : {}) },
    { $set: { status: 'CANCELLED' } },
  );
}

/** Placeholders a business can use in its own message texts (allowlist; nothing else is substituted). */
export const MESSAGE_PLACEHOLDERS: Record<string, string> = {
  name: 'customerName',
  service: 'serviceName',
  staff: 'staffName',
  date: 'date',
  time: 'time',
  when: 'when',
  reference: 'reference',
  business: 'businessName',
  status: 'statusText',
};

export function fillPlaceholders(text: string, d: Record<string, string>): string {
  return text.replace(/\{\s*([a-z]+)\s*\}/gi, (m, k: string) => {
    const field = MESSAGE_PLACEHOLDERS[k.toLowerCase()];
    return field ? (d[field] ?? '') : m;
  });
}

type CustomTextKey = keyof TenantSettingsDoc['notifications']['texts'];

function render(
  key: TemplateKey,
  d: Record<string, string>,
  customTexts?: Partial<Record<CustomTextKey, string>>,
): { subject: string; text: string; params: string[] } {
  const base = renderDefault(key, d);
  const custom = customTexts?.[key as CustomTextKey]?.trim();
  return custom ? { ...base, text: fillPlaceholders(custom, d) } : base;
}

function renderDefault(
  key: TemplateKey,
  d: Record<string, string>,
): { subject: string; text: string; params: string[] } {
  const biz = d.businessName ?? '';
  switch (key) {
    case 'appointment_confirmation':
      return {
        subject: `Appointment confirmed – ${biz}`,
        text: `Hi ${d.customerName}, your ${d.serviceName} appointment with ${biz} is ${d.statusText} for ${d.when}. Reference: ${d.reference}.`,
        params: [d.customerName ?? '', d.serviceName ?? '', d.when ?? '', d.reference ?? ''],
      };
    case 'appointment_reminder':
      return {
        subject: `Reminder: upcoming appointment – ${biz}`,
        text: `Hi ${d.customerName}, this is a reminder of your ${d.serviceName} appointment with ${biz} on ${d.when}. Reference: ${d.reference}.`,
        params: [d.customerName ?? '', d.serviceName ?? '', d.when ?? '', d.reference ?? ''],
      };
    case 'appointment_cancelled':
      return {
        subject: `Appointment cancelled – ${biz}`,
        text: `Hi ${d.customerName}, your appointment ${d.reference} on ${d.when} has been cancelled.`,
        params: [d.customerName ?? '', d.reference ?? '', d.when ?? ''],
      };
    case 'appointment_rescheduled':
      return {
        subject: `Appointment rescheduled – ${biz}`,
        text: `Hi ${d.customerName}, your appointment ${d.reference} has been moved to ${d.when}.`,
        params: [d.customerName ?? '', d.reference ?? '', d.when ?? ''],
      };
    case 'appointment_access':
      return {
        subject: `Manage your appointment – ${biz}`,
        text: `Use this access code to view, cancel or reschedule appointment ${d.reference}:\n\n${d.accessToken}`,
        params: [d.reference ?? '', d.accessToken ?? ''],
      };
    case 'handoff_ack':
      return {
        subject: `${biz}`,
        text: d.text ?? 'A member of our team will get back to you shortly.',
        params: [],
      };
    case 'handoff_alert':
      return {
        subject: `Customer needs assistance`,
        text: `A conversation requires human attention. Reason: ${d.reason}. Session: ${d.sessionId}.`,
        params: [],
      };
    case 'operational_alert':
      return { subject: d.subject ?? 'Operational alert', text: d.text ?? '', params: [] };
    case 'free_text':
      return { subject: d.subject ?? biz, text: d.text ?? '', params: [] };
  }
}

async function finalize(tenantId: Types.ObjectId, id: Types.ObjectId, set: Partial<NotificationDoc>) {
  await repo(tenantId).updateOne({ _id: id }, { $set: set });
}

/** Delivery job. Scoped to the job's tenant: a notification id from another tenant is simply not found. */
export async function deliverNotification(tenantIdStr: string, notificationId: string): Promise<void> {
  const tenantId = new Types.ObjectId(tenantIdStr);
  if (!Types.ObjectId.isValid(notificationId)) return;
  // Atomic claim prevents two workers sending the same message.
  const n = await repo(tenantId).findOneAndUpdate(
    { _id: notificationId, status: 'QUEUED', scheduledFor: { $lte: new Date(Date.now() + 1000) } },
    { $set: { status: 'SENDING' }, $inc: { attempts: 1 } },
  );
  if (!n) return;

  const settings = await new TenantRepository<TenantSettingsDoc>(TenantSettingsModel, tenantId).findOne({});
  const rendered = render(
    n.templateKey,
    { businessName: settings?.profile.displayName ?? '', ...n.data },
    settings?.notifications?.texts,
  );

  try {
    if (n.channel === 'EMAIL') {
      const email = getEmailProvider();
      if (!email)
        return finalize(tenantId, n._id, { status: 'SKIPPED', lastError: 'Email provider not configured' });
      const r = await email.send({ to: n.to, subject: rendered.subject, text: rendered.text });
      return finalize(tenantId, n._id, {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: r.providerMessageId,
      });
    }

    const wa = getWhatsAppProvider();
    const integration = settings?.integrations?.whatsapp;
    if (!wa)
      return finalize(tenantId, n._id, { status: 'SKIPPED', lastError: 'WhatsApp provider not configured' });
    if (!integration?.enabled || !integration.phoneNumberId || !settings?.features.whatsapp) {
      return finalize(tenantId, n._id, {
        status: 'SKIPPED',
        lastError: 'WhatsApp not enabled for this tenant',
      });
    }
    if (env().WHATSAPP_DRY_RUN) {
      logger.info(
        { tenantId: tenantIdStr, notificationId, to: n.to, provider: wa.name },
        'WhatsApp dry run: not sent',
      );
      return finalize(tenantId, n._id, {
        status: 'SKIPPED',
        lastError: 'WHATSAPP_DRY_RUN is enabled; message not sent',
      });
    }
    await consumeQuota(tenantId, 'whatsappMessages');
    let result: { providerMessageId: string };
    if (!wa.requiresApprovedTemplates || n.templateKey === 'free_text' || n.templateKey === 'handoff_ack') {
      result = await wa.sendText({ phoneNumberId: integration.phoneNumberId, to: n.to, text: rendered.text });
    } else {
      const tpl = integration.templates?.find((t) => t.key === n.templateKey);
      if (!tpl)
        return finalize(tenantId, n._id, {
          status: 'SKIPPED',
          lastError: `No approved WhatsApp template mapped for ${n.templateKey}`,
        });
      result = await wa.sendTemplate({
        phoneNumberId: integration.phoneNumberId,
        to: n.to,
        template: { name: tpl.name, language: tpl.language, bodyParams: rendered.params },
      });
    }
    return finalize(tenantId, n._id, {
      status: 'SENT',
      sentAt: new Date(),
      providerMessageId: result.providerMessageId,
    });
  } catch (err) {
    const retryable = !(err instanceof WhatsAppProviderError) || err.retryable;
    const message = (err as Error).message?.slice(0, 500) ?? 'Unknown error';
    if (retryable && n.attempts < MAX_ATTEMPTS) {
      // Bounded exponential backoff persisted in MongoDB; the due-sweeper re-dispatches it.
      const delayMs = Math.min(60_000 * 2 ** (n.attempts - 1), 3_600_000);
      await finalize(tenantId, n._id, {
        status: 'QUEUED',
        lastError: message,
        scheduledFor: new Date(Date.now() + delayMs),
      });
    } else {
      await finalize(tenantId, n._id, { status: 'FAILED', lastError: message });
    }
    logger.warn(
      { tenantId: tenantIdStr, notificationId, err: message, attempt: n.attempts },
      'Notification delivery failed',
    );
  }
}

/** Platform sweep: finds due notifications in all tenants and enqueues per-tenant delivery jobs. */
export async function dispatchDueNotifications(limit = 500): Promise<number> {
  const due = await NotificationModel.find(
    { status: 'QUEUED', scheduledFor: { $lte: new Date() } },
    '_id tenantId attempts',
    {
      skipTenantGuard: true,
    },
  )
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .lean();
  for (const n of due) {
    await getQueue().enqueue(
      'notification.send',
      { tenantId: n.tenantId.toString(), notificationId: n._id.toString() },
      {
        jobId: `notification:${n._id}:${n.attempts}`,
      },
    );
  }
  return due.length;
}

/** Provider delivery receipts. Only provider-confirmed statuses advance SENT -> DELIVERED/READ/FAILED. */
export async function applyDeliveryStatus(
  tenantId: Types.ObjectId,
  providerMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  error?: string,
) {
  const map = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' } as const;
  const set: Record<string, unknown> = { status: map[status] };
  if (status === 'delivered') set.deliveredAt = new Date();
  if (error) set.lastError = error.slice(0, 500);
  await repo(tenantId).updateOne({ providerMessageId }, { $set: set });
}

export function formatWhen(date: Date, timezone: string, locale = 'en'): string {
  return DateTime.fromJSDate(date, { zone: timezone })
    .setLocale(locale)
    .toFormat("ccc d LLL yyyy, HH:mm '('ZZZZ')'");
}

export function registerNotificationJobs() {
  registerJobHandler('notification.send', async (data) => {
    assertTenantJob(data);
    await deliverNotification(data.tenantId, String(data.notificationId));
  });
  registerJobHandler('notifications.dispatch-due', async () => {
    await dispatchDueNotifications();
  });
}
