import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export const WORKFLOW_TRIGGERS = [
  'appointment.created',
  'appointment.status_changed',
  'appointment.rescheduled',
  'lead.created',
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export interface WorkflowAction {
  type: 'send_notification';
  channel: 'EMAIL' | 'WHATSAPP';
  /** 'customer' = the appointment's/lead's contact; otherwise a fixed tenant-owned email. */
  recipient: 'customer' | 'fixed';
  fixedTo?: string;
  subject?: string;
  text: string;
  /** Delay after the event, or relative to appointment start when `relativeTo` = 'appointment_start'. */
  offsetMinutes: number;
  relativeTo: 'event' | 'appointment_start';
}

export interface AutomationWorkflowDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  trigger: WorkflowTrigger;
  conditions: { toStatus?: string };
  actions: WorkflowAction[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const actionSchema = new Schema<WorkflowAction>(
  {
    type: { type: String, enum: ['send_notification'], required: true },
    channel: { type: String, enum: ['EMAIL', 'WHATSAPP'], required: true },
    recipient: { type: String, enum: ['customer', 'fixed'], required: true },
    fixedTo: { type: String, maxlength: 254 },
    subject: { type: String, maxlength: 200 },
    text: { type: String, required: true, maxlength: 2000 },
    offsetMinutes: { type: Number, default: 0, min: -43_200, max: 43_200 },
    relativeTo: { type: String, enum: ['event', 'appointment_start'], default: 'event' },
  },
  { _id: false },
);

const wfSchema = tenantSchema<AutomationWorkflowDoc>({
  name: { type: String, required: true, maxlength: 120 },
  trigger: { type: String, enum: WORKFLOW_TRIGGERS, required: true },
  conditions: { toStatus: String },
  actions: { type: [actionSchema], validate: (v: unknown[]) => v.length >= 1 && v.length <= 10 },
  enabled: { type: Boolean, default: true },
});
wfSchema.index({ tenantId: 1, trigger: 1, enabled: 1 });

export const AutomationWorkflowModel = model<AutomationWorkflowDoc>(
  'AutomationWorkflow',
  wfSchema,
  'automationWorkflows',
);

export interface WorkflowExecutionDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  workflowId: Types.ObjectId;
  eventKey: string;
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  actionsQueued: number;
  error?: string;
  createdAt: Date;
}

const execSchema = tenantSchema<WorkflowExecutionDoc>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: 'AutomationWorkflow', required: true },
    eventKey: { type: String, required: true, maxlength: 200 },
    status: { type: String, enum: ['COMPLETED', 'SKIPPED', 'FAILED'], required: true },
    actionsQueued: { type: Number, default: 0 },
    error: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// Idempotency: a workflow runs at most once per triggering event.
execSchema.index({ tenantId: 1, workflowId: 1, eventKey: 1 }, { unique: true });

export const WorkflowExecutionModel = model<WorkflowExecutionDoc>(
  'WorkflowExecution',
  execSchema,
  'workflowExecutions',
);
