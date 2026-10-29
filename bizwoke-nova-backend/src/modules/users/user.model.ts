import { model, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';
import type { PlatformRole } from '../../common/types/context';

/** Platform-owned: identity is tenant-independent; tenant access comes only from memberships. */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  phone?: string;
  passwordHash: string;
  platformRole: PlatformRole;
  status: 'ACTIVE' | 'DEACTIVATED';
  emailVerifiedAt?: Date;
  lastLoginAt?: Date;
  failedLoginCount: number;
  lockedUntil?: Date;
  passwordChangedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = platformSchema<UserDoc>({
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 32 },
  passwordHash: { type: String, required: true, select: false },
  platformRole: { type: String, enum: ['SUPER_ADMIN', 'USER'], default: 'USER' },
  status: { type: String, enum: ['ACTIVE', 'DEACTIVATED'], default: 'ACTIVE' },
  emailVerifiedAt: Date,
  lastLoginAt: Date,
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: Date,
  passwordChangedAt: Date,
});
schema.index({ email: 1 }, { unique: true });

export const UserModel = model<UserDoc>('User', schema, 'users');

export const PUBLIC_USER_FIELDS =
  '_id email name phone platformRole status emailVerifiedAt lastLoginAt createdAt';
