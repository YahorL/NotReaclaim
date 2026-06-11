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

/** One hour = 58px tall in the grid body (must match WeekGrid's h-[58px] rows). */
export const HOUR_ROW_PX = 58;
/** Fixed day-column pixel height: one 58px row per hour of the window (16 * 58 = 928). */
export const GRID_COLUMN_PX = ((WINDOW_END_MIN - WINDOW_START_MIN) / 60) * HOUR_ROW_PX;

/** Round a minute value to the nearest `step` (default 15). */
export function snapMinutes(min: number, step = 15): number {
  return Math.round(min / step) * step;
}

/** Convert a signed pixel delta within a day column to a signed minute delta. */
export function pxToMinutes(px: number): number {
  return (px / GRID_COLUMN_PX) * (WINDOW_END_MIN - WINDOW_START_MIN);
}

/** Convert a signed minute delta to a signed pixel delta within a day column (inverse of pxToMinutes). */
export function minutesToPx(min: number): number {
  return (min / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX;
}

/** Local midnight (00:00:00.000) of the day containing `ms`. */
export function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Shift a timestamp by whole days via local-date arithmetic (DST-safe; preserves wall-clock time). */
export function shiftDays(ms: number, days: number): number {
  if (days === 0) return ms;
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Map a click's fractional position within a day column (0..1) to a snapped start minute with room for a 15-min slot. */
export function snapClickToSlot(fraction: number): number {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const min = snapMinutes(WINDOW_START_MIN + fraction * span);
  return Math.min(WINDOW_END_MIN - 15, Math.max(WINDOW_START_MIN, min));
}

/** Clamp a horizontal day delta so dayIndex + delta stays within the rendered week (0..6). */
export function clampDayDelta(dayIndex: number, delta: number): number {
  return Math.max(-dayIndex, Math.min(6 - dayIndex, delta)) || 0;
}

/** Keep [startMin, startMin+durationMin] inside the [WINDOW_START_MIN, WINDOW_END_MIN] window. */
export function clampToWindow(startMin: number, durationMin: number): { startMin: number; endMin: number } {
  let s = Math.max(WINDOW_START_MIN, startMin);
  if (s + durationMin > WINDOW_END_MIN) s = WINDOW_END_MIN - durationMin;
  s = Math.max(WINDOW_START_MIN, s);
  return { startMin: s, endMin: s + durationMin };
}
