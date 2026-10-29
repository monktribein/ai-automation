import { model, Schema, type Types } from 'mongoose';
import { platformSchema } from '../../infrastructure/mongodb/base-schema';

/** Platform-owned session record. Only a SHA-256 hash of the opaque refresh token is stored. */
export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  tenantId?: Types.ObjectId;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  replacedByHash?: string;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
}

const refreshSchema = platformSchema<RefreshTokenDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  familyId: { type: String, required: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  revokedReason: String,
  replacedByHash: String,
  userAgent: { type: String, maxlength: 300 },
  ip: { type: String, maxlength: 64 },
});
refreshSchema.index({ tokenHash: 1 }, { unique: true });
refreshSchema.index({ familyId: 1 });
refreshSchema.index({ userId: 1, revokedAt: 1 });
// TTL: session records are removed by MongoDB once expired.
refreshSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshTokenDoc>('RefreshToken', refreshSchema, 'refreshTokens');

export interface PasswordResetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
}

const resetSchema = platformSchema<PasswordResetDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
});
resetSchema.index({ tokenHash: 1 }, { unique: true });
resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetModel = model<PasswordResetDoc>(
  'PasswordReset',
  resetSchema,
  'passwordResetTokens',
);
