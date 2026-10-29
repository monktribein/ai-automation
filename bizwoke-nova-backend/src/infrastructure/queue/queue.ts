import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../common/logging/logger';
import { events } from '../../common/utils/events';

/** Every tenant-owned job carries the tenantId that trusted code put there. */
export interface TenantJob {
  tenantId: string;
  [key: string]: unknown;
}

export const JOB_NAMES = [
  'notification.send',
  'notifications.dispatch-due',
  'whatsapp.inbound',
  'workflow.run',
  'export.generate',
  'import.process',
  'cleanup.expired',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface EnqueueOptions {
  delayMs?: number;
  /** Deduplication key: the same jobId is never enqueued twice. */
  jobId?: string;
}

export type JobHandler = (
  data: TenantJob | Record<string, unknown>,
  meta: { attempt: number; jobId?: string },
) => Promise<void>;

export interface JobQueue {
  readonly mode: 'bullmq' | 'inline';
  enqueue(name: JobName, data: TenantJob | Record<string, unknown>, opts?: EnqueueOptions): Promise<void>;
  close(): Promise<void>;
}

const handlers = new Map<JobName, JobHandler>();
export function registerJobHandler(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
}

/** Rejects payloads whose tenantId is not a well-formed ObjectId before any handler runs. */
export function assertTenantJob(data: Record<string, unknown>): asserts data is TenantJob {
  const t = data.tenantId;
  if (typeof t !== 'string' || !Types.ObjectId.isValid(t)) throw new Error('Job is missing a valid tenantId');
}

async function runHandler(
  name: JobName,
  data: Record<string, unknown>,
  meta: { attempt: number; jobId?: string },
) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for job ${name}`);
  const started = Date.now();
  try {
    await handler(data, meta);
    logger.info(
      { job: name, jobId: meta.jobId, tenantId: data.tenantId, ms: Date.now() - started },
      'Job completed',
    );
  } catch (err) {
    logger.error(
      { err, job: name, jobId: meta.jobId, tenantId: data.tenantId, attempt: meta.attempt },
      'Job failed',
    );
    throw err;
  }
}

const QUEUE_NAME = 'bizwoke-nova';
const DEFAULT_ATTEMPTS = 5;

function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

class BullJobQueue implements JobQueue {
  readonly mode = 'bullmq' as const;
  private queue: Queue;
  constructor(private readonly connection: ConnectionOptions) {
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: DEFAULT_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        // Failed jobs are retained for inspection (dead-letter equivalent).
        removeOnFail: { age: 14 * 86_400 },
      },
    });
  }
  async enqueue(name: JobName, data: Record<string, unknown>, opts: EnqueueOptions = {}) {
    await this.queue.add(name, data, { delay: opts.delayMs, jobId: opts.jobId });
  }
  async scheduleRepeatable(name: JobName, everyMs: number) {
    await this.queue.upsertJobScheduler(`repeat:${name}`, { every: everyMs }, { name, data: {} });
  }
  startWorker(concurrency = 5): Worker {
    const worker = new Worker(
      QUEUE_NAME,
      async (job: Job) =>
        runHandler(job.name as JobName, job.data, { attempt: job.attemptsMade + 1, jobId: job.id }),
      { connection: this.connection, concurrency },
    );
    worker.on('failed', (job, err) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? DEFAULT_ATTEMPTS)) {
        logger.error({ job: job.name, jobId: job.id, err }, 'Job exhausted retries and moved to failed set');
      }
    });
    return worker;
  }
  async failedJobs(limit = 50) {
    const jobs = await this.queue.getFailed(0, limit - 1);
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      tenantId: j.data?.tenantId,
    }));
  }
  async close() {
    await this.queue.close();
  }
}

/**
 * Development/test fallback when REDIS_URL is not set: runs jobs in-process with bounded retries.
 * NOT durable across restarts — durable state (e.g. scheduled notifications) lives in MongoDB and
 * is swept by `notifications.dispatch-due`, so reminders survive restarts even in this mode.
 */
class InlineJobQueue implements JobQueue {
  readonly mode = 'inline' as const;
  private seen = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();
  pending = new Set<Promise<void>>();

  async enqueue(name: JobName, data: Record<string, unknown>, opts: EnqueueOptions = {}) {
    if (opts.jobId) {
      if (this.seen.has(opts.jobId)) return;
      this.seen.add(opts.jobId);
    }
    const exec = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await runHandler(name, data, { attempt, jobId: opts.jobId });
        } catch {
          if (attempt < 3) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
      }
    };
    const delay = opts.delayMs ?? 0;
    const p = new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        exec().finally(resolve);
      }, delay);
      t.unref();
      this.timers.add(t);
    });
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  /** Test helper: wait for all in-flight jobs (including ones they enqueue). */
  async drain() {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

let instance: JobQueue | undefined;

export function getQueue(): JobQueue {
  if (!instance) {
    const url = env().REDIS_URL;
    instance = url ? new BullJobQueue(redisConnection(url)) : new InlineJobQueue();
    if (!url) logger.warn('REDIS_URL not set: using non-durable in-process job queue (development only)');
  }
  return instance;
}

export function getBullQueue(): BullJobQueue | undefined {
  const q = getQueue();
  return q instanceof BullJobQueue ? q : undefined;
}

/** Waits until domain-event handlers and inline jobs (including ones they trigger) are idle. */
export async function drainInlineQueue(): Promise<void> {
  const q = getQueue();
  for (;;) {
    await events.settle();
    if (q instanceof InlineJobQueue) await q.drain();
    if (events.pendingCount() === 0 && (!(q instanceof InlineJobQueue) || q.pending.size === 0)) return;
  }
}

export async function closeQueue(): Promise<void> {
  await instance?.close();
  instance = undefined;
}
