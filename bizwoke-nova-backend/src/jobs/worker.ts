import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../common/logging/logger';
import { closeQueue, getBullQueue } from '../infrastructure/queue/queue';
import { bootstrapModules } from '../bootstrap';
import { registerRepeatableJobs } from './schedulers';

/** Dedicated BullMQ worker process (requires REDIS_URL). */
async function main() {
  const config = env();
  if (!config.REDIS_URL) {
    process.stderr.write('The worker requires REDIS_URL. Without Redis, jobs run inside the API process.\n');
    process.exit(1);
  }
  await connectDatabase();
  bootstrapModules();
  await registerRepeatableJobs();
  const worker = getBullQueue()!.startWorker(Number(process.env.WORKER_CONCURRENCY ?? 5));
  logger.info('Worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutting down: finishing active jobs');
    await worker.close(); // waits for in-flight jobs
    await closeQueue();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
