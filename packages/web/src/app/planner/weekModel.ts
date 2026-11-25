import { DateTime } from 'luxon';
import type { ScheduledBlock } from '../../api/types';
import { MS_PER_MIN, MS_PER_DAY, SLOT_MIN } from '../lib/time';

export { MS_PER_DAY, SLOT_MIN };

export const WINDOW_START_MIN = 0;          // 00:00
export const WINDOW_END_MIN = 24 * 60;      // 24:00 (full day)
export const WINDOW_SPAN_MIN = WINDOW_END_MIN - WINDOW_START_MIN;

// Every calendar helper below takes the IANA `zone` as a REQUIRED argument: it is always the
// user's settings.timezone (useTimezone). A default would silently mean UTC wherever a caller
// forgot it — the bug class this module used to invite.

/** Monday 00:00 of the week containing `now`, in `zone`. */
export function startOfWeek(now: number, zone: string): number {
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
export function dayAnchor(ms: number, zone: string, dayStartMinute = 0): number {
  const parts = anchorParts(dayStartMinute);
  const day = DateTime.fromMillis(ms, { zone }).startOf('day');
  const sameDay = day.set(parts);
  if (sameDay.toMillis() <= ms) return sameDay.toMillis();
  return day.minus({ days: 1 }).set(parts).toMillis();
}

/** `count` consecutive day-column starts from the column containing `startMs`. */
export function dayColumns(startMs: number, count: number, zone: string, dayStartMinute = 0): number[] {
  const parts = anchorParts(dayStartMinute);
  const base = DateTime.fromMillis(dayAnchor(startMs, zone, dayStartMinute), { zone });
  return Array.from({ length: count }, (_, i) => base.plus({ days: i }).set(parts).toMillis());
}

/** The zone-midnight `weeks` weeks from `weekStartMs`. */
export function addWeeks(weekStartMs: number, weeks: number, zone: string): number {
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
  return {
    topPct: minuteToPct(clampedStart),
    heightPct: ((clampedEnd - clampedStart) / WINDOW_SPAN_MIN) * 100,
  };
}

/** Vertical position (%) within a day column of a minute counted from the column start. */
export function minuteToPct(minute: number): number {
  return ((minute - WINDOW_START_MIN) / WINDOW_SPAN_MIN) * 100;
}

/** Vertical position (%) of the "now" line within this day's window, or null if not today/in-window. */
export function nowLine(now: number, dayStartMs: number): number | null {
  const min = (now - dayStartMs) / MS_PER_MIN;
  if (min < WINDOW_START_MIN || min >= WINDOW_END_MIN) return null;
  return minuteToPct(min);
}

/** True when `now` falls within [dayStart, dayStart+24h). */
export function isToday(now: number, dayStartMs: number): boolean {
  return now >= dayStartMs && now < dayStartMs + MS_PER_DAY;
}

/** One hour = 60px tall in the grid body (must match WeekGrid's h-[60px] rows). */
export const HOUR_ROW_PX = 60;
/** Fixed day-column pixel height: one 60px row per hour of the window (24 * 60 = 1440). */
export const GRID_COLUMN_PX = (WINDOW_SPAN_MIN / 60) * HOUR_ROW_PX;

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

/** Round a minute value to the nearest `step` (default: one slot, 15). */
export function snapMinutes(min: number, step = SLOT_MIN): number {
  return Math.round(min / step) * step;
}

/** Convert a signed pixel delta within a day column to a signed minute delta. */
export function pxToMinutes(px: number): number {
  return (px / GRID_COLUMN_PX) * WINDOW_SPAN_MIN;
}

/** Convert a signed minute delta to a signed pixel delta within a day column (inverse of pxToMinutes). */
export function minutesToPx(min: number): number {
  return (min / WINDOW_SPAN_MIN) * GRID_COLUMN_PX;
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
  const period = h < 12 ? 'AM' : 'PM';
  const base = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${base} ${period}` : `${base}:${String(m).padStart(2, '0')} ${period}`;
}

/** Zone midnight (00:00) of the day containing `ms`. Calendar-date semantics — for a shifted
 *  planner column start use `dayAnchor`. */
export function localMidnight(ms: number, zone: string): number {
  return DateTime.fromMillis(ms, { zone }).startOf('day').toMillis();
}

/** Shift a timestamp by whole days in `zone` (DST-safe; preserves wall-clock time). */
export function shiftDays(ms: number, days: number, zone: string): number {
  if (days === 0) return ms;
  return DateTime.fromMillis(ms, { zone }).plus({ days }).toMillis();
}

/** Time-of-day label (e.g. "9:00 AM", no leading zero — the design's tile/ghost form) of `ms` rendered in `zone`. */
/**
 * The UI is English-only, so every time label is formatted in one fixed locale (12-hour,
 * "9:00 AM") instead of the browser's: a 24-hour browser locale used to mix "16:15" tiles and
 * ghost pills with the en-US detail card, Next-up card and panel labels.
 */
export const TIME_LOCALE = 'en-US';

export function formatHm(ms: number, zone: string): string {
  return new Date(ms).toLocaleTimeString(TIME_LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone });
}

/** 3-letter weekday (e.g. "Mon") of `ms` in `zone`. */
export function weekdayLabel(ms: number, zone: string): string {
  return new Date(ms).toLocaleDateString(TIME_LOCALE, { weekday: 'short', timeZone: zone });
}

/** Day-of-month number of `ms` in `zone`. */
export function dayOfMonth(ms: number, zone: string): number {
  return Number(new Date(ms).toLocaleDateString('en-US', { day: 'numeric', timeZone: zone }));
}

/** Map a click's fractional position within a day column (0..1) to a snapped start minute with room for a 15-min slot. */
export function snapClickToSlot(fraction: number): number {
  const min = snapMinutes(WINDOW_START_MIN + fraction * WINDOW_SPAN_MIN);
  return Math.min(WINDOW_END_MIN - SLOT_MIN, Math.max(WINDOW_START_MIN, min));
}

/** Clamp a horizontal day delta so dayIndex + delta stays within the rendered columns (0..lastIndex). */
export function clampDayDelta(dayIndex: number, delta: number, lastIndex = 6): number {
  return Math.max(-dayIndex, Math.min(lastIndex - dayIndex, delta)) || 0;
}

/**
 * Where a MOVED block starts: `startMin + deltaMin`, with only the START clamped to the column
 * ([WINDOW_START_MIN, WINDOW_END_MIN − SLOT_MIN]). The caller keeps the block's length, so its end
 * may run past the column (an overnight 23:00–07:00 block, or 23:15–00:15 after a ↓). Never moves
 * against the direction of `deltaMin`: an off-grid start already in the last slot stays put on ↓.
 */
export function moveStartMin(startMin: number, deltaMin: number): number {
  if (deltaMin === 0) return startMin;
  const clamped = Math.min(WINDOW_END_MIN - SLOT_MIN, Math.max(WINDOW_START_MIN, startMin + deltaMin));
  return deltaMin > 0 ? Math.max(startMin, clamped) : Math.min(startMin, clamped);
}

/**
 * Where a bottom-edge RESIZE ends: `endMin + deltaMin`, at least one slot long, and never grown
 * past the column end — unless the block already ends past it, in which case it is never SHORTENED
 * for that (a click on an overnight tile's handle must not cut it to 24:00). A zero delta is a
 * no-op before any clamping, and the end never moves against the direction of `deltaMin`.
 */
export function resizeEndMin(startMin: number, endMin: number, deltaMin: number): number {
  if (deltaMin === 0) return endMin;
  const target = Math.min(Math.max(WINDOW_END_MIN, endMin), Math.max(startMin + SLOT_MIN, endMin + deltaMin));
  return deltaMin > 0 ? Math.max(endMin, target) : Math.min(endMin, target);
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
 * the left so the popover grows into the grid rather than off-screen. Derived from `dayCount`
 * so the split holds for any window of 1–7 days, not only a full week.
 */
export function popoverAlign(dayIndex: number, dayCount: number): 'left' | 'right' {
  return dayIndex <= Math.floor((dayCount - 1) / 2) ? 'left' : 'right';
}

/** Toolbar label for the rendered window: one date in the 1-day view, `first – last` otherwise. */
export function rangeLabel(days: number[], zone: string): string {
  if (days.length === 0) return '';
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(TIME_LOCALE, { month: 'short', day: 'numeric', timeZone: zone });
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}

/**
 * Minutes a tile must span before it earns more than the 6px resize bar. Below it a bigger handle
 * would cover most of the tile (a 15-min block is 15px tall) and eat the press that should move
 * it or open it.
 */
export const COARSE_RESIZE_MIN_SPAN_MIN = 30;

/**
 * Literal Tailwind height class for the resize hit area (invisible — only the target grows; the
 * grip pill is drawn by CalendarBlock). Fine pointer: the design's 10px handle. Coarse pointer: a
 * bigger target that still never reaches the lower half of the tile, so a long-press move started
 * low on a tile is a move, not a resize (P3 note) — 12px on 30–59 min tiles, 16px from an hour.
 */
export function resizeHandleClass(heightPct: number, coarse: boolean): 'h-1.5' | 'h-2.5' | 'h-3' | 'h-4' {
  // The percent → minutes roundtrip is lossy: an exactly-30-minute tile comes back as
  // 29.999999999999993, so compare with a tolerance far below one minute.
  const spanMin = (heightPct / 100) * WINDOW_SPAN_MIN + 1e-6;
  if (spanMin < COARSE_RESIZE_MIN_SPAN_MIN) return 'h-1.5';
  if (!coarse) return 'h-2.5';
  return spanMin >= 60 ? 'h-4' : 'h-3';
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
