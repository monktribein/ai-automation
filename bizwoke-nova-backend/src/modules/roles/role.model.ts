import { model, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';
import { ALL_PERMISSIONS } from '../permissions/permissions';

export interface RoleDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  system: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = tenantSchema<RoleDoc>({
  key: { type: String, required: true, uppercase: true, match: /^[A-Z][A-Z0-9_]{1,39}$/ },
  name: { type: String, required: true, maxlength: 80 },
  description: { type: String, maxlength: 500 },
  permissions: {
    type: [String],
    validate: {
      validator: (v: string[]) => v.every((p) => (ALL_PERMISSIONS as string[]).includes(p)),
      message: 'Unknown permission',
    },
  },
  system: { type: Boolean, default: false },
});
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const RoleModel = model<RoleDoc>('Role', schema, 'roles');
