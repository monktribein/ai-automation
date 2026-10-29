import { getBullQueue, getQueue } from '../infrastructure/queue/queue';

export const SCHEDULES = [
  { name: 'notifications.dispatch-due', everyMs: 60_000 },
  { name: 'cleanup.expired', everyMs: 3_600_000 },
] as const;

const timers: NodeJS.Timeout[] = [];

/** Redis mode: repeatable jobs managed by BullMQ (one schedule across all instances). */
export async function registerRepeatableJobs() {
  const q = getBullQueue();
  if (!q) return;
  for (const s of SCHEDULES) await q.scheduleRepeatable(s.name, s.everyMs);
}

/** Inline mode (no Redis): simple in-process intervals. */
export function startInlineSchedulers() {
  for (const s of SCHEDULES) {
    const t = setInterval(() => void getQueue().enqueue(s.name, {}), s.everyMs);
    t.unref();
    timers.push(t);
  }
}

export function stopInlineSchedulers() {
  while (timers.length) clearInterval(timers.pop()!);
}
