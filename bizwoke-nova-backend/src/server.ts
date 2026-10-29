import type { Server } from 'node:http';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { logger } from './common/logging/logger';
import { closeQueue, drainInlineQueue, getQueue } from './infrastructure/queue/queue';
import { events } from './common/utils/events';
import { syncPermissionCatalog } from './modules/permissions/permission.model';
import { integrationStatus } from './config/providers';
import { bootstrapModules } from './bootstrap';
import { createApp } from './app';
import { startInlineSchedulers, stopInlineSchedulers } from './jobs/schedulers';

async function main() {
  let config;
  try {
    config = env();
  } catch (err) {
    // Clear, actionable startup error for missing/invalid configuration.
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  }

  await connectDatabase();
  await syncPermissionCatalog();
  bootstrapModules();
  getQueue();
  // Without Redis the API process also runs the periodic sweeps (development mode).
  if (!config.REDIS_URL) startInlineSchedulers();

  const app = createApp();
  const server: Server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV, integrations: integrationStatus() },
      'Bizwoke Nova API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    server.close(async () => {
      stopInlineSchedulers();
      await events.settle(); // let post-commit handlers finish enqueueing work
      await drainInlineQueue();
      await closeQueue();
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
}

void main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
