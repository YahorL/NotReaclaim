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

/**
 * Split `dayStartMinute` (minutes past local midnight) into the wall-clock {hour, minute} a day
 * column is anchored to. Applied with luxon `.set()` — never by adding milliseconds — so a column
 * keeps its wall-clock anchor across DST transitions.
 */
function anchorParts(dayStartMinute: number): { hour: number; minute: number; second: 0; millisecond: 0 } {
  return { hour: Math.floor(dayStartMinute / 60), minute: dayStartMinute % 60, second: 0, millisecond: 0 };
}

/**
 * Start of the day *column* containing `ms`: the most recent `dayStartMinute` wall-clock time in
 * `zone`. With the default 0 this is exactly `localMidnight`. With 180 (03:00), 01:30 on the 7th
 * anchors to the 6th's column — late-night work stays on the previous day.
 *
 * DST: the anchor is a wall-clock time, so a column can span 23h or 25h across a transition while
 * the grid still draws 1440 minutes — blocks on those two days sit up to an hour off (the same
 * ±1h tolerance the zone-aware grid has carried since R16a). If the day-start time does not exist
 * on a spring-forward day, luxon shifts it forward to the first valid instant.
 */
export function dayAnchor(ms: number, zone = 'UTC', dayStartMinute = 0): number {
  const parts = anchorParts(dayStartMinute);
  const day = DateTime.fromMillis(ms, { zone }).startOf('day');
  const sameDay = day.set(parts);
  if (sameDay.toMillis() <= ms) return sameDay.toMillis();
  return day.minus({ days: 1 }).set(parts).toMillis();
}

/** `count` consecutive day-column starts from the column containing `startMs` (default 7). */
export function dayColumns(startMs: number, count = 7, zone = 'UTC', dayStartMinute = 0): number[] {
  const parts = anchorParts(dayStartMinute);
  const base = DateTime.fromMillis(dayAnchor(startMs, zone, dayStartMinute), { zone });
  return Array.from({ length: count }, (_, i) => base.plus({ days: i }).set(parts).toMillis());
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
 * Position an interval within a day column's 24h window, as top/height percentages. The window
 * runs `dayStartMs` → `dayStartMs + 24h`; that anchor is midnight by default and the configured
 * day start otherwise, so all the maths here stays relative to the column start.
 * Clamps to the window; returns null when the interval does not intersect it (a different column).
 * An interval straddling the boundary is clipped at the column edge (its tail is drawn by no
 * column, exactly as a midnight-straddling block behaves today).
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

/** Time-gutter width on the compact (below-md) layout: smaller hour labels, less stolen width. */
export const MOBILE_TIME_GUTTER_PX = 44;
/**
 * Minimum day-column width on the compact layout. Chosen so a 390px phone lands on ONE day even
 * at full bleed (⌊(390−44)/175⌋ = 1) while a 430px phone gets two (⌊(430−44)/175⌋ = 2). The whole
 * usable window is (173, 177]; 175 sits in the middle of it.
 */
export const MOBILE_MIN_DAY_COL_PX = 175;

/** Gutter width for the layout in play. `compact` is the viewport switch, not the pane width. */
export function timeGutterPx(compact = false): number {
  return compact ? MOBILE_TIME_GUTTER_PX : TIME_GUTTER_PX;
}

/**
 * How many day columns fit in `widthPx` (1..7). A negative width is the "not measured yet"
 * sentinel (SSR/jsdom/before first paint) → show the full week. A measured width of 0 (e.g. the
 * grid squeezed out by the side panels at a tiny viewport) is real → floor to a single day.
 *
 * `compact` selects the mobile constants. It is deliberately a parameter rather than something
 * inferred from `widthPx`: the grid pane is only ~640px wide on a 1280px desktop (sidebar 280 +
 * task panel 330), so a width-inferred switch would put a real desktop on the phone geometry.
 */
export function daysThatFit(widthPx: number, compact = false): number {
  if (widthPx < 0) return 7;
  const gutter = timeGutterPx(compact);
  const minCol = compact ? MOBILE_MIN_DAY_COL_PX : MIN_DAY_COL_PX;
  return Math.max(1, Math.min(7, Math.floor((widthPx - gutter) / minCol)));
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

/**
 * Label for hour row `index` of the gutter (e.g. "9a", "12p"). With a non-zero `dayStartMinute`
 * the labels rotate so the first row reads the day-start hour ("3a", "4a", … "2a"); a day start
 * that is not on the hour renders the minutes too ("3:30a").
 */
export function hourRowLabel(index: number, dayStartMinute = 0): string {
  const min = (dayStartMinute + index * 60) % (24 * 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h < 12 ? 'a' : 'p';
  const base = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${base}${period}` : `${base}:${String(m).padStart(2, '0')}${period}`;
}

/** Zone midnight (00:00) of the day containing `ms`. Calendar-date semantics — for a shifted
 *  planner column start use `dayAnchor`. */
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

/**
 * Which side of its day column the create-popover opens on. Columns in the first half open to
 * the left so the popover grows into the grid rather than off-screen. Replaces WeekGrid's
 * hardcoded `i <= 3`, which silently assumed a 7-day week.
 */
export function popoverAlign(dayIndex: number, dayCount: number): 'left' | 'right' {
  return dayIndex <= Math.floor((dayCount - 1) / 2) ? 'left' : 'right';
}

/** Toolbar label for the rendered window: one date in the 1-day view, `first – last` otherwise. */
export function rangeLabel(days: number[], zone = 'UTC'): string {
  if (days.length === 0) return '';
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone });
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}

/**
 * Minutes a tile must span before a coarse pointer earns the enlarged resize target. Below it a
 * 24px handle would cover the whole tile (a 15-min block is 14.5px tall) and eat the tap that
 * should open the drawer.
 */
export const COARSE_RESIZE_MIN_SPAN_MIN = 30;

/** Literal Tailwind height class for the resize hit area. It is invisible — only the target grows. */
export function resizeHandleClass(heightPct: number, coarse: boolean): 'h-1.5' | 'h-6' {
  if (!coarse) return 'h-1.5';
  // The percent → minutes roundtrip is lossy: an exactly-30-minute tile comes back as
  // 29.999999999999993, so compare with a tolerance far below one minute.
  const spanMin = (heightPct / 100) * (WINDOW_END_MIN - WINDOW_START_MIN);
  return spanMin >= COARSE_RESIZE_MIN_SPAN_MIN - 1e-6 ? 'h-6' : 'h-1.5';
}

/** Minimum horizontal travel before a day-header drag counts as a page swipe. */
export const SWIPE_MIN_PX = 48;

/**
 * How many pages a header swipe moves: +1 forward (swipe left), −1 back (swipe right), 0 when the
 * gesture is too short or too vertical. The 1.5× ratio guard keeps a diagonal scroll from paging.
 */
export function swipeDecision(dx: number, dy: number, minPx = SWIPE_MIN_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < minPx) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
