import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError, Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { idParam, isoDateTime } from '../../common/validation/schemas';
import { ok } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { getStorage } from '../../infrastructure/storage/storage.provider';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { loadSettings } from '../availability/availability.service';
import { looksLikeXlsx, XLSX_MIME } from './excel';
import {
  EXCEL_RESOURCES,
  ExportJobModel,
  ImportJobModel,
  type ExcelResource,
  type ExportJobDoc,
  type ImportJobDoc,
} from './import-export.models';
import {
  assertCanExport,
  assertCanImport,
  buildTemplate,
  createExportJob,
  createImportJob,
  validateWorkbook,
} from './import-export.service';

const resourceParam = z.object({ resource: z.enum(EXCEL_RESOURCES) });
const jobParam = idParam('jobId');
const importQuery = z
  .object({ duplicateStrategy: z.enum(['skip', 'update', 'fail']).default('skip') })
  .strict();
const exportBody = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    status: z
      .string()
      .regex(/^[A-Z_]{2,30}$/)
      .optional(),
  })
  .strict()
  .refine((b) => !b.from || !b.to || b.from < b.to, '`from` must be before `to`');

/** In-memory upload with strict size / count limits; files never touch disk unvalidated. */
function upload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env().IMPORT_MAX_FILE_BYTES, files: 1, fields: 5, parts: 6 },
  }).single('file');
}

function uploadedXlsx(req: Request): Express.Multer.File {
  const f = req.file;
  if (!f) throw Errors.validation('A file field named "file" is required');
  if (!/\.xlsx$/i.test(f.originalname))
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only .xlsx files are accepted');
  if (f.mimetype !== XLSX_MIME)
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Invalid content type for .xlsx');
  if (!looksLikeXlsx(f.buffer))
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File content is not a valid .xlsx workbook');
  return f;
}

async function requireExcelFeature(req: Request) {
  const s = await loadSettings(req.tenant!.tenantId);
  if (!s.features.excel) throw Errors.featureDisabled('excel');
}

export function importRouter(): Router {
  const r = Router();
  r.use(requirePermission(PERMISSIONS.IMPORTS_RUN));

  r.get('/:resource/template', validate({ params: resourceParam }), async (req, res) => {
    const { resource } = valid<{ resource: ExcelResource }>(res).params;
    assertCanImport(req.tenant!, resource);
    const buf = await buildTemplate(resource);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${resource}-import-template.xlsx"`);
    res.send(buf);
  });

  // Dry run: full validation report, nothing written.
  r.post(
    '/:resource/validate',
    upload(),
    validate({ params: resourceParam, query: importQuery }),
    async (req, res) => {
      const { params, query } = valid<{
        resource: ExcelResource;
        duplicateStrategy: 'skip' | 'update' | 'fail';
      }>(res);
      await requireExcelFeature(req);
      assertCanImport(req.tenant!, params.resource);
      const file = uploadedXlsx(req);
      const { report } = await validateWorkbook(
        req.tenant!.tenantId,
        params.resource,
        file.buffer,
        query.duplicateStrategy,
      );
      ok(req, res, { resource: params.resource, dryRun: true, ...report });
    },
  );

  r.post(
    '/:resource',
    upload(),
    validate({ params: resourceParam, query: importQuery }),
    async (req, res) => {
      const { params, query } = valid<{
        resource: ExcelResource;
        duplicateStrategy: 'skip' | 'update' | 'fail';
      }>(res);
      await requireExcelFeature(req);
      assertCanImport(req.tenant!, params.resource);
      const file = uploadedXlsx(req);
      const job = await createImportJob(
        req.tenant!,
        params.resource,
        file.buffer,
        file.originalname,
        query.duplicateStrategy,
      );
      await audit(originFromRequest(req), {
        action: 'import.start',
        resourceType: params.resource,
        resourceId: job._id,
      });
      ok(req, res, { id: job._id, status: job.status, resource: job.resource }, {}, 202);
    },
  );

  r.get('/:jobId', validate({ params: jobParam }), async (req, res) => {
    const job = await new TenantRepository<ImportJobDoc>(ImportJobModel, req.tenant!.tenantId).getById(
      valid<{ jobId: string }>(res).params.jobId,
      'Import job',
      {
        projection: { fileKey: 0 },
      },
    );
    ok(req, res, job);
  });

  return r;
}

export function exportRouter(): Router {
  const r = Router();
  r.use(requirePermission(PERMISSIONS.EXPORTS_RUN));

  r.post('/:resource', validate({ params: resourceParam, body: exportBody }), async (req, res) => {
    const { params, body } = valid<{ resource: ExcelResource } & z.infer<typeof exportBody>>(res);
    await requireExcelFeature(req);
    assertCanExport(req.tenant!, params.resource);
    const job = await createExportJob(req.tenant!, params.resource, body);
    await audit(originFromRequest(req), {
      action: 'export.start',
      resourceType: params.resource,
      resourceId: job._id,
      metadata: { includePii: job.includePii },
    });
    res
      .status(202)
      .json({
        success: true,
        data: { id: job._id, status: job.status, columns: job.columns },
        meta: {},
        requestId: req.requestId,
      });
  });

  r.get('/:jobId', validate({ params: jobParam }), async (req, res) => {
    const job = await new TenantRepository<ExportJobDoc>(ExportJobModel, req.tenant!.tenantId).getById(
      valid<{ jobId: string }>(res).params.jobId,
      'Export job',
      {
        projection: { fileKey: 0 },
      },
    );
    ok(req, res, {
      ...job,
      downloadPath: job.status === 'COMPLETED' ? `${env().API_PREFIX}/exports/${job._id}/download` : null,
    });
  });

  // Authorized, tenant-scoped download; storage locations are never exposed publicly.
  r.get('/:jobId/download', validate({ params: jobParam }), async (req, res) => {
    const job = await new TenantRepository<ExportJobDoc>(ExportJobModel, req.tenant!.tenantId).getById(
      valid<{ jobId: string }>(res).params.jobId,
      'Export job',
    );
    assertCanExport(req.tenant!, job.resource);
    if (job.status !== 'COMPLETED' || !job.fileKey) throw Errors.conflict('Export is not ready');
    if (job.expiresAt < new Date()) throw Errors.notFound('Export file');
    await audit(originFromRequest(req), {
      action: 'export.download',
      resourceType: job.resource,
      resourceId: job._id,
    });
    const stream = await getStorage().get(job.fileKey);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    stream.pipe(res);
  });

  return r;
}
