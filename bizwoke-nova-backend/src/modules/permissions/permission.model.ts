import { model, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';
import { ALL_PERMISSIONS } from './permissions';

/** Globally shared, read-only catalog mirrored from code. Tenants reference codes via roles. */
export interface PermissionDoc {
  _id: Types.ObjectId;
  code: string;
  description?: string;
}

const schema = platformSchema<PermissionDoc>({
  code: { type: String, required: true, unique: true },
  description: String,
});

export const PermissionModel = model<PermissionDoc>('Permission', schema, 'permissions');

export async function syncPermissionCatalog(): Promise<void> {
  await PermissionModel.bulkWrite(
    ALL_PERMISSIONS.map((code) => ({
      updateOne: { filter: { code }, update: { $setOnInsert: { code } }, upsert: true },
    })),
  );
  await PermissionModel.deleteMany({ code: { $nin: ALL_PERMISSIONS } });
}
