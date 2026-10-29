import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  setupBookable,
  futureDate,
  at,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import {
  AkNexusWhatsAppProvider,
  setWhatsAppProviderForTests,
} from '../../infrastructure/messaging/whatsapp.provider';
import { AppointmentModel } from '../../modules/appointments/appointment.models';
import { NotificationModel } from '../../modules/notifications/notification.model';
import {
  ConversationMessageModel,
  ConversationSessionModel,
} from '../../modules/conversations/conversation.models';

const INSTANCE = '6ADC3724DD691';
const SECRET = process.env.AK_NEXUS_WEBHOOK_SECRET!;

let app: Express;
let t: TenantFixture;
let serviceId: string;
let sent: { to: string; message: string }[] = [];
let seq = 0;

function stubAkNexus() {
  sent = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const b = init?.body ? JSON.parse(String(init.body)) : {};
    sent.push({ to: b.to, message: b.message });
    return new Response(JSON.stringify({ status: 'success', data: { sent: true } }), { status: 200 });
  });
  setWhatsAppProviderForTests(new AkNexusWhatsAppProvider('wz_test', 'https://aknexus.example.test/api/v2'));
}

/** Simulates the customer sending `text` from `from`; returns the bot's replies to that message. */
async function say(from: string, text: string, pushName?: string): Promise<string[]> {
  const before = sent.length;
  await request(app)
    .post(`/api/v1/webhooks/aknexus/${SECRET}`)
    .set('Content-Type', 'application/json')
    .send(
      JSON.stringify({
        instance_id: INSTANCE,
        event: 'message',
        data: { from, message: text, id: `wamid-${++seq}`, pushName },
      }),
    )
    .expect(200);
  await drainInlineQueue();
  return sent
    .slice(before)
    .filter((m) => m.to === from)
    .map((m) => m.message);
}

beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app, { timezone: 'Asia/Kolkata' });
  ({ serviceId } = await setupBookable(app, t, { duration: 30 }));
  await request(app)
    .patch(`/api/v1/services/${serviceId}`)
    .set(auth(t))
    .send({ name: 'Haircut' })
    .expect(200);
  await request(app)
    .put('/api/v1/business/integrations/whatsapp')
    .set(auth(t))
    .send({ phoneNumberId: INSTANCE, enabled: true })
    .expect(200);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setWhatsAppProviderForTests(undefined);
});
afterAll(teardownTestApp);

describe('WhatsApp menu booking bot', () => {
  it('books an appointment from "hi" through numbered menus', async () => {
    stubAkNexus();
    const from = '919811100001';
    const [menu] = await say(from, 'hi', 'Asha');
    expect(menu).toMatch(/Welcome to Business/);
    expect(menu).toMatch(/1\. Book an appointment/);

    const [services] = await say(from, '1');
    expect(services).toMatch(/1\. Haircut \(30 min\)/);

    const [dates] = await say(from, '1');
    expect(dates).toMatch(/Choose a date:\n1\. /);

    const [times] = await say(from, '1');
    expect(times).toMatch(/Choose a time:\n1\. \d{1,2}:\d{2} (AM|PM)/);

    const [confirm] = await say(from, '1');
    expect(confirm).toMatch(/Please confirm your booking:[\s\S]*Haircut[\s\S]*Name: Asha/);

    const replies = await say(from, '1');
    const booked = replies.find((r) => r.startsWith('✅ Booked!'))!;
    const ref = /BK-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(booked)![0];
    const appt = await AppointmentModel.findOne({ tenantId: t.tenantId, reference: ref }).lean();
    expect(appt).toMatchObject({ source: 'WHATSAPP', status: 'CONFIRMED' });
    // The standard confirmation (business text) also goes to the customer on WhatsApp.
    expect(replies.some((r) => r.includes(ref) && r !== booked)).toBe(true);

    const session = await ConversationSessionModel.findOne({
      tenantId: t.tenantId,
      externalUserId: from,
    }).lean();
    expect(session!.linkedAppointmentIds.map(String)).toContain(String(appt!._id));
    expect(
      await ConversationMessageModel.countDocuments({ tenantId: t.tenantId, sessionId: session!._id }),
    ).toBeGreaterThanOrEqual(12);
  });

  it('asks for a name when unknown, re-prompts on invalid input, and 0 returns to the menu', async () => {
    stubAkNexus();
    const from = '919811100002';
    await say(from, 'hello');
    expect((await say(from, '7'))[0]).toMatch(/Book an appointment/); // invalid main choice -> menu again
    await say(from, '1');
    const [bad] = await say(from, '42');
    expect(bad).toBe('Please reply with one of the numbers from the list.');
    await say(from, '1'); // service
    await say(from, '1'); // date
    const [askName] = await say(from, '2'); // time
    expect(askName).toMatch(/What name/);
    expect((await say(from, '12'))[0]).toMatch(/type your name/);
    expect((await say(from, 'Ravi Kumar'))[0]).toMatch(/Name: Ravi Kumar/);
    expect((await say(from, '0'))[0]).toMatch(/Book an appointment/);
    expect(await AppointmentModel.countDocuments({ tenantId: t.tenantId, source: 'WHATSAPP' })).toBe(1);
  });

  it('lists upcoming appointments and hands off to the team', async () => {
    stubAkNexus();
    const from = '919811100001';
    await say(from, 'hi');
    expect((await say(from, '2'))[0]).toMatch(/Your upcoming appointments:\n• Haircut/);
    await say(from, '0');
    expect((await say(from, '3'))[0]).toMatch(/team will reply/);
    // While a person handles the chat, the bot stays silent.
    expect(await say(from, 'hi')).toEqual([]);
    const s = await ConversationSessionModel.findOne({ tenantId: t.tenantId, externalUserId: from }).lean();
    expect(s!.status).toBe('HANDOFF');
  });

  it('mode "off" stores messages for the team without replying', async () => {
    stubAkNexus();
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ whatsappAssistant: { mode: 'off' } })
      .expect(200);
    try {
      expect(await say('919811100003', 'hi')).toEqual([]);
      const s = await ConversationSessionModel.findOne({
        tenantId: t.tenantId,
        externalUserId: '919811100003',
      }).lean();
      expect(await ConversationMessageModel.countDocuments({ tenantId: t.tenantId, sessionId: s!._id })).toBe(
        1,
      );
    } finally {
      await request(app)
        .patch('/api/v1/business')
        .set(auth(t))
        .send({ whatsappAssistant: { mode: 'menu' } })
        .expect(200);
    }
  });

  it('uses a custom welcome text', async () => {
    stubAkNexus();
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ whatsappAssistant: { welcomeText: 'Namaste from Nktech Salon!' } })
      .expect(200);
    expect((await say('919811100004', 'hi'))[0]).toMatch(
      /^Namaste from Nktech Salon!\n\nReply with a number/,
    );
  });
});

describe('business-written messages and reminder timing', () => {
  it('sends the custom confirmation text with placeholders filled', async () => {
    stubAkNexus();
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({
        notifications: {
          reminderLeadMinutes: 120,
          texts: {
            appointment_confirmation:
              'Hi {name}! Your {service} with {staff} is booked for {date} at {time}. Ref {reference}. {unknown}',
          },
        },
      })
      .expect(200);
    const start = at(futureDate(6, 'Asia/Kolkata'), '10:30', 'Asia/Kolkata');
    const res = await request(app)
      .post(`/api/v1/public/${t.slug}/appointments`)
      .send({
        serviceId,
        startAt: start,
        customer: { name: 'Meera', phone: '+919811100005', consent: { whatsapp: true } },
      })
      .expect(201);
    await drainInlineQueue();
    const msg = sent.find((m) => m.to === '919811100005')!.message;
    expect(msg).toMatch(
      /^Hi Meera! Your Haircut with Staff Member is booked for \w{3} \d{1,2} \w{3} \d{4} at 10:30 AM\. Ref BK-/,
    );
    expect(msg).toContain(res.body.data.appointment.reference);
    expect(msg).toContain('{unknown}'); // only allowlisted placeholders are replaced

    const reminder = await NotificationModel.findOne({
      tenantId: t.tenantId,
      appointmentId: res.body.data.appointment.id,
      templateKey: 'appointment_reminder',
      channel: 'WHATSAPP',
    }).lean();
    expect(reminder!.scheduledFor.getTime()).toBe(new Date(start).getTime() - 120 * 60_000);
  });

  it('reminderLeadMinutes 0 disables reminders; empty text restores the default', async () => {
    stubAkNexus();
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ notifications: { reminderLeadMinutes: 0, texts: { appointment_confirmation: '' } } })
      .expect(200);
    const res = await request(app)
      .post(`/api/v1/public/${t.slug}/appointments`)
      .send({
        serviceId,
        startAt: at(futureDate(7, 'Asia/Kolkata'), '11:00', 'Asia/Kolkata'),
        customer: { name: 'Neel', phone: '+919811100006', consent: { whatsapp: true } },
      })
      .expect(201);
    await drainInlineQueue();
    expect(sent.find((m) => m.to === '919811100006')!.message).toMatch(
      /^Hi Neel, your Haircut appointment with .* is confirmed for/,
    );
    expect(
      await NotificationModel.countDocuments({
        tenantId: t.tenantId,
        appointmentId: res.body.data.appointment.id,
        templateKey: 'appointment_reminder',
      }),
    ).toBe(0);
    await request(app)
      .patch('/api/v1/business')
      .set(auth(t))
      .send({ notifications: { reminderLeadMinutes: 10_081 } })
      .expect(422);
  });
});
