import { Types } from 'mongoose';
import { events } from '../../common/utils/events';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { assertTenantJob, getQueue, registerJobHandler } from '../../infrastructure/queue/queue';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.models';
import { CustomerModel, LeadModel, type CustomerDoc, type LeadDoc } from '../customers/customer.models';
import { TenantSettingsModel } from '../business-config/tenant-settings.model';
import { queueNotification } from '../notifications/notification.service';
import {
  AutomationWorkflowModel,
  WorkflowExecutionModel,
  type AutomationWorkflowDoc,
  type WorkflowTrigger,
} from './workflow.models';

interface WorkflowJob {
  tenantId: string;
  trigger: WorkflowTrigger;
  entityId: string;
  eventKey: string;
  toStatus?: string;
}

/** Fills {{placeholders}} from an allowlisted variable map only. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
}

export async function runWorkflows(job: WorkflowJob): Promise<number> {
  const tenantId = new Types.ObjectId(job.tenantId);
  const settings = await new TenantRepository(TenantSettingsModel, tenantId).findOne({});
  if (!settings?.features.workflows) return 0;

  const workflows = await new TenantRepository<AutomationWorkflowDoc>(AutomationWorkflowModel, tenantId).find(
    { trigger: job.trigger, enabled: true },
  );
  if (!workflows.length) return 0;

  let appt: AppointmentDoc | null = null;
  let contact:
    | (Pick<CustomerDoc, 'name' | 'email' | 'phone'> & {
        consent?: CustomerDoc['consent'];
        _id?: Types.ObjectId;
      })
    | null = null;
  if (job.trigger.startsWith('appointment.')) {
    appt = await new TenantRepository<AppointmentDoc>(AppointmentModel, tenantId).findById(job.entityId);
    if (appt)
      contact = await new TenantRepository<CustomerDoc>(CustomerModel, tenantId).findById(appt.customerId);
  } else {
    const lead = await new TenantRepository<LeadDoc>(LeadModel, tenantId).findById(job.entityId);
    if (lead) contact = { name: lead.name, email: lead.email, phone: lead.phone };
  }
  if (!contact) return 0;

  const vars: Record<string, string> = {
    customerName: contact.name,
    businessName: settings.profile.displayName,
    reference: appt?.reference ?? '',
    startAt: appt?.startAt.toISOString() ?? '',
  };

  let queued = 0;
  for (const wf of workflows) {
    if (wf.conditions?.toStatus && wf.conditions.toStatus !== job.toStatus) continue;
    try {
      await new TenantRepository(WorkflowExecutionModel, tenantId).create({
        workflowId: wf._id,
        eventKey: job.eventKey,
        status: 'COMPLETED',
        actionsQueued: 0,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) continue; // already executed for this event
      throw err;
    }
    let count = 0;
    for (const [i, action] of wf.actions.entries()) {
      const base = action.relativeTo === 'appointment_start' && appt ? appt.startAt.getTime() : Date.now();
      const scheduledFor = new Date(base + action.offsetMinutes * 60_000);
      if (scheduledFor.getTime() < Date.now() - 60_000) continue; // offset already passed
      const to =
        action.recipient === 'fixed'
          ? action.fixedTo
          : action.channel === 'EMAIL'
            ? contact.email
            : contact.consent?.whatsapp || job.trigger === 'lead.created'
              ? contact.phone
              : undefined;
      if (!to) continue;
      const n = await queueNotification(tenantId, {
        channel: action.channel,
        to,
        templateKey: 'free_text',
        data: {
          subject: interpolate(action.subject ?? settings.profile.displayName, vars),
          text: interpolate(action.text, vars),
        },
        scheduledFor,
        appointmentId: appt?._id,
        dedupeKey: `wf:${wf._id}:${job.eventKey}:${i}`,
      });
      if (n) count++;
    }
    await new TenantRepository(WorkflowExecutionModel, tenantId).updateOne(
      { workflowId: wf._id, eventKey: job.eventKey },
      { $set: { actionsQueued: count } },
    );
    queued += count;
  }
  return queued;
}

export function registerWorkflowHandlers() {
  registerJobHandler('workflow.run', async (data) => {
    assertTenantJob(data);
    await runWorkflows(data as unknown as WorkflowJob);
  });
  const enqueue = (job: WorkflowJob) =>
    getQueue().enqueue('workflow.run', { ...job }, { jobId: `wf:${job.tenantId}:${job.eventKey}` });
  events.on('appointment.created', ({ tenantId, appointmentId }) =>
    enqueue({
      tenantId,
      trigger: 'appointment.created',
      entityId: appointmentId,
      eventKey: `appointment.created:${appointmentId}`,
    }),
  );
  events.on('appointment.status_changed', ({ tenantId, appointmentId, to }) =>
    enqueue({
      tenantId,
      trigger: 'appointment.status_changed',
      entityId: appointmentId,
      toStatus: to,
      eventKey: `appointment.status:${appointmentId}:${to}`,
    }),
  );
  events.on('appointment.rescheduled', ({ tenantId, appointmentId }) =>
    enqueue({
      tenantId,
      trigger: 'appointment.rescheduled',
      entityId: appointmentId,
      eventKey: `appointment.rescheduled:${appointmentId}:${Date.now()}`,
    }),
  );
  events.on('lead.created', ({ tenantId, leadId }) =>
    enqueue({ tenantId, trigger: 'lead.created', entityId: leadId, eventKey: `lead.created:${leadId}` }),
  );
}
