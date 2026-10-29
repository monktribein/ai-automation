import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  addMember,
  setupBookable,
  futureDate,
  at,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import { resetEnvCache } from '../../config/env';
import {
  AkNexusWhatsAppProvider,
  setWhatsAppProviderForTests,
  WhatsAppProviderError,
} from '../../infrastructure/messaging/whatsapp.provider';
import { setAiProviderForTests } from '../../infrastructure/ai/ai.provider';
import { parseAkNexusWebhook } from '../../modules/whatsapp/aknexus-webhook';
import { NotificationModel } from '../../modules/notifications/notification.model';
import { ConversationSessionModel } from '../../modules/conversations/conversation.models';
import { WebhookEventModel } from '../../modules/whatsapp/webhook-event.model';
import { TenantSettingsModel } from '../../modules/business-config/tenant-settings.model';

const INSTANCE = '6ADC3724DD691';
const SECRET = process.env.AK_NEXUS_WEBHOOK_SECRET!;

let app: Express;
let t: TenantFixture;
let serviceId: string;

/** Stubs fetch for the AK Nexus host only and records every call. */
function stubAkNexus(
  response: { status: number; body: unknown } = {
    status: 200,
    body: { status: 'success', data: { sent: true } },
  },
) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app);
  ({ serviceId } = await setupBookable(app, t));
  await request(app)
    .put('/api/v1/business/integrations/whatsapp')
    .set(auth(t))
    .send({ phoneNumberId: INSTANCE, enabled: true })
    .expect(200);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setWhatsAppProviderForTests(undefined);
  setAiProviderForTests(undefined);
});
afterAll(teardownTestApp);

describe('AK Nexus payload parser', () => {
  it('understands flat, nested and Baileys-style payloads and skips own/group messages', () => {
    expect(
      parseAkNexusWebhook({ instance_id: INSTANCE, from: '+91 98765 43210', message: 'Hi', id: 'm1' })
        .messages,
    ).toEqual([{ instanceId: INSTANCE, messageId: 'm1', from: '919876543210', text: 'Hi', name: undefined }]);
    const baileys = parseAkNexusWebhook({
      instance_id: INSTANCE,
      data: {
        event: 'messages.upsert',
        data: {
          messages: [
            {
              key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'ABC' },
              pushName: 'Ravi',
              message: { conversation: 'Book a slot' },
            },
          ],
        },
      },
    });
    expect(baileys.messages[0]).toMatchObject({
      from: '919876543210',
      text: 'Book a slot',
      messageId: 'ABC',
      name: 'Ravi',
      instanceId: INSTANCE,
    });
    expect(
      parseAkNexusWebhook({ event: 'message', data: { phone: '919876543210', text: { body: 'yo' } } })
        .messages[0]!.text,
    ).toBe('yo');
    expect(
      parseAkNexusWebhook({
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: true },
        message: { conversation: 'mine' },
      }).messages,
    ).toEqual([]);
    expect(
      parseAkNexusWebhook({ key: { remoteJid: '1203630@g.us' }, message: { conversation: 'group' } })
        .messages,
    ).toEqual([]);
    expect(parseAkNexusWebhook({ event: 'connection.update', status: 'open' }).messages).toEqual([]);
    expect(parseAkNexusWebhook('nonsense').messages).toEqual([]);
  });
});

describe('AK Nexus provider', () => {
  it('posts the documented send/text contract with Bearer auth', async () => {
    const calls = stubAkNexus();
    const p = new AkNexusWhatsAppProvider('wz_test_token', 'https://aknexus.example.test/api/v2/');
    const r = await p.sendText({ phoneNumberId: INSTANCE, to: '+91 98765-43210', text: 'Hello' });
    expect(calls[0]!.url).toBe('https://aknexus.example.test/api/v2/whatsapp/send/text');
    expect(calls[0]!.headers.Authorization).toBe('Bearer wz_test_token');
    expect(calls[0]!.body).toEqual({ instance_id: INSTANCE, to: '919876543210', message: 'Hello' });
    expect(r.providerMessageId).toMatch(/^aknexus-/);
  });

  it('maps errors: auth/validation are permanent, rate limits and outages are retryable', async () => {
    const p = new AkNexusWhatsAppProvider('bad', 'https://aknexus.example.test/api/v2');
    stubAkNexus({ status: 401, body: { status: 401, messages: { error: 'Invalid or missing API token.' } } });
    await expect(
      p.sendText({ phoneNumberId: INSTANCE, to: '919876543210', text: 'x' }),
    ).rejects.toMatchObject({ retryable: false, message: 'Invalid or missing API token.' });
    stubAkNexus({ status: 429, body: { status: 'error', message: 'Rate limited' } });
    await expect(
      p.sendText({ phoneNumberId: INSTANCE, to: '919876543210', text: 'x' }),
    ).rejects.toMatchObject({ retryable: true });
    stubAkNexus({ status: 200, body: { status: 'error', message: 'Instance disconnected' } });
    await expect(
      p.sendText({ phoneNumberId: INSTANCE, to: '919876543210', text: 'x' }),
    ).rejects.toBeInstanceOf(WhatsAppProviderError);
  });
});

describe('notifications via AK Nexus', () => {
  it('sends booking confirmations as rendered text (no Meta template needed)', async () => {
    const calls = stubAkNexus();
    setWhatsAppProviderForTests(
      new AkNexusWhatsAppProvider('wz_test_token', 'https://aknexus.example.test/api/v2'),
    );
    const res = await request(app)
      .post(`/api/v1/public/${t.slug}/appointments`)
      .send({
        serviceId,
        startAt: at(futureDate(4), '10:00'),
        customer: { name: 'Ravi', phone: '+919876543210', consent: { whatsapp: true } },
      })
      .expect(201);
    await drainInlineQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.instance_id).toBe(INSTANCE);
    expect(calls[0]!.body.to).toBe('919876543210');
    expect(String(calls[0]!.body.message)).toContain(res.body.data.appointment.reference);
    const n = await NotificationModel.findOne({
      tenantId: t.tenantId,
      channel: 'WHATSAPP',
      templateKey: 'appointment_confirmation',
    }).lean();
    expect(n!.status).toBe('SENT');
  });

  it('WHATSAPP_DRY_RUN never calls the provider and never reports SENT', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    resetEnvCache();
    try {
      const calls = stubAkNexus();
      setWhatsAppProviderForTests(
        new AkNexusWhatsAppProvider('wz_test_token', 'https://aknexus.example.test/api/v2'),
      );
      await request(app)
        .post(`/api/v1/public/${t.slug}/appointments`)
        .send({
          serviceId,
          startAt: at(futureDate(5), '10:00'),
          customer: { name: 'Dry', phone: '+919811111111', consent: { whatsapp: true } },
        })
        .expect(201);
      await drainInlineQueue();
      expect(calls).toHaveLength(0);
      const n = await NotificationModel.findOne({
        tenantId: t.tenantId,
        to: '+919811111111',
        templateKey: 'appointment_confirmation',
      }).lean();
      expect(n!.status).toBe('SKIPPED');
      expect(n!.lastError).toMatch(/DRY_RUN/);
    } finally {
      process.env.WHATSAPP_DRY_RUN = 'false';
      resetEnvCache();
    }
  });
});

describe('AK Nexus inbound webhook', () => {
  const post = (secret: string, body: unknown) =>
    request(app)
      .post(`/api/v1/webhooks/aknexus/${secret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

  it('rejects a wrong secret before storing anything', async () => {
    const before = await WebhookEventModel.countDocuments({ provider: 'aknexus' });
    await post('wrong-secret', { from: '919800000000', message: 'hi' }).expect(401);
    expect(await WebhookEventModel.countDocuments({ provider: 'aknexus' })).toBe(before);
  });

  it('routes the message to the tenant owning the instance, runs AI and replies via AK Nexus', async () => {
    await TenantSettingsModel.updateOne(
      { tenantId: t.tenantId },
      { $set: { 'features.ai': true, 'ai.enabled': true, 'whatsappAssistant.mode': 'ai' } },
    );
    setAiProviderForTests({
      name: 'mock',
      defaultModel: 'm',
      complete: async () => ({
        content: [{ type: 'text', text: 'Namaste! How can I help?' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'm',
      }),
    });
    const calls = stubAkNexus();
    setWhatsAppProviderForTests(
      new AkNexusWhatsAppProvider('wz_test_token', 'https://aknexus.example.test/api/v2'),
    );
    const body = {
      instance_id: INSTANCE,
      event: 'message',
      data: { from: '919822222222', message: 'Hello', id: 'in-1', pushName: 'Asha' },
    };
    const first = await post(SECRET, body).expect(200);
    expect(first.body.data.duplicate).toBe(false);
    expect((await post(SECRET, body).expect(200)).body.data.duplicate).toBe(true);
    await drainInlineQueue();
    const s = await ConversationSessionModel.findOne({
      tenantId: t.tenantId,
      channel: 'WHATSAPP',
      externalUserId: '919822222222',
    }).lean();
    expect(s!.contactName).toBe('Asha');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      instance_id: INSTANCE,
      to: '919822222222',
      message: 'Namaste! How can I help?',
    });
  });

  it('stores unrecognised payloads as IGNORED for inspection instead of guessing', async () => {
    await post(SECRET, { event: 'connection.update', state: 'open' }).expect(200);
    await drainInlineQueue();
    const ev = await WebhookEventModel.findOne({ provider: 'aknexus' }).sort({ createdAt: -1 }).lean();
    expect(ev!.status).toBe('IGNORED');
    expect(ev!.error).toMatch(/connection.update/);
  });
});

describe('WhatsApp status and test message from the dashboard', () => {
  const provider = () =>
    setWhatsAppProviderForTests(
      new AkNexusWhatsAppProvider('wz_test_token', 'https://aknexus.example.test/api/v2'),
    );

  it('reports the live instance status (read-only GET)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify({ status: 'connected', instance_id: INSTANCE }), { status: 200 });
    });
    provider();
    const r = await request(app)
      .get('/api/v1/business/integrations/whatsapp/status')
      .set(auth(t))
      .expect(200);
    expect(r.body.data).toMatchObject({
      provider: 'aknexus',
      instanceId: INSTANCE,
      connection: 'connected',
      integrationEnabled: true,
      dryRun: false,
    });
    expect(calls).toEqual([`GET https://aknexus.example.test/api/v2/whatsapp/instance/status/${INSTANCE}`]);
  });

  it('shows provider errors without failing the page', async () => {
    stubAkNexus({ status: 401, body: { status: 401, messages: { error: 'Invalid or missing API token.' } } });
    provider();
    const r = await request(app)
      .get('/api/v1/business/integrations/whatsapp/status')
      .set(auth(t))
      .expect(200);
    expect(r.body.data.connection).toBe('error');
    expect(r.body.data.error).toMatch(/Invalid or missing API token/);
  });

  it('sends one fixed test message from the tenant instance', async () => {
    const calls = stubAkNexus();
    provider();
    const r = await request(app)
      .post('/api/v1/business/integrations/whatsapp/test')
      .set(auth(t))
      .send({ to: '+91 90050 11088' })
      .expect(200);
    expect(r.body.data).toMatchObject({ sent: true, dryRun: false, to: '919005011088' });
    expect(calls[0]!.body).toMatchObject({ instance_id: INSTANCE, to: '919005011088' });
    expect(String(calls[0]!.body.message)).toMatch(/test message from Bizwoke Nova/);
    // Caller cannot inject message text.
    await request(app)
      .post('/api/v1/business/integrations/whatsapp/test')
      .set(auth(t))
      .send({ to: '919005011088', message: 'spam' })
      .expect(422);
  });

  it('maps provider failures to 502 and respects permissions and dry run', async () => {
    stubAkNexus({ status: 200, body: { status: 'error', message: 'Instance disconnected' } });
    provider();
    const fail = await request(app)
      .post('/api/v1/business/integrations/whatsapp/test')
      .set(auth(t))
      .send({ to: '919005011088' })
      .expect(502);
    expect(fail.body.error.message).toMatch(/Instance disconnected/);

    const op = await addMember(app, t, ['OPERATOR']);
    await request(app)
      .post('/api/v1/business/integrations/whatsapp/test')
      .set(auth(op))
      .send({ to: '919005011088' })
      .expect(403);
    await request(app).get('/api/v1/business/integrations/whatsapp/status').set(auth(op)).expect(403);

    process.env.WHATSAPP_DRY_RUN = 'true';
    resetEnvCache();
    try {
      const calls = stubAkNexus();
      const r = await request(app)
        .post('/api/v1/business/integrations/whatsapp/test')
        .set(auth(t))
        .send({ to: '919005011088' })
        .expect(200);
      expect(r.body.data).toMatchObject({ sent: false, dryRun: true });
      expect(calls).toHaveLength(0);
    } finally {
      process.env.WHATSAPP_DRY_RUN = 'false';
      resetEnvCache();
    }
  });

  it('rate limits test messages per business', async () => {
    stubAkNexus();
    provider();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await request(app)
            .post('/api/v1/business/integrations/whatsapp/test')
            .set(auth(t))
            .send({ to: '919005011088' })
        ).status,
      );
    }
    expect(statuses).toContain(429);
  });
});

describe('real AK Nexus payloads (captured live)', () => {
  it('parses message.received from a WhatsApp privacy id and ignores message.sent echoes', () => {
    const received = parseAkNexusWebhook({
      event: 'message.received',
      data: { from: '132491302195297@lid', message: 'Hi', source: 'whatsapp' },
      timestamp: 1793273641,
    });
    expect(received.messages).toEqual([expect.objectContaining({ from: '132491302195297@lid', text: 'Hi' })]);
    const echo = parseAkNexusWebhook({
      event: 'message.sent',
      data: { to: '132491302195297@c.us', type: 'text', message: 'Welcome…', source: 'api' },
    });
    expect(echo.messages).toEqual([]);
    // Normal numbers still become plain digits.
    expect(
      parseAkNexusWebhook({ event: 'message.received', data: { from: '919005011088@c.us', message: 'Hi' } })
        .messages[0]!.from,
    ).toBe('919005011088');
  });

  it('replies to the exact privacy id and reads the real message id from the response', async () => {
    const calls = stubAkNexus({
      status: 200,
      body: {
        status: 'success',
        data: {
          status: 'success',
          message: 'Message sent successfully',
          data: { key: { remoteJid: '132491302195297@lid', fromMe: true, id: '3EB09FDCEC65CDC08BFB90' } },
        },
      },
    });
    const p = new AkNexusWhatsAppProvider('wz_test', 'https://aknexus.example.test/api/v2');
    const r = await p.sendText({ phoneNumberId: INSTANCE, to: '132491302195297@lid', text: 'x' });
    expect(calls[0]!.body.to).toBe('132491302195297@lid');
    expect(r.providerMessageId).toBe('3EB09FDCEC65CDC08BFB90');
  });

  it('end to end: "Hi" from a privacy id gets the menu back at that same id', async () => {
    await TenantSettingsModel.updateOne(
      { tenantId: t.tenantId },
      { $set: { 'whatsappAssistant.mode': 'menu' } },
    );
    // Live payloads carry no instance id: routing falls back to AK_NEXUS_INSTANCE_ID.
    process.env.AK_NEXUS_INSTANCE_ID = INSTANCE;
    resetEnvCache();
    const calls = stubAkNexus();
    setWhatsAppProviderForTests(
      new AkNexusWhatsAppProvider('wz_test', 'https://aknexus.example.test/api/v2'),
    );
    await request(app)
      .post(`/api/v1/webhooks/aknexus/${SECRET}`)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          event: 'message.received',
          data: { from: '132491302195297@lid', message: 'Hi', source: 'whatsapp' },
          timestamp: 1793273999,
        }),
      )
      .expect(200);
    await drainInlineQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.to).toBe('132491302195297@lid');
    expect(String(calls[0]!.body.message)).toMatch(/1\. Book an appointment/);
  });
});
