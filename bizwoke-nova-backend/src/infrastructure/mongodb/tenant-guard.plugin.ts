import type { Schema, Query, Aggregate } from 'mongoose';

/**
 * Fail-closed guard for tenant-owned collections. Any query, update, delete, aggregate or
 * insert that does not carry a tenantId is rejected before it reaches MongoDB.
 *
 * The TenantRepository always adds the tenantId; this plugin catches code paths that bypass it.
 * Platform-level maintenance code can opt out explicitly with `{ skipTenantGuard: true }`.
 */
export class TenantGuardError extends Error {
  constructor(op: string, model: string) {
    super(`Tenant guard: ${op} on ${model} without tenantId`);
    this.name = 'TenantGuardError';
  }
}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
  'distinct',
] as const;

function hasTenant(filter: Record<string, unknown> | undefined): boolean {
  const t = filter?.tenantId;
  return t !== undefined && t !== null && !(typeof t === 'object' && Object.keys(t).length === 0);
}

export function tenantGuardPlugin(schema: Schema) {
  if (!schema.path('tenantId')) throw new Error('tenantGuardPlugin requires a tenantId path');

  for (const op of QUERY_OPS) {
    schema.pre(op as 'find', function (this: Query<unknown, unknown>) {
      if (this.getOptions().skipTenantGuard) return;
      if (!hasTenant(this.getFilter())) throw new TenantGuardError(op, this.model.modelName);
      const update = this.getUpdate() as Record<string, Record<string, unknown>> | null;
      // Never allow tenant reassignment through updates.
      if (
        update &&
        ('tenantId' in update || update.$set?.tenantId !== undefined || update.$unset?.tenantId !== undefined)
      ) {
        throw new TenantGuardError(`${op} modifying tenantId`, this.model.modelName);
      }
    });
  }

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    if ((this.options as { skipTenantGuard?: boolean }).skipTenantGuard) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || !hasTenant(first.$match)) {
      throw new TenantGuardError('aggregate (first stage must $match tenantId)', 'collection');
    }
  });

  schema.pre('save', function () {
    if (!this.get('tenantId'))
      throw new TenantGuardError('save', (this.constructor as { modelName?: string }).modelName ?? '');
    if (!this.isNew && this.isModified('tenantId')) throw new TenantGuardError('tenantId reassignment', '');
  });

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: unknown) {
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.some((d) => !(d as { tenantId?: unknown })?.tenantId))
      return next(new TenantGuardError('insertMany', ''));
    next();
  });

  schema.pre('bulkWrite', function (next: (err?: Error) => void, ops: unknown) {
    const list = (ops ?? []) as Record<
      string,
      { filter?: Record<string, unknown>; document?: Record<string, unknown> }
    >[];
    for (const op of list) {
      const body = Object.values(op)[0];
      const ok = body?.document ? Boolean(body.document.tenantId) : hasTenant(body?.filter);
      if (!ok) return next(new TenantGuardError('bulkWrite', ''));
    }
    next();
  });
}
