import { model, Schema, type Types } from 'mongoose';
import { tenantSchema } from '../../infrastructure/mongodb/base-schema';

export const EXCEL_RESOURCES = ['customers', 'leads', 'services', 'staff', 'appointments'] as const;
export type ExcelResource = (typeof EXCEL_RESOURCES)[number];

export interface RowError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportJobDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  resource: ExcelResource;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  duplicateStrategy: 'skip' | 'update' | 'fail';
  originalFilename: string;
  fileKey?: string;
  totals: { rows: number; valid: number; invalid: number; created: number; updated: number; skipped: number };
  rowErrors: RowError[];
  error?: string;
  createdBy: Types.ObjectId;
  completedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

const totals = {
  rows: Number,
  valid: Number,
  invalid: Number,
  created: Number,
  updated: Number,
  skipped: Number,
};

const importSchema = tenantSchema<ImportJobDoc>({
  resource: { type: String, enum: EXCEL_RESOURCES, required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'QUEUED' },
  duplicateStrategy: { type: String, enum: ['skip', 'update', 'fail'], default: 'skip' },
  originalFilename: { type: String, maxlength: 255 },
  fileKey: String,
  totals: { type: totals, default: { rows: 0, valid: 0, invalid: 0, created: 0, updated: 0, skipped: 0 } },
  rowErrors: { type: [{ _id: false, row: Number, column: String, message: String }], default: [] },
  error: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: Date,
  expiresAt: { type: Date, required: true },
});
importSchema.index({ tenantId: 1, createdAt: -1 });
importSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ImportJobModel = model<ImportJobDoc>('ImportJob', importSchema, 'importJobs');

export interface ExportJobDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  resource: ExcelResource;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  filters: { from?: Date; to?: Date; status?: string };
  columns: string[];
  includePii: boolean;
  fileKey?: string;
  filename?: string;
  rowCount: number;
  truncated: boolean;
  error?: string;
  createdBy: Types.ObjectId;
  completedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

const exportSchema = tenantSchema<ExportJobDoc>({
  resource: { type: String, enum: EXCEL_RESOURCES, required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'QUEUED' },
  filters: { from: Date, to: Date, status: String },
  columns: { type: [String], default: [] },
  includePii: { type: Boolean, default: false },
  fileKey: String,
  filename: String,
  rowCount: { type: Number, default: 0 },
  truncated: { type: Boolean, default: false },
  error: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: Date,
  expiresAt: { type: Date, required: true },
});
exportSchema.index({ tenantId: 1, createdAt: -1 });
exportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ExportJobModel = model<ExportJobDoc>('ExportJob', exportSchema, 'exportJobs');
