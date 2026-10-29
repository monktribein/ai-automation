import { Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { events } from '../../common/utils/events';
import { escapeRegex, normalizeEmail, normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { MembershipModel } from '../memberships/membership.model';
import { findOrCreateCustomer } from './customer.service';
import { LeadModel, type LeadDoc } from './customer.models';

export interface LeadInput {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  interest?: string;
  sourceDetail?: string;
}

export const leadRepo = (tenantId: Types.ObjectId) => new TenantRepository<LeadDoc>(LeadModel, tenantId);

/** Creates a lead; flags (does not block) a likely duplicate of an open lead in the same tenant. */
export async function createLead(tenantId: Types.ObjectId, input: LeadInput, source: LeadDoc['source']) {
  if (!input.email && !input.phone) throw Errors.validation('Email or phone is required');
  const repo = leadRepo(tenantId);
  const emailNormalized = input.email ? normalizeEmail(input.email) : undefined;
  const phoneNormalized = input.phone ? normalizePhone(input.phone) : undefined;
  const or = [
    ...(emailNormalized ? [{ emailNormalized }] : []),
    ...(phoneNormalized ? [{ phoneNormalized }] : []),
  ];
  const dup = await repo.findOne(
    { $or: or, status: { $in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
    { projection: { _id: 1 } },
  );
  const lead = await repo.create({
    ...input,
    emailNormalized,
    phoneNormalized,
    source,
    possibleDuplicateOf: dup?._id,
  });
  events.emit('lead.created', { tenantId: tenantId.toString(), leadId: lead._id.toString() });
  return lead;
}

export async function listLeads(
  tenantId: Types.ObjectId,
  q: {
    page: number;
    limit: number;
    status?: LeadDoc['status'];
    source?: LeadDoc['source'];
    search?: string;
    assignedMembershipId?: string;
  },
) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.source) filter.source = q.source;
  if (q.assignedMembershipId) filter.assignedMembershipId = new Types.ObjectId(q.assignedMembershipId);
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { emailNormalized: rx }, { interest: rx }];
  }
  const repo = leadRepo(tenantId);
  const [items, total] = await Promise.all([
    repo.find(filter, { sort: { createdAt: -1 }, skip: (q.page - 1) * q.limit, limit: q.limit }),
    repo.count(filter),
  ]);
  return { items, total };
}

export async function updateLead(
  tenantId: Types.ObjectId,
  id: string,
  patch: { status?: LeadDoc['status']; assignedMembershipId?: string | null; interest?: string },
) {
  const repo = leadRepo(tenantId);
  const lead = await repo.getById(id, 'Lead');
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (patch.status) set.status = patch.status;
  if (patch.interest !== undefined) set.interest = patch.interest;
  if (patch.assignedMembershipId === null) unset.assignedMembershipId = 1;
  else if (patch.assignedMembershipId) {
    const m = await new TenantRepository(MembershipModel, tenantId).findOne({
      _id: patch.assignedMembershipId,
      status: 'ACTIVE',
    });
    if (!m)
      throw Errors.validation('Unknown assignee', [
        { path: 'assignedMembershipId', message: 'Not an active member of this tenant' },
      ]);
    set.assignedMembershipId = m._id;
  }
  if (patch.status === 'CONVERTED' && !lead.customerId) {
    const customer = await findOrCreateCustomer(
      tenantId,
      { name: lead.name, email: lead.email, phone: lead.phone },
      'LEAD',
    );
    set.customerId = customer._id;
  }
  return repo.findOneAndUpdate(
    { _id: id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  );
}
