import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export interface ConversationSessionDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  channel: 'API' | 'WHATSAPP';
  status: 'OPEN' | 'HANDOFF' | 'CLOSED';
  customerId?: Types.ObjectId;
  /** Channel identity, e.g. WhatsApp wa_id. Unique per tenant+channel for open sessions. */
  externalUserId?: string;
  contactName?: string;
  turnCount: number;
  handoff?: { reason: string; at: Date; assignedMembershipId?: Types.ObjectId };
  lastMessageAt: Date;
  /** Bound to a single appointment the AI created/looked up, so later tool calls stay within it. */
  linkedAppointmentIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = tenantSchema<ConversationSessionDoc>({
  channel: { type: String, enum: ['API', 'WHATSAPP'], required: true },
  status: { type: String, enum: ['OPEN', 'HANDOFF', 'CLOSED'], default: 'OPEN' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  externalUserId: { type: String, maxlength: 64 },
  contactName: { type: String, maxlength: 120 },
  turnCount: { type: Number, default: 0 },
  handoff: { reason: String, at: Date, assignedMembershipId: Schema.Types.ObjectId },
  lastMessageAt: { type: Date, default: () => new Date() },
  linkedAppointmentIds: { type: [Schema.Types.ObjectId], default: [] },
});
sessionSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
sessionSchema.index(
  { tenantId: 1, channel: 1, externalUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['OPEN', 'HANDOFF'] }, externalUserId: { $type: 'string' } },
  },
);

export const ConversationSessionModel = model<ConversationSessionDoc>(
  'ConversationSession',
  sessionSchema,
  'conversationSessions',
);

export interface ConversationMessageDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  sessionId: Types.ObjectId;
  role: 'user' | 'assistant' | 'agent' | 'system';
  text: string;
  /** Structured provider content (tool calls/results) needed to replay context. */
  content?: unknown[];
  externalMessageId?: string;
  deliveryStatus?: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  authorUserId?: Types.ObjectId;
  createdAt: Date;
}

const messageSchema = tenantSchema<ConversationMessageDoc>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'ConversationSession', required: true },
    role: { type: String, enum: ['user', 'assistant', 'agent', 'system'], required: true },
    text: { type: String, maxlength: 8000, default: '' },
    content: { type: [Schema.Types.Mixed], default: undefined },
    externalMessageId: { type: String, maxlength: 128 },
    deliveryStatus: { type: String, enum: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'] },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ tenantId: 1, sessionId: 1, createdAt: 1 });
messageSchema.index(
  { tenantId: 1, externalMessageId: 1 },
  { unique: true, partialFilterExpression: { externalMessageId: { $type: 'string' } } },
);

export const ConversationMessageModel = model<ConversationMessageDoc>(
  'ConversationMessage',
  messageSchema,
  'conversationMessages',
);

export interface AiToolExecutionDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  sessionId: Types.ObjectId;
  toolName: string;
  input: Record<string, unknown>;
  status: 'SUCCESS' | 'REJECTED' | 'ERROR';
  resultSummary?: string;
  error?: string;
  durationMs: number;
  createdAt: Date;
}

const toolSchema = tenantSchema<AiToolExecutionDoc>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'ConversationSession', required: true },
    toolName: { type: String, required: true },
    input: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['SUCCESS', 'REJECTED', 'ERROR'], required: true },
    resultSummary: { type: String, maxlength: 2000 },
    error: { type: String, maxlength: 500 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
toolSchema.index({ tenantId: 1, sessionId: 1, createdAt: 1 });
toolSchema.index({ tenantId: 1, toolName: 1, createdAt: -1 });

export const AiToolExecutionModel = model<AiToolExecutionDoc>(
  'AiToolExecution',
  toolSchema,
  'aiToolExecutions',
);
