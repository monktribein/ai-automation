import { Schema, type SchemaDefinition, type SchemaOptions } from 'mongoose';
import { tenantGuardPlugin } from './tenant-guard.plugin';

const baseOptions: SchemaOptions = {
  timestamps: true,
  strict: 'throw',
  versionKey: false,
  minimize: false,
};

/** Tenant-owned collection: required, immutable, indexed tenantId + fail-closed guard. */
export function tenantSchema<T>(definition: SchemaDefinition, options: SchemaOptions = {}) {
  const schema = new Schema<T>(
    {
      // No standalone index: every tenant model declares compound indexes that lead with tenantId.
      tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
      ...definition,
    } as SchemaDefinition,
    { ...baseOptions, ...options } as never,
  );
  schema.plugin(tenantGuardPlugin);
  return schema;
}

/** Platform-owned or globally shared collection. */
export function platformSchema<T>(definition: SchemaDefinition, options: SchemaOptions = {}) {
  return new Schema<T>(definition, { ...baseOptions, ...options } as never);
}
