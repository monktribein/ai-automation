/**
 * Creates collections and synchronises indexes for every model, then syncs the permission catalog.
 * Safe to re-run. In production (autoIndex disabled) run this as a release step:
 *   npm run db:indexes            # apply
 *   npm run db:indexes -- --dry   # show differences only
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { logger } from '../src/common/logging/logger';
import { syncPermissionCatalog } from '../src/modules/permissions/permission.model';
// Importing the route registry registers every model with mongoose.
import '../src/routes';

async function main() {
  const dry = process.argv.includes('--dry');
  await connectDatabase();
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => undefined);
    if (dry) {
      const diff = await model.diffIndexes();
      if (diff.toCreate.length || diff.toDrop.length) {
        logger.info(
          { collection: model.collection.name, toCreate: diff.toCreate, toDrop: diff.toDrop },
          'Index changes pending',
        );
      }
    } else {
      const dropped = await model.syncIndexes();
      logger.info({ collection: model.collection.name, dropped }, 'Indexes synchronised');
    }
  }
  if (!dry) await syncPermissionCatalog();
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Index sync failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
