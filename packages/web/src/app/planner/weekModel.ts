import { DateTime } from 'luxon';
import type { ScheduledBlock } from '../../api/types';

export const WINDOW_START_MIN = 0;          // 00:00
export const WINDOW_END_MIN = 24 * 60;      // 24:00 (full day)
const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 of the week containing `now`, in `zone`. */
export function startOfWeek(now: number, zone = 'UTC'): number {
  return DateTime.fromMillis(now, { zone }).startOf('week').toMillis(); // luxon weeks start Monday
}

/** `count` consecutive zone-midnight timestamps starting at `startMs` (default 7). */
export function dayColumns(startMs: number, count = 7, zone = 'UTC'): number[] {
  const base = DateTime.fromMillis(startMs, { zone });
  return Array.from({ length: count }, (_, i) => base.plus({ days: i }).startOf('day').toMillis());
}

/** The zone-midnight `weeks` weeks from `weekStartMs`. */
export function addWeeks(weekStartMs: number, weeks: number, zone = 'UTC'): number {
  return DateTime.fromMillis(weekStartMs, { zone }).plus({ weeks }).startOf('day').toMillis();
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
 * Position an interval within a day's 00:00-24:00 window, as top/height percentages.
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
/** Fixed day-column pixel height: one 58px row per hour of the window (24 * 58 = 1392). */
export const GRID_COLUMN_PX = ((WINDOW_END_MIN - WINDOW_START_MIN) / 60) * HOUR_ROW_PX;

/** Time-gutter width (px) — must match WeekGrid's first column. */
export const TIME_GUTTER_PX = 64;
/** Minimum readable width (px) for one day column. */
export const MIN_DAY_COL_PX = 120;

/** How many day columns fit in `widthPx` (1..7). A negative width is the "not measured yet"
 *  sentinel (SSR/jsdom/before first paint) → show the full week. A measured width of 0 (e.g. the
 *  grid squeezed out by the side panels at a tiny viewport) is real → floor to a single day. */
export function daysThatFit(widthPx: number): number {
  if (widthPx < 0) return 7;
  return Math.max(1, Math.min(7, Math.floor((widthPx - TIME_GUTTER_PX) / MIN_DAY_COL_PX)));
}

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

/** Zone midnight (00:00) of the day containing `ms`. */
export function localMidnight(ms: number, zone = 'UTC'): number {
  return DateTime.fromMillis(ms, { zone }).startOf('day').toMillis();
}

/** Shift a timestamp by whole days in `zone` (DST-safe; preserves wall-clock time). */
export function shiftDays(ms: number, days: number, zone = 'UTC'): number {
  if (days === 0) return ms;
  return DateTime.fromMillis(ms, { zone }).plus({ days }).toMillis();
}

/** Time-of-day label (e.g. "09:00 AM") of `ms` rendered in `zone`. */
export function formatHm(ms: number, zone = 'UTC'): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: zone });
}

/** 3-letter weekday (e.g. "Mon") of `ms` in `zone`. */
export function weekdayLabel(ms: number, zone = 'UTC'): string {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', timeZone: zone });
}

/** Day-of-month number of `ms` in `zone`. */
export function dayOfMonth(ms: number, zone = 'UTC'): number {
  return Number(new Date(ms).toLocaleDateString('en-US', { day: 'numeric', timeZone: zone }));
}

/** Map a click's fractional position within a day column (0..1) to a snapped start minute with room for a 15-min slot. */
export function snapClickToSlot(fraction: number): number {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const min = snapMinutes(WINDOW_START_MIN + fraction * span);
  return Math.min(WINDOW_END_MIN - 15, Math.max(WINDOW_START_MIN, min));
}

/** Clamp a horizontal day delta so dayIndex + delta stays within the rendered columns (0..lastIndex). */
export function clampDayDelta(dayIndex: number, delta: number, lastIndex = 6): number {
  return Math.max(-dayIndex, Math.min(lastIndex - dayIndex, delta)) || 0;
}

/** Keep [startMin, startMin+durationMin] inside the [WINDOW_START_MIN, WINDOW_END_MIN] window. */
export function clampToWindow(startMin: number, durationMin: number): { startMin: number; endMin: number } {
  let s = Math.max(WINDOW_START_MIN, startMin);
  if (s + durationMin > WINDOW_END_MIN) s = WINDOW_END_MIN - durationMin;
  s = Math.max(WINDOW_START_MIN, s);
  return { startMin: s, endMin: s + durationMin };
}
