import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { logger } from '../../common/logging/logger';
import { sha256 } from '../../common/utils/crypto';
import { normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { getQueue, registerJobHandler } from '../../infrastructure/queue/queue';
import { TenantSettingsModel } from '../business-config/tenant-settings.model';
import { TenantModel } from '../tenants/tenant.model';
import { systemContext } from '../memberships/membership-context';
import { CustomerModel, type CustomerDoc } from '../customers/customer.models';
import {
  ConversationMessageModel,
  ConversationSessionModel,
  type ConversationSessionDoc,
} from '../conversations/conversation.models';
import { requestHandoff } from '../conversations/handoff';
import { handleCustomerMessage } from '../ai/ai.service';
import { applyDeliveryStatus, queueNotification } from '../notifications/notification.service';
import { WebhookEventModel } from './webhook-event.model';

const RETENTION_DAYS = 30;
const OPT_OUT = /^\s*(stop|unsubscribe|opt[\s-]?out)\s*$/i;
const OPT_IN = /^\s*(start|subscribe|opt[\s-]?in)\s*$/i;

// Minimal, permissive parsing of the Meta webhook envelope; unknown fields are ignored.
const payloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z
        .object({
          changes: z.array(
            z
              .object({
                value: z
                  .object({
                    metadata: z.object({ phone_number_id: z.string() }).passthrough().optional(),
                    contacts: z
                      .array(
                        z.object({
                          wa_id: z.string(),
                          profile: z.object({ name: z.string().optional() }).optional(),
                        }),
                      )
                      .optional(),
                    messages: z
                      .array(
                        z
                          .object({
                            id: z.string(),
                            from: z.string(),
                            type: z.string(),
                            text: z.object({ body: z.string() }).optional(),
                          })
                          .passthrough(),
                      )
                      .optional(),
                    statuses: z
                      .array(
                        z
                          .object({
                            id: z.string(),
                            status: z.string(),
                            errors: z.array(z.object({ title: z.string().optional() })).optional(),
                          })
                          .passthrough(),
                      )
                      .optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    )
    .max(100),
});

/** Stores the raw webhook once (dedup by content hash) and enqueues async processing. */
export async function receiveWebhook(rawBody: Buffer, payload: unknown): Promise<{ duplicate: boolean }> {
  const eventKey = sha256(rawBody.toString('utf8'));
  try {
    const ev = await WebhookEventModel.create({
      provider: 'whatsapp',
      eventKey,
      payload,
      expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000),
    });
    await getQueue().enqueue(
      'whatsapp.inbound',
      { webhookEventId: ev._id.toString() },
      { jobId: `wa:${ev._id}` },
    );
    return { duplicate: false };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { duplicate: true };
    throw err;
  }
}

async function resolveTenantByPhoneNumberId(phoneNumberId: string) {
  // Intentional cross-tenant lookup on a globally unique routing key; result scopes all further work.
  const settings = await TenantSettingsModel.findOne(
    { 'integrations.whatsapp.phoneNumberId': phoneNumberId, 'integrations.whatsapp.enabled': true },
    'tenantId',
    { skipTenantGuard: true },
  ).lean();
  if (!settings) return null;
  const tenant = await TenantModel.findOne(
    { _id: settings.tenantId, status: 'ACTIVE' },
    '_id slug timezone',
  ).lean();
  return tenant;
}

async function findOrOpenSession(tenantId: Types.ObjectId, waId: string, name?: string) {
  const sessions = new TenantRepository<ConversationSessionDoc>(ConversationSessionModel, tenantId);
  const existing = await sessions.findOne({
    channel: 'WHATSAPP',
    externalUserId: waId,
    status: { $in: ['OPEN', 'HANDOFF'] },
  });
  if (existing) return existing;
  const phone = normalizePhone(`+${waId}`);
  const customer = await new TenantRepository<CustomerDoc>(CustomerModel, tenantId).findOne({
    phoneNormalized: phone,
    status: 'ACTIVE',
  });
  try {
    return await sessions.create({
      channel: 'WHATSAPP',
      status: 'OPEN',
      externalUserId: waId,
      contactName: name,
      customerId: customer?._id,
      turnCount: 0,
      linkedAppointmentIds: [],
    });
  } catch (err) {
    if (isDuplicateKeyError(err))
      return (await sessions.findOne({
        channel: 'WHATSAPP',
        externalUserId: waId,
        status: { $in: ['OPEN', 'HANDOFF'] },
      }))!;
    throw err;
  }
}

async function setWhatsAppConsent(tenantId: Types.ObjectId, waId: string, value: boolean) {
  await new TenantRepository(CustomerModel, tenantId).updateMany(
    { phoneNormalized: normalizePhone(`+${waId}`) },
    { $set: { 'consent.whatsapp': value, 'consent.updatedAt': new Date() } },
  );
}

async function processInboundMessage(
  tenant: { _id: Types.ObjectId; slug: string; timezone: string },
  msg: { id: string; from: string; type: string; text?: { body: string } },
  contactName?: string,
) {
  const tenantId = tenant._id;
  // Idempotency at message level: provider message ids are unique per tenant.
  if (
    await new TenantRepository(ConversationMessageModel, tenantId).findOne(
      { externalMessageId: msg.id },
      { projection: { _id: 1 } },
    )
  )
    return;

  const session = await findOrOpenSession(tenantId, msg.from, contactName);
  const text = msg.type === 'text' ? (msg.text?.body ?? '') : `[${msg.type} message received]`;
  const reply = (body: string) =>
    queueNotification(tenantId, {
      channel: 'WHATSAPP',
      to: `+${msg.from}`,
      templateKey: 'free_text',
      data: { text: body },
      dedupeKey: `wa-reply:${msg.id}`,
    });

  if (OPT_OUT.test(text)) {
    await setWhatsAppConsent(tenantId, msg.from, false);
    await new TenantRepository(ConversationMessageModel, tenantId).create({
      sessionId: session._id,
      role: 'user',
      text,
      externalMessageId: msg.id,
    });
    return;
  }
  if (OPT_IN.test(text)) await setWhatsAppConsent(tenantId, msg.from, true);

  try {
    const result = await handleCustomerMessage(systemContext(tenant, 'ai'), session._id, text, {
      externalMessageId: msg.id,
      channelPhone: `+${msg.from}`,
    });
    if (result.reply) await reply(result.reply);
  } catch (err) {
    if (
      err instanceof AppError &&
      ['FEATURE_DISABLED', 'INTEGRATION_UNAVAILABLE', 'PROVIDER_ERROR', 'QUOTA_EXCEEDED'].includes(err.code)
    ) {
      // No fabricated answer: hand off to humans and tell the customer honestly.
      await requestHandoff(tenantId, session._id, `AI unavailable: ${err.code}`);
      const settings = await new TenantRepository(TenantSettingsModel, tenantId).findOne({});
      await reply(
        settings?.ai?.handoffMessage || 'Thanks for your message. A member of our team will reply shortly.',
      );
      return;
    }
    throw err;
  }
}

export async function processWebhookEvent(webhookEventId: string): Promise<void> {
  const ev = await WebhookEventModel.findOneAndUpdate(
    { _id: webhookEventId, status: { $in: ['RECEIVED', 'FAILED'] } },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!ev) return;
  const parsed = payloadSchema.safeParse(ev.payload);
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
    await WebhookEventModel.updateOne(
      { _id: ev._id },
      { $set: { status: 'IGNORED', processedAt: new Date(), error: 'Unrecognised payload' } },
    );
    return;
  }
  try {
    let tenantId: Types.ObjectId | undefined;
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const v = change.value;
        const phoneNumberId = v.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        const tenant = await resolveTenantByPhoneNumberId(phoneNumberId);
        if (!tenant) {
          logger.warn({ phoneNumberId }, 'WhatsApp webhook for unknown or inactive business number');
          continue;
        }
        tenantId = tenant._id;
        for (const s of v.statuses ?? []) {
          if (['sent', 'delivered', 'read', 'failed'].includes(s.status)) {
            await applyDeliveryStatus(
              tenant._id,
              s.id,
              s.status as 'sent' | 'delivered' | 'read' | 'failed',
              s.errors?.[0]?.title,
            );
          }
        }
        for (const m of v.messages ?? []) {
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
          await processInboundMessage(tenant, m, name);
        }
      }
    }
    await WebhookEventModel.updateOne(
      { _id: ev._id },
      { $set: { status: tenantId ? 'PROCESSED' : 'IGNORED', tenantId, processedAt: new Date() } },
    );
  } catch (err) {
    await WebhookEventModel.updateOne(
      { _id: ev._id },
      { $set: { status: 'FAILED', error: (err as Error).message?.slice(0, 500) } },
    );
    throw err;
  }
}

export function registerWhatsAppJobs() {
  registerJobHandler('whatsapp.inbound', async (data) => {
    const id = String((data as { webhookEventId?: unknown }).webhookEventId ?? '');
    if (!Types.ObjectId.isValid(id)) throw new Error('Invalid webhookEventId');
    await processWebhookEvent(id);
  });
}
