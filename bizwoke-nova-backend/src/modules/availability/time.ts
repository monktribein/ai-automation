import { DateTime } from 'luxon';

/** Fixed allocation granularity for reservation slots. Independent of the tenant's display interval. */
export const RESERVATION_UNIT_MINUTES = 5;
const UNIT_MS = RESERVATION_UNIT_MINUTES * 60_000;

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export function isUnitAligned(d: Date): boolean {
  return d.getTime() % UNIT_MS === 0;
}

/** Slot-unit start times covering [start, end). */
export function unitStarts(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const first = Math.floor(start.getTime() / UNIT_MS) * UNIT_MS;
  for (let t = first; t < end.getTime(); t += UNIT_MS) out.push(new Date(t));
  return out;
}

/** Local wall-clock HH:mm on an ISO date in `zone` -> epoch ms (DST-aware). */
export function localToEpoch(isoDate: string, hhmm: string, zone: string): number {
  if (hhmm === '24:00')
    return DateTime.fromISO(isoDate, { zone }).plus({ days: 1 }).startOf('day').toMillis();
  return DateTime.fromISO(`${isoDate}T${hhmm}`, { zone }).toMillis();
}

export function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let result = base;
  for (const c of cuts) {
    const next: Interval[] = [];
    for (const r of result) {
      if (c.end <= r.start || c.start >= r.end) {
        next.push(r);
        continue;
      }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    result = next;
  }
  return result;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (start < end) out.push({ start, end });
    }
  }
  return out;
}

/** ISO dates (YYYY-MM-DD) from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from, { zone: 'UTC' });
  const end = DateTime.fromISO(to, { zone: 'UTC' });
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export function isoWeekday(isoDate: string, zone: string): number {
  return DateTime.fromISO(isoDate, { zone }).weekday;
}
