import { logger } from '../common/logging/logger';
import { registerJobHandler } from '../infrastructure/queue/queue';
import { getStorage } from '../infrastructure/storage/storage.provider';
import { RefreshTokenModel, PasswordResetModel } from '../modules/auth/auth.models';
import { ExportJobModel, ImportJobModel } from '../modules/imports-exports/import-export.models';

/**
 * Platform maintenance. TTL indexes already expire tokens/records; this job removes the
 * associated *files* (which TTL cannot) and purges revoked sessions early.
 */
export async function runCleanup(now = new Date()) {
  const storage = getStorage();
  const expiredExports = await ExportJobModel.find(
    { expiresAt: { $lt: now }, fileKey: { $exists: true } },
    'tenantId fileKey',
    { skipTenantGuard: true },
  )
    .limit(500)
    .lean();
  for (const e of expiredExports) {
    await storage
      .delete(e.fileKey!)
      .catch((err) => logger.warn({ err, exportJobId: e._id }, 'Failed to delete expired export file'));
    await ExportJobModel.updateOne({ _id: e._id, tenantId: e.tenantId }, { $unset: { fileKey: 1 } });
  }
  // Stale import uploads (job crashed before its finally block ran).
  const staleImports = await ImportJobModel.find(
    { fileKey: { $exists: true }, createdAt: { $lt: new Date(now.getTime() - 6 * 3_600_000) } },
    'tenantId fileKey',
    { skipTenantGuard: true },
  ).lean();
  for (const i of staleImports) {
    await storage.delete(i.fileKey!).catch(() => undefined);
    await ImportJobModel.updateOne(
      { _id: i._id, tenantId: i.tenantId },
      { $unset: { fileKey: 1 }, $set: { status: 'FAILED', error: 'Processing timed out' } },
    );
  }
  const revoked = await RefreshTokenModel.deleteMany({
    revokedAt: { $lt: new Date(now.getTime() - 7 * 86_400_000) },
  });
  const resets = await PasswordResetModel.deleteMany({
    $or: [{ expiresAt: { $lt: now } }, { usedAt: { $exists: true } }],
  });
  return {
    exportsCleared: expiredExports.length,
    importsCleared: staleImports.length,
    sessionsPurged: revoked.deletedCount,
    resetsPurged: resets.deletedCount,
  };
}

export function registerCleanupJobs() {
  registerJobHandler('cleanup.expired', async () => {
    const r = await runCleanup();
    logger.info(r, 'Cleanup completed');
  });
}
