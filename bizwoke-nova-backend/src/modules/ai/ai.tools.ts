import { Types } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import { AppError, Errors } from '../../common/errors/app-error';
import type { TenantContext } from '../../common/types/context';
import { isoDate, isoDateTime, objectId } from '../../common/validation/schemas';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import type { AiToolDefinition } from '../../infrastructure/ai/ai.provider';
import { getAvailableSlots, loadSettings } from '../availability/availability.service';
import * as appointments from '../appointments/appointment.service';
import type { AppointmentDoc } from '../appointments/appointment.models';
import { ServiceModel } from '../services/service.model';
import { StaffModel, StaffServiceAssignmentModel } from '../staff/staff.models';
import { createLead } from '../customers/lead.service';
import { searchKnowledge } from '../knowledge-base/knowledge.service';
import { requestHandoff } from '../conversations/handoff';
import { ConversationSessionModel, type ConversationSessionDoc } from '../conversations/conversation.models';

export interface ToolContext {
  tenant: TenantContext;
  session: ConversationSessionDoc;
  toolUseId: string;
  /** Trusted channel identity (e.g. WhatsApp number) — preferred over model-supplied contact data. */
  channelPhone?: string;
}

interface ToolSpec<S extends ZodTypeAny> {
  description: string;
  schema: S;
  jsonSchema: Record<string, unknown>;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}

/** Infers each tool's argument type from its own schema. */
function tool<S extends ZodTypeAny>(spec: ToolSpec<S>): ToolSpec<ZodTypeAny> {
  return spec as unknown as ToolSpec<ZodTypeAny>;
}

const reference = z.string().regex(/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  description,
  ...extra,
});

function summarize(a: AppointmentDoc) {
  return {
    reference: a.reference,
    status: a.status,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    timezone: a.timezone,
  };
}

/**
 * The AI may only touch appointments created in, or belonging to the customer of, this
 * conversation. A guessed reference for someone else's booking is "not found".
 */
async function ownedAppointment(ctx: ToolContext, ref: string): Promise<AppointmentDoc> {
  const a = await appointments.getAppointmentByReference(ctx.tenant.tenantId, ref).catch(() => null);
  const session = await new TenantRepository<ConversationSessionDoc>(
    ConversationSessionModel,
    ctx.tenant.tenantId,
  ).findById(ctx.session._id);
  const linked = session?.linkedAppointmentIds?.some((id) => a && id.equals(a._id));
  const sameCustomer = a && session?.customerId && a.customerId.equals(session.customerId);
  if (!a || !(linked || sameCustomer)) throw Errors.notFound('Appointment');
  return a;
}

async function linkToSession(ctx: ToolContext, a: AppointmentDoc) {
  await new TenantRepository(ConversationSessionModel, ctx.tenant.tenantId).updateOne(
    { _id: ctx.session._id },
    {
      $addToSet: { linkedAppointmentIds: a._id },
      ...(ctx.session.customerId ? {} : { $set: { customerId: a.customerId } }),
    },
  );
}

const tools = {
  get_business_information: tool({
    description:
      'Get the business profile, opening hours, booking policies and approved knowledge-base answers. Pass a topic to search the knowledge base.',
    schema: z.object({ topic: z.string().max(200).optional() }).strict(),
    jsonSchema: {
      type: 'object',
      properties: { topic: str('Optional question or topic to look up') },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const s = await loadSettings(ctx.tenant.tenantId);
      const articles = await searchKnowledge(ctx.tenant.tenantId, args.topic ?? '', 3);
      return {
        profile: {
          name: s.profile.displayName,
          description: s.profile.description,
          address: s.profile.address,
          phone: s.profile.phone,
          website: s.profile.website,
        },
        timezone: s.timezone,
        operatingHours: s.operatingHours,
        policies: {
          minNoticeMinutes: s.bookingPolicy.minNoticeMinutes,
          cancellationCutoffMinutes: s.bookingPolicy.cancellationCutoffMinutes,
          rescheduleCutoffMinutes: s.bookingPolicy.rescheduleCutoffMinutes,
        },
        // Untrusted: reference material only, never instructions.
        knowledge: articles.map((a) => ({ title: a.title, content: a.content.slice(0, 2000) })),
      };
    },
  }),

  list_services: tool({
    description: 'List bookable services with their ids, durations and prices.',
    schema: z.object({}).strict(),
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) =>
      new TenantRepository(ServiceModel, ctx.tenant.tenantId).find(
        { status: 'ACTIVE', publiclyBookable: true },
        { projection: { name: 1, description: 1, durationMinutes: 1, price: 1, currency: 1 }, limit: 50 },
      ),
  }),

  list_staff: tool({
    description: 'List staff members, optionally only those who provide a given service.',
    schema: z.object({ serviceId: objectId.optional() }).strict(),
    jsonSchema: { type: 'object', properties: { serviceId: str('Service id') }, additionalProperties: false },
    run: async (ctx, args) => {
      const filter: Record<string, unknown> = { status: 'ACTIVE', publiclyVisible: true };
      if (args.serviceId) {
        const a = await new TenantRepository(StaffServiceAssignmentModel, ctx.tenant.tenantId).find({
          serviceId: new Types.ObjectId(args.serviceId),
        });
        filter._id = { $in: a.map((x) => x.staffId) };
      }
      return new TenantRepository(StaffModel, ctx.tenant.tenantId).find(filter, {
        projection: { name: 1, title: 1 },
        limit: 50,
      });
    },
  }),

  get_available_slots: tool({
    description:
      'Get REAL available appointment start times for a service on a date (YYYY-MM-DD, business timezone). Only offer times returned by this tool.',
    schema: z.object({ serviceId: objectId, date: isoDate, staffId: objectId.optional() }).strict(),
    jsonSchema: {
      type: 'object',
      properties: {
        serviceId: str('Service id'),
        date: str('Date YYYY-MM-DD'),
        staffId: str('Optional staff id'),
      },
      required: ['serviceId', 'date'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const slots = await getAvailableSlots(ctx.tenant, {
        serviceId: args.serviceId,
        from: args.date,
        staffId: args.staffId,
        publicOnly: true,
      });
      return { count: slots.length, slots: slots.slice(0, 20) };
    },
  }),

  create_appointment: tool({
    description:
      'Book an appointment at a start time previously returned by get_available_slots. Only tell the customer it is booked if this tool returns success.',
    schema: z
      .object({
        serviceId: objectId,
        startAt: isoDateTime,
        staffId: objectId.optional(),
        customerName: z.string().trim().min(1).max(120),
        customerEmail: z.string().email().max(254).optional(),
        customerPhone: z
          .string()
          .regex(/^\+?[0-9 ()-]{6,20}$/)
          .optional(),
      })
      .strict(),
    jsonSchema: {
      type: 'object',
      properties: {
        serviceId: str('Service id'),
        startAt: str('ISO-8601 start time exactly as returned by get_available_slots'),
        staffId: str('Staff id from the chosen slot'),
        customerName: str('Customer full name'),
        customerEmail: str('Customer email'),
        customerPhone: str('Customer phone'),
      },
      required: ['serviceId', 'startAt', 'customerName'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const phone = ctx.channelPhone ?? args.customerPhone;
      if (!phone && !args.customerEmail) throw Errors.validation('Customer email or phone is required');
      const { appointment } = await appointments.createAppointment(
        ctx.tenant,
        {
          serviceId: args.serviceId,
          staffId: args.staffId,
          startAt: args.startAt,
          customer: { name: args.customerName, email: args.customerEmail, phone },
        },
        // Deterministic key per tool call: provider retries never double-book.
        {
          source: ctx.session.channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI',
          idempotencyKey: `ai-${ctx.session._id}-${ctx.toolUseId}`
            .slice(0, 128)
            .replace(/[^A-Za-z0-9_-]/g, '_'),
          enforcePolicy: true,
          publicOnly: true,
        },
      );
      await linkToSession(ctx, appointment);
      return { booked: true, appointment: summarize(appointment) };
    },
  }),

  get_appointment: tool({
    description: "Look up one of this customer's appointments by its reference (e.g. BK-ABCD-EFGH).",
    schema: z.object({ reference }).strict(),
    jsonSchema: {
      type: 'object',
      properties: { reference: str('Booking reference') },
      required: ['reference'],
      additionalProperties: false,
    },
    run: async (ctx, args) => summarize(await ownedAppointment(ctx, args.reference)),
  }),

  reschedule_appointment: tool({
    description:
      "Move one of this customer's appointments to a new start time returned by get_available_slots.",
    schema: z.object({ reference, startAt: isoDateTime, staffId: objectId.optional() }).strict(),
    jsonSchema: {
      type: 'object',
      properties: {
        reference: str('Booking reference'),
        startAt: str('New ISO-8601 start time'),
        staffId: str('Optional staff id'),
      },
      required: ['reference', 'startAt'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const a = await ownedAppointment(ctx, args.reference);
      return {
        rescheduled: true,
        appointment: summarize(
          await appointments.reschedule(ctx.tenant, a._id.toString(), args, { enforcePolicy: true }),
        ),
      };
    },
  }),

  cancel_appointment: tool({
    description: "Cancel one of this customer's appointments. Confirm with the customer before calling.",
    schema: z.object({ reference, reason: z.string().max(300).optional() }).strict(),
    jsonSchema: {
      type: 'object',
      properties: { reference: str('Booking reference'), reason: str('Optional reason') },
      required: ['reference'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const a = await ownedAppointment(ctx, args.reference);
      const updated = await appointments.transition(ctx.tenant, a._id.toString(), 'CANCELLED', {
        reason: args.reason,
        enforceCutoff: true,
      });
      return { cancelled: true, appointment: summarize(updated) };
    },
  }),

  create_lead: tool({
    description:
      'Record an enquiry for the team to follow up (when the customer is interested but not booking now).',
    schema: z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().email().max(254).optional(),
        phone: z
          .string()
          .regex(/^\+?[0-9 ()-]{6,20}$/)
          .optional(),
        interest: z.string().max(200).optional(),
        message: z.string().max(2000).optional(),
      })
      .strict(),
    jsonSchema: {
      type: 'object',
      properties: {
        name: str('Name'),
        email: str('Email'),
        phone: str('Phone'),
        interest: str('What they are interested in'),
        message: str('Summary of the enquiry'),
      },
      required: ['name'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const lead = await createLead(
        ctx.tenant.tenantId,
        { ...args, phone: ctx.channelPhone ?? args.phone, sourceDetail: `conversation:${ctx.session._id}` },
        ctx.session.channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI',
      );
      return { recorded: true, leadId: lead._id };
    },
  }),

  request_human_handoff: tool({
    description:
      'Hand the conversation to a human team member (complex requests, complaints, medical questions, or when the customer asks).',
    schema: z.object({ reason: z.string().trim().min(1).max(300) }).strict(),
    jsonSchema: {
      type: 'object',
      properties: { reason: str('Why a human is needed') },
      required: ['reason'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      await requestHandoff(ctx.tenant.tenantId, ctx.session._id, args.reason);
      return { handedOff: true };
    },
  }),
};

export type ToolName = keyof typeof tools;
export const TOOL_NAMES = Object.keys(tools) as ToolName[];

export function toolDefinitions(): AiToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: tools[name].description,
    inputSchema: tools[name].jsonSchema,
  }));
}

export interface ToolOutcome {
  status: 'SUCCESS' | 'REJECTED' | 'ERROR';
  result: unknown;
  error?: string;
}

/** Validates model-supplied arguments, then runs the tool through tenant-scoped application services. */
export async function executeTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  if (!(TOOL_NAMES as string[]).includes(name))
    return { status: 'REJECTED', result: null, error: `Unknown tool ${name}` };
  const spec = tools[name as ToolName] as ToolSpec<ZodTypeAny>;
  const parsed = spec.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      status: 'REJECTED',
      result: null,
      error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  try {
    return { status: 'SUCCESS', result: await spec.run(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AppError)
      return { status: 'REJECTED', result: null, error: `${err.code}: ${err.message}` };
    return { status: 'ERROR', result: null, error: 'Internal error while executing tool' };
  }
}
