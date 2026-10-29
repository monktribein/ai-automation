import { Types } from 'mongoose';
import { env } from '../../config/env';
import { Errors } from '../../common/errors/app-error';
import { logger } from '../../common/logging/logger';
import type { TenantContext } from '../../common/types/context';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { assertTenantJob, getQueue, registerJobHandler } from '../../infrastructure/queue/queue';
import { getStorage } from '../../infrastructure/storage/storage.provider';
import { TenantModel } from '../tenants/tenant.model';
import { resolveMembershipContext } from '../memberships/membership-context';
import { PERMISSIONS } from '../permissions/permissions';
import { audit } from '../audit-logs/audit.service';
import { consumeQuota } from '../usage/usage.service';
import { readSheet, writeSheet, SpreadsheetError, XLSX_MIME, type CellPrimitive } from './excel';
import {
  ExportJobModel,
  ImportJobModel,
  type ExcelResource,
  type ExportJobDoc,
  type ImportJobDoc,
  type RowError,
} from './import-export.models';
import { RESOURCES, rowErrorFromException, type DuplicateStrategy, type ExportFilters } from './resources';

const MAX_REPORTED_ERRORS = 500;
const BATCH_SIZE = 100;

export interface ValidationReport {
  rows: number;
  valid: number;
  invalid: number;
  duplicatesInFile: number;
  existingMatches: number;
  errors: RowError[];
}

export function assertCanImport(ctx: TenantContext, resource: ExcelResource) {
  const def = RESOURCES[resource];
  if (!ctx.permissions.has(PERMISSIONS.IMPORTS_RUN) || !ctx.permissions.has(def.writePermission))
    throw Errors.forbidden();
}

export function assertCanExport(ctx: TenantContext, resource: ExcelResource) {
  const def = RESOURCES[resource];
  if (!ctx.permissions.has(PERMISSIONS.EXPORTS_RUN) || !ctx.permissions.has(def.readPermission))
    throw Errors.forbidden();
}

interface ValidRow {
  rowNumber: number;
  data: Record<string, unknown>;
  existingId: Types.ObjectId | null;
}

/** Full-file validation. Nothing is written. Used for dry-run and as phase 1 of a real import. */
export async function validateWorkbook(
  tenantId: Types.ObjectId,
  resource: ExcelResource,
  file: Buffer,
  strategy: DuplicateStrategy,
): Promise<{ report: ValidationReport; rows: ValidRow[] }> {
  const def = RESOURCES[resource];
  let sheet;
  try {
    sheet = await readSheet(file, def.columns, env().IMPORT_MAX_ROWS);
  } catch (err) {
    if (err instanceof SpreadsheetError) throw Errors.validation(err.message);
    throw err;
  }
  const errors: RowError[] = [...sheet.errors];
  const badRows = new Set(sheet.errors.map((e) => e.row));
  const seen = new Map<string, number>();
  const rows: ValidRow[] = [];
  let duplicatesInFile = 0;
  let existingMatches = 0;

  for (const r of sheet.rows) {
    if (badRows.has(r.rowNumber)) continue;
    const parsed = def.rowSchema.safeParse(r.values);
    if (!parsed.success) {
      for (const i of parsed.error.issues)
        errors.push({ row: r.rowNumber, column: i.path.join('.') || undefined, message: i.message });
      badRows.add(r.rowNumber);
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    const key = def.naturalKey?.(data);
    if (key) {
      if (seen.has(key)) {
        duplicatesInFile++;
        errors.push({ row: r.rowNumber, message: `Duplicate of row ${seen.get(key)} in this file` });
        badRows.add(r.rowNumber);
        continue;
      }
      seen.set(key, r.rowNumber);
    }
    const existing = def.existing ? await def.existing(tenantId, data) : null;
    if (existing) {
      existingMatches++;
      if (strategy === 'fail') {
        errors.push({ row: r.rowNumber, message: 'A matching record already exists' });
        badRows.add(r.rowNumber);
        continue;
      }
    }
    rows.push({ rowNumber: r.rowNumber, data, existingId: existing?._id ?? null });
  }

  return {
    report: {
      rows: sheet.rows.length,
      valid: rows.length,
      invalid: badRows.size,
      duplicatesInFile,
      existingMatches,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    },
    rows,
  };
}

export async function createImportJob(
  ctx: TenantContext,
  resource: ExcelResource,
  file: Buffer,
  filename: string,
  strategy: DuplicateStrategy,
): Promise<ImportJobDoc> {
  await consumeQuota(ctx.tenantId, 'imports');
  const repo = new TenantRepository<ImportJobDoc>(ImportJobModel, ctx.tenantId);
  const jobId = new Types.ObjectId();
  // Server-generated key: tenant prefix + job id. Original filename is metadata only.
  const fileKey = `tenants/${ctx.tenantId}/imports/${jobId}.xlsx`;
  await getStorage().put(fileKey, file, XLSX_MIME);
  const job = await repo.create(
    {
      resource,
      duplicateStrategy: strategy,
      originalFilename: filename.replace(/[^\w.\- ]/g, '_').slice(0, 255),
      fileKey,
      status: 'QUEUED',
      createdBy: new Types.ObjectId(ctx.actor.userId),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    undefined,
    jobId,
  );
  await getQueue().enqueue(
    'import.process',
    { tenantId: ctx.tenantId.toString(), importJobId: job._id.toString() },
    { jobId: `import:${job._id}` },
  );
  return job;
}

/** Re-derives the actor's permissions at execution time (they may have been revoked since queueing). */
async function jobContext(tenantId: Types.ObjectId, userId: Types.ObjectId): Promise<TenantContext> {
  const ctx = await resolveMembershipContext(userId.toString(), tenantId);
  return ctx;
}

export async function processImportJob(tenantIdStr: string, jobIdStr: string) {
  const tenantId = new Types.ObjectId(tenantIdStr);
  const repo = new TenantRepository<ImportJobDoc>(ImportJobModel, tenantId);
  const job = await repo.findOneAndUpdate(
    { _id: jobIdStr, status: 'QUEUED' },
    { $set: { status: 'PROCESSING' } },
  );
  if (!job) return; // unknown id for this tenant, or already processed (idempotent)
  const storage = getStorage();
  try {
    const ctx = await jobContext(tenantId, job.createdBy);
    assertCanImport(ctx, job.resource);
    const chunks: Buffer[] = [];
    for await (const c of await storage.get(job.fileKey!)) chunks.push(c as Buffer);
    const { report, rows } = await validateWorkbook(
      tenantId,
      job.resource,
      Buffer.concat(chunks),
      job.duplicateStrategy,
    );

    const totals = {
      rows: report.rows,
      valid: report.valid,
      invalid: report.invalid,
      created: 0,
      updated: 0,
      skipped: 0,
    };
    // All-or-nothing validation: any invalid row aborts before a single write.
    if (report.invalid > 0) {
      await repo.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'FAILED',
            totals,
            rowErrors: report.errors,
            error: 'Validation failed; no rows were imported',
            completedAt: new Date(),
          },
        },
      );
      return;
    }
    const def = RESOURCES[job.resource];
    const writeErrors: RowError[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      for (const row of rows.slice(i, i + BATCH_SIZE)) {
        if (row.existingId && job.duplicateStrategy === 'skip') {
          totals.skipped++;
          continue;
        }
        try {
          const outcome = await def.write(
            { ...ctx, actor: { ...ctx.actor, type: 'system' } },
            row.data,
            row.existingId,
            job.duplicateStrategy,
          );
          totals[outcome]++;
        } catch (err) {
          writeErrors.push({ row: row.rowNumber, message: rowErrorFromException(err) });
        }
      }
      await repo.updateOne({ _id: job._id }, { $set: { totals } });
    }
    await repo.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'COMPLETED',
          totals,
          rowErrors: writeErrors.slice(0, MAX_REPORTED_ERRORS),
          completedAt: new Date(),
        },
      },
    );
    await audit(
      { tenantId, actorType: 'user', actorUserId: job.createdBy.toString() },
      {
        action: 'import.complete',
        resourceType: job.resource,
        resourceId: job._id,
        metadata: { ...totals, failedWrites: writeErrors.length },
      },
    );
  } catch (err) {
    logger.error({ err, tenantId: tenantIdStr, importJobId: jobIdStr }, 'Import job failed');
    await repo.updateOne(
      { _id: job._id },
      { $set: { status: 'FAILED', error: (err as Error).message?.slice(0, 500), completedAt: new Date() } },
    );
  } finally {
    // Uploaded files are not retained after processing.
    if (job.fileKey) {
      await storage.delete(job.fileKey).catch(() => undefined);
      await repo.updateOne({ _id: job._id }, { $unset: { fileKey: 1 } });
    }
  }
}

export async function createExportJob(
  ctx: TenantContext,
  resource: ExcelResource,
  filters: ExportFilters,
): Promise<ExportJobDoc> {
  assertCanExport(ctx, resource);
  await consumeQuota(ctx.tenantId, 'exports');
  const def = RESOURCES[resource];
  const includePii = ctx.permissions.has(PERMISSIONS.CUSTOMERS_PII);
  const columns = def.exportColumns.filter((c) => includePii || !c.pii).map((c) => c.key);
  const job = await new TenantRepository<ExportJobDoc>(ExportJobModel, ctx.tenantId).create({
    resource,
    filters,
    columns,
    includePii,
    status: 'QUEUED',
    rowCount: 0,
    truncated: false,
    createdBy: new Types.ObjectId(ctx.actor.userId),
    expiresAt: new Date(Date.now() + env().EXPORT_RETENTION_HOURS * 3_600_000),
  });
  await getQueue().enqueue(
    'export.generate',
    { tenantId: ctx.tenantId.toString(), exportJobId: job._id.toString() },
    { jobId: `export:${job._id}` },
  );
  return job;
}

export async function processExportJob(tenantIdStr: string, jobIdStr: string) {
  const tenantId = new Types.ObjectId(tenantIdStr);
  const repo = new TenantRepository<ExportJobDoc>(ExportJobModel, tenantId);
  const job = await repo.findOneAndUpdate(
    { _id: jobIdStr, status: 'QUEUED' },
    { $set: { status: 'PROCESSING' } },
  );
  if (!job) return;
  try {
    const ctx = await jobContext(tenantId, job.createdBy);
    assertCanExport(ctx, job.resource);
    // Field permissions are re-checked at execution: PII is dropped if the permission was revoked.
    const canPii = ctx.permissions.has(PERMISSIONS.CUSTOMERS_PII);
    const def = RESOURCES[job.resource];
    const cols = def.exportColumns.filter((c) => job.columns.includes(c.key) && (canPii || !c.pii));
    const max = env().EXPORT_MAX_ROWS;
    let count = 0;
    const rows = async function* () {
      for await (const r of def.exportRows(tenantId, job.filters ?? {}, max + 1)) {
        if (count >= max) break;
        count++;
        yield r as Record<string, CellPrimitive>;
      }
    };
    const buffer = await writeSheet(
      job.resource,
      cols.map((c) => ({ header: c.header, key: c.key })),
      rows(),
    );
    const tenant = await TenantModel.findById(tenantId, 'slug').lean();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const filename = `${tenant?.slug ?? 'export'}-${job.resource}-${stamp}.xlsx`.replace(
      /[^a-z0-9._-]/gi,
      '_',
    );
    const fileKey = `tenants/${tenantId}/exports/${job._id}.xlsx`;
    await getStorage().put(fileKey, buffer, XLSX_MIME);
    await repo.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'COMPLETED',
          fileKey,
          filename,
          rowCount: count,
          truncated: count >= max,
          completedAt: new Date(),
        },
      },
    );
    await audit(
      { tenantId, actorType: 'user', actorUserId: job.createdBy.toString() },
      {
        action: 'export.complete',
        resourceType: job.resource,
        resourceId: job._id,
        metadata: { rowCount: count, columns: cols.map((c) => c.key), includePii: canPii },
      },
    );
  } catch (err) {
    logger.error({ err, tenantId: tenantIdStr, exportJobId: jobIdStr }, 'Export job failed');
    await repo.updateOne(
      { _id: job._id },
      { $set: { status: 'FAILED', error: (err as Error).message?.slice(0, 500), completedAt: new Date() } },
    );
  }
}

export async function buildTemplate(resource: ExcelResource): Promise<Buffer> {
  const def = RESOURCES[resource];
  const example = Object.fromEntries(def.columns.map((c) => [c.key, c.example]));
  return writeSheet(
    resource,
    def.columns.map((c) => ({ header: c.key, key: c.key })),
    [example],
  );
}

export function registerImportExportJobs() {
  registerJobHandler('import.process', async (data) => {
    assertTenantJob(data);
    await processImportJob(data.tenantId, String(data.importJobId));
  });
  registerJobHandler('export.generate', async (data) => {
    assertTenantJob(data);
    await processExportJob(data.tenantId, String(data.exportJobId));
  });
}
