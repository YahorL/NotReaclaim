import type { ScheduledBlock } from '../../api/types';

export const WINDOW_START_MIN = 6 * 60;   // 06:00
export const WINDOW_END_MIN = 22 * 60;    // 22:00
const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 (local) of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** Seven consecutive local-midnight timestamps starting at `weekStartMs`. */
export function dayColumns(weekStartMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d.getTime());
  }
  return out;
}

/** The Monday-midnight `weeks` weeks from `weekStartMs` (DST-safe local arithmetic). */
export function addWeeks(weekStartMs: number, weeks: number): number {
  const d = new Date(weekStartMs);
  d.setDate(d.getDate() + weeks * 7);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface BlockClass {
  kind: 'task' | 'habit';
  pinned: boolean;
}

export function classifyBlock(b: ScheduledBlock): BlockClass {
  return { kind: b.habitId != null ? 'habit' : 'task', pinned: b.pinned };
}

export interface BlockPosition {
  topPct: number;
  heightPct: number;
}

/**
 * Position an interval within a day's 06:00-22:00 window, as top/height percentages.
 * Clamps to the window; returns null when the interval does not intersect the window
 * (outside hours, or a different day).
 */
export function placeInDay(startMs: number, endMs: number, dayStartMs: number): BlockPosition | null {
  const startMin = (startMs - dayStartMs) / MS_PER_MIN;
  const endMin = (endMs - dayStartMs) / MS_PER_MIN;
  const clampedStart = Math.max(startMin, WINDOW_START_MIN);
  const clampedEnd = Math.min(endMin, WINDOW_END_MIN);
  if (clampedEnd <= clampedStart) return null;
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  return {
    topPct: ((clampedStart - WINDOW_START_MIN) / span) * 100,
    heightPct: ((clampedEnd - clampedStart) / span) * 100,
  };
}

/** Vertical position (%) of the "now" line within this day's window, or null if not today/in-window. */
export function nowLine(now: number, dayStartMs: number): number | null {
  const min = (now - dayStartMs) / MS_PER_MIN;
  if (min < WINDOW_START_MIN || min >= WINDOW_END_MIN) return null;
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  return ((min - WINDOW_START_MIN) / span) * 100;
}

/** True when `now` falls within [dayStart, dayStart+24h). */
export function isToday(now: number, dayStartMs: number): boolean {
  return now >= dayStartMs && now < dayStartMs + MS_PER_DAY;
}

export function humanizeMs(ms: number): string {
  const totalMin = Math.round(ms / MS_PER_MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
