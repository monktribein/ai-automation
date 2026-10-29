import type { ClientSession, Types } from 'mongoose';
import { Errors } from '../../common/errors/app-error';
import { escapeRegex, normalizeEmail, normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { CustomerModel, type CustomerDoc } from './customer.models';

export interface CustomerInput {
  name: string;
  email?: string;
  phone?: string;
  preferredLanguage?: string;
  consent?: Partial<CustomerDoc['consent']>;
  tags?: string[];
  notes?: string;
}

export const customerRepo = (tenantId: Types.ObjectId) =>
  new TenantRepository<CustomerDoc>(CustomerModel, tenantId);

/** Fields returned when the caller lacks the customers:pii permission. */
export function redactCustomer<T extends Partial<CustomerDoc>>(
  c: T,
  canSeePii: boolean,
): Partial<CustomerDoc> {
  const { emailNormalized: _e, phoneNormalized: _p, ...rest } = c;
  if (canSeePii) return rest;
  return {
    ...rest,
    email: rest.email ? rest.email.replace(/^(.).*(@.*)$/, '$1***$2') : undefined,
    phone: rest.phone ? `***${rest.phone.slice(-3)}` : undefined,
    notes: undefined,
  };
}

function normalized(input: { email?: string; phone?: string }) {
  return {
    emailNormalized: input.email ? normalizeEmail(input.email) : undefined,
    phoneNormalized: input.phone ? normalizePhone(input.phone) : undefined,
  };
}

/** Finds the existing customer (same tenant) by email, then phone; otherwise creates one. */
export async function findOrCreateCustomer(
  tenantId: Types.ObjectId,
  input: CustomerInput,
  source: CustomerDoc['source'],
  session?: ClientSession,
): Promise<CustomerDoc> {
  if (!input.email && !input.phone) throw Errors.validation('Customer email or phone is required');
  const repo = customerRepo(tenantId);
  const n = normalized(input);
  const or = [
    ...(n.emailNormalized ? [{ emailNormalized: n.emailNormalized }] : []),
    ...(n.phoneNormalized ? [{ phoneNormalized: n.phoneNormalized }] : []),
  ];
  const existing = await repo.findOne({ $or: or, status: 'ACTIVE' }, { session });
  if (existing) return existing;
  return repo.create(
    {
      name: input.name,
      email: input.email,
      phone: input.phone,
      ...n,
      preferredLanguage: input.preferredLanguage,
      consent: {
        email: false,
        whatsapp: false,
        sms: false,
        marketing: false,
        ...input.consent,
        updatedAt: new Date(),
      },
      source,
    },
    session,
  );
}

export async function createCustomer(tenantId: Types.ObjectId, input: CustomerInput) {
  try {
    return await customerRepo(tenantId).create({
      ...input,
      ...normalized(input),
      consent: {
        email: false,
        whatsapp: false,
        sms: false,
        marketing: false,
        ...input.consent,
        updatedAt: new Date(),
      },
      source: 'MANUAL',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw Errors.conflict('A customer with this email or phone already exists');
    throw err;
  }
}

export async function updateCustomer(tenantId: Types.ObjectId, id: string, patch: Partial<CustomerInput>) {
  const repo = customerRepo(tenantId);
  const current = await repo.getById(id, 'Customer');
  if (current.status !== 'ACTIVE') throw Errors.conflict('Customer record has been anonymized');
  const set: Record<string, unknown> = { ...patch };
  if (patch.consent) set.consent = { ...current.consent, ...patch.consent, updatedAt: new Date() };
  if ('email' in patch) set.emailNormalized = patch.email ? normalizeEmail(patch.email) : undefined;
  if ('phone' in patch) set.phoneNormalized = patch.phone ? normalizePhone(patch.phone) : undefined;
  try {
    return await repo.findOneAndUpdate({ _id: id }, { $set: set });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw Errors.conflict('A customer with this email or phone already exists');
    throw err;
  }
}

export async function searchCustomers(
  tenantId: Types.ObjectId,
  q: { search?: string; tag?: string; page: number; limit: number; sort: Record<string, 1 | -1> },
) {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };
  if (q.tag) filter.tags = q.tag;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [
      { name: rx },
      { emailNormalized: rx },
      { phoneNormalized: new RegExp(escapeRegex(normalizePhone(q.search) || q.search)) },
    ];
  }
  const repo = customerRepo(tenantId);
  const [items, total] = await Promise.all([
    repo.find(filter, { sort: q.sort, skip: (q.page - 1) * q.limit, limit: q.limit }),
    repo.count(filter),
  ]);
  return { items, total };
}

/**
 * Right-to-erasure workflow: personal data is irreversibly removed while appointment
 * history is retained (de-identified) for business records.
 */
export async function anonymizeCustomer(tenantId: Types.ObjectId, id: string) {
  const repo = customerRepo(tenantId);
  await repo.getById(id, 'Customer');
  return repo.findOneAndUpdate(
    { _id: id },
    {
      $set: { name: 'Anonymized customer', status: 'ANONYMIZED', anonymizedAt: new Date(), tags: [] },
      $unset: { email: 1, phone: 1, emailNormalized: 1, phoneNormalized: 1, notes: 1, preferredLanguage: 1 },
    },
  );
}
