import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { getAvailableSlots, loadSettings, type Slot } from '../availability/availability.service';
import { createAppointment } from '../appointments/appointment.service';
import { AppointmentModel, ACTIVE_STATUSES, type AppointmentDoc } from '../appointments/appointment.models';
import { ServiceModel, type ServiceDoc } from '../services/service.model';
import { CustomerModel, type CustomerDoc } from '../customers/customer.models';
import { ConversationSessionModel, type ConversationSessionDoc } from '../conversations/conversation.models';
import { requestHandoff } from '../conversations/handoff';
import { contactAddress } from './address';

/**
 * Deterministic WhatsApp booking menu: "hi" -> numbered menus -> booked appointment.
 * No AI involved: every option shown comes from real services and real free slots, and the booking
 * goes through the same transactional engine as the website (availability re-checked at commit).
 * Replies are numbered text so they work on every WhatsApp connection; menu ids equal the numbers,
 * so interactive list/button replies that carry the number are understood too.
 */

const SESSION_TIMEOUT_MS = 30 * 60_000;
const MAX_DATES = 7;
const MAX_TIMES = 12;
const DATE_SEARCH_DAYS = 21;
const RESET_WORDS = /^(0|hi+|hello|hey|hii+|menu|start|namaste|hlo|helo)$/i;
const BOOK_WORDS = /^(book|booking|appointment)$/i;

type Step = 'MAIN' | 'SERVICE' | 'DATE' | 'TIME' | 'NAME' | 'CONFIRM';

interface BotData {
  serviceIds?: string[];
  serviceId?: string;
  dates?: string[];
  date?: string;
  times?: { startAt: string; staffId: string }[];
  startAt?: string;
  staffId?: string;
  name?: string;
}

export interface BotInput {
  tenant: TenantContext;
  session: ConversationSessionDoc;
  text: string;
  /** Sender id from the provider: phone digits or a WhatsApp privacy id ("...@lid"). */
  phoneDigits: string;
  contactName?: string;
  messageId: string;
}

const sessions = (tenantId: Types.ObjectId) =>
  new TenantRepository<ConversationSessionDoc>(ConversationSessionModel, tenantId);

async function save(tenantId: Types.ObjectId, sessionId: Types.ObjectId, step: Step, data: BotData) {
  await sessions(tenantId).updateOne(
    { _id: sessionId },
    { $set: { bot: { step, data, updatedAt: new Date() } } },
  );
}

const numbered = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join('\n');
const pick = (text: string, max: number): number | null => {
  const m = /^\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n - 1 : null;
};

async function mainMenu(input: BotInput): Promise<string[]> {
  const settings = await loadSettings(input.tenant.tenantId);
  const business = settings.profile.displayName;
  const welcome =
    settings.whatsappAssistant?.welcomeText?.trim() ||
    `Welcome to ${business}! 👋 How can we help you today?`;
  await save(input.tenant.tenantId, input.session._id, 'MAIN', {});
  return [
    `${welcome}\n\nReply with a number:\n${numbered(['Book an appointment', 'My upcoming appointments', 'Talk to our team'])}`,
  ];
}

async function serviceMenu(input: BotInput): Promise<string[]> {
  const services = await new TenantRepository<ServiceDoc>(ServiceModel, input.tenant.tenantId).find(
    { status: 'ACTIVE', publiclyBookable: true },
    { sort: { name: 1 }, limit: 9 },
  );
  if (services.length === 0) {
    await save(input.tenant.tenantId, input.session._id, 'MAIN', {});
    return ['Sorry, online booking is not available right now. Reply 3 to talk to our team.'];
  }
  await save(input.tenant.tenantId, input.session._id, 'SERVICE', {
    serviceIds: services.map((s) => s._id.toString()),
  });
  const lines = services.map(
    (s) =>
      `${s.name} (${s.durationMinutes} min${s.price !== undefined ? `, ${s.currency ?? ''} ${s.price}`.trimEnd() : ''})`,
  );
  return [`Which service would you like?\n${numbered(lines)}\n\nReply 0 for the main menu.`];
}

async function dateMenu(input: BotInput, data: BotData): Promise<string[]> {
  const settings = await loadSettings(input.tenant.tenantId);
  const zone = settings.timezone;
  const from = DateTime.now().setZone(zone).toISODate()!;
  const to = DateTime.now()
    .setZone(zone)
    .plus({ days: DATE_SEARCH_DAYS - 1 })
    .toISODate()!;
  const slots = await getAvailableSlots(input.tenant, {
    serviceId: data.serviceId!,
    from,
    to,
    publicOnly: true,
  });
  const dates = [...new Set(slots.map((s) => DateTime.fromISO(s.startAt).setZone(zone).toISODate()!))].slice(
    0,
    MAX_DATES,
  );
  if (dates.length === 0) {
    await save(input.tenant.tenantId, input.session._id, 'MAIN', {});
    return [
      'Sorry, there are no free slots for this service in the next few weeks. Reply 3 to talk to our team or 0 for the menu.',
    ];
  }
  await save(input.tenant.tenantId, input.session._id, 'DATE', { ...data, dates });
  const labels = dates.map((d) =>
    DateTime.fromISO(d, { zone }).setLocale(settings.locale).toFormat('ccc, d LLL'),
  );
  return [`Choose a date:\n${numbered(labels)}\n\nReply 0 for the main menu.`];
}

async function timeMenu(input: BotInput, data: BotData, prefix = ''): Promise<string[]> {
  const settings = await loadSettings(input.tenant.tenantId);
  const slots: Slot[] = await getAvailableSlots(input.tenant, {
    serviceId: data.serviceId!,
    from: data.date!,
    publicOnly: true,
  });
  const unique = new Map<string, Slot>();
  for (const s of slots) if (!unique.has(s.startAt)) unique.set(s.startAt, s);
  const times = [...unique.values()]
    .slice(0, MAX_TIMES)
    .map((s) => ({ startAt: s.startAt, staffId: s.staffId }));
  if (times.length === 0) return dateMenu(input, data);
  await save(input.tenant.tenantId, input.session._id, 'TIME', { ...data, times });
  const labels = times.map((t) => DateTime.fromISO(t.startAt).setZone(settings.timezone).toFormat('h:mm a'));
  return [`${prefix}Choose a time:\n${numbered(labels)}\n\nReply 0 for the main menu.`];
}

async function knownName(input: BotInput): Promise<string | undefined> {
  const customer = await new TenantRepository<CustomerDoc>(CustomerModel, input.tenant.tenantId).findOne({
    phoneNormalized: normalizePhone(contactAddress(input.phoneDigits)),
    status: 'ACTIVE',
  });
  // Existing customer record first, then the WhatsApp profile name (this message or earlier in the chat).
  const name = customer?.name ?? input.contactName ?? input.session.contactName;
  return name && name.trim().length >= 2 ? name.trim().slice(0, 120) : undefined;
}

async function confirmPrompt(input: BotInput, data: BotData): Promise<string[]> {
  const settings = await loadSettings(input.tenant.tenantId);
  const service = await new TenantRepository<ServiceDoc>(ServiceModel, input.tenant.tenantId).findById(
    data.serviceId!,
  );
  const when = DateTime.fromISO(data.startAt!)
    .setZone(settings.timezone)
    .setLocale(settings.locale)
    .toFormat('ccc d LLL, h:mm a');
  await save(input.tenant.tenantId, input.session._id, 'CONFIRM', data);
  return [
    `Please confirm your booking:\n\n${service?.name ?? 'Service'}\n${when}\nName: ${data.name}\n\n1. Confirm\n2. Cancel`,
  ];
}

async function book(input: BotInput, data: BotData): Promise<string[]> {
  const tenantId = input.tenant.tenantId;
  const phone = contactAddress(input.phoneDigits);
  // The customer started this chat, so transactional WhatsApp messages (confirmation, reminder) are allowed.
  await new TenantRepository(CustomerModel, tenantId).updateMany(
    { phoneNormalized: normalizePhone(phone) },
    { $set: { 'consent.whatsapp': true, 'consent.updatedAt': new Date() } },
  );
  try {
    const { appointment } = await createAppointment(
      { ...input.tenant, actor: { type: 'system' } },
      {
        serviceId: data.serviceId!,
        staffId: data.staffId,
        startAt: new Date(data.startAt!),
        customer: { name: data.name!, phone, consent: { whatsapp: true } },
      },
      {
        source: 'WHATSAPP',
        idempotencyKey: `wa-bot-${input.session._id}-${data.startAt!.replace(/\D/g, '')}`.slice(0, 128),
        enforcePolicy: true,
        publicOnly: true,
      },
    );
    await sessions(tenantId).updateOne(
      { _id: input.session._id },
      {
        $set: { bot: { step: 'MAIN', data: {}, updatedAt: new Date() } },
        $addToSet: { linkedAppointmentIds: appointment._id },
      },
    );
    // The confirmation itself is sent by the notification system (business's own confirmation text).
    return [
      `✅ Booked! Your reference is ${appointment.reference}. You'll receive a confirmation shortly.\n\nReply 0 for the main menu.`,
    ];
  } catch (err) {
    if (err instanceof AppError && err.code === 'SLOT_UNAVAILABLE') {
      return timeMenu(
        input,
        { ...data, startAt: undefined, staffId: undefined },
        'Sorry, that time was just taken. ',
      );
    }
    if (err instanceof AppError && err.code === 'QUOTA_EXCEEDED') {
      await save(tenantId, input.session._id, 'MAIN', {});
      return ['Sorry, we cannot take more online bookings right now. Reply 3 to talk to our team.'];
    }
    throw err;
  }
}

async function myAppointments(input: BotInput): Promise<string[]> {
  const tenantId = input.tenant.tenantId;
  const settings = await loadSettings(tenantId);
  const customers = await new TenantRepository<CustomerDoc>(CustomerModel, tenantId).find(
    { phoneNormalized: normalizePhone(contactAddress(input.phoneDigits)) },
    { projection: { _id: 1 } },
  );
  const appts = await new TenantRepository<AppointmentDoc>(AppointmentModel, tenantId).find(
    {
      customerId: { $in: customers.map((c) => c._id) },
      status: { $in: ACTIVE_STATUSES },
      startAt: { $gte: new Date() },
    },
    { sort: { startAt: 1 }, limit: 5 },
  );
  await save(tenantId, input.session._id, 'MAIN', {});
  if (appts.length === 0)
    return ['You have no upcoming appointments.\n\nReply 1 to book one, or 0 for the main menu.'];
  const services = await new TenantRepository<ServiceDoc>(ServiceModel, tenantId).find({
    _id: { $in: appts.map((a) => a.serviceId) },
  });
  const lines = appts.map((a) => {
    const name = services.find((s) => s._id.equals(a.serviceId))?.name ?? 'Appointment';
    const when = DateTime.fromJSDate(a.startAt).setZone(settings.timezone).toFormat('ccc d LLL, h:mm a');
    return `• ${name}, ${when} (${a.reference})`;
  });
  return [
    `Your upcoming appointments:\n${lines.join('\n')}\n\nTo change one, reply 3 to talk to our team. Reply 0 for the main menu.`,
  ];
}

async function handoff(input: BotInput): Promise<string[]> {
  const settings = await loadSettings(input.tenant.tenantId);
  await save(input.tenant.tenantId, input.session._id, 'MAIN', {});
  await requestHandoff(
    input.tenant.tenantId,
    input.session._id,
    'Customer asked for a person (WhatsApp menu)',
  );
  return [settings.ai?.handoffMessage || 'Thanks! A member of our team will reply to you here shortly.'];
}

/** Returns the reply texts for one inbound message and advances the stored state. */
export async function handleMenuMessage(input: BotInput): Promise<string[]> {
  const text = input.text.trim();
  const state = input.session.bot;
  const expired = !state?.updatedAt || Date.now() - new Date(state.updatedAt).getTime() > SESSION_TIMEOUT_MS;
  const step: Step = expired ? 'MAIN' : ((state?.step as Step) ?? 'MAIN');
  const data = (expired ? {} : (state?.data ?? {})) as BotData;
  const again = (msg: string[]) => ['Please reply with one of the numbers from the list.', ...msg];

  if (BOOK_WORDS.test(text)) return serviceMenu(input);
  if (RESET_WORDS.test(text)) return mainMenu(input);
  // New or stale conversation: show the menu, unless the text is already a main-menu choice (1-3).
  if (expired && pick(text, 3) === null) return mainMenu(input);

  switch (step) {
    case 'MAIN': {
      const n = pick(text, 3);
      if (n === 0) return serviceMenu(input);
      if (n === 1) return myAppointments(input);
      if (n === 2) return handoff(input);
      return mainMenu(input);
    }
    case 'SERVICE': {
      const n = pick(text, data.serviceIds?.length ?? 0);
      if (n === null) return again(await serviceMenu(input));
      return dateMenu(input, { serviceId: data.serviceIds![n] });
    }
    case 'DATE': {
      const n = pick(text, data.dates?.length ?? 0);
      if (n === null) return again(await dateMenu(input, data));
      return timeMenu(input, { ...data, date: data.dates![n] });
    }
    case 'TIME': {
      const n = pick(text, data.times?.length ?? 0);
      if (n === null) return again(await timeMenu(input, data));
      const chosen = { ...data, startAt: data.times![n]!.startAt, staffId: data.times![n]!.staffId };
      const name = await knownName(input);
      if (!name) {
        await save(input.tenant.tenantId, input.session._id, 'NAME', chosen);
        return ['Great choice! What name should we put on the booking?'];
      }
      return confirmPrompt(input, { ...chosen, name });
    }
    case 'NAME': {
      if (text.length < 2 || text.length > 80 || /^\d+$/.test(text))
        return ['Please type your name (for example: Ravi Kumar).'];
      return confirmPrompt(input, { ...data, name: text });
    }
    case 'CONFIRM': {
      const n = pick(text, 2);
      if (n === 0) return book(input, data);
      if (n === 1) return mainMenu(input);
      return again(await confirmPrompt(input, data));
    }
  }
}
