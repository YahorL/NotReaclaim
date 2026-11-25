import { snapMinutes, pxToMinutes, moveStartMin, resizeEndMin, shiftDays, formatHm, weekdayLabel } from './weekModel';
import { MS_PER_MIN } from '../lib/time';
import { formatDurationShort } from '../lib/duration';

/**
 * The pure geometry behind a planner block drag (spec §5.2): where a pointer travel lands, what a
 * resize ends at, and what the ghost's pill says. jsdom cannot drive a real gesture, so everything
 * a release commits is decided here and tested directly; `useBlockDrag` only feeds it pointer
 * deltas.
 *
 * Pointer deltas (`dx`, `dy`) and `colWidth` are CLIENT pixels. `scale` is the layer's render
 * scale (`rect.width / offsetWidth`) — 1 unless the page is zoomed by a transform — and converts a
 * client-pixel travel into the layout pixels the 60px/hour grid is drawn in.
 */

/** Travel (|dx| + |dy|, client px) before a mouse press becomes a drag (prototype: 5px). */
export const DRAG_THRESHOLD_PX = 5;

export function pastThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.abs(dx) + Math.abs(dy) >= threshold;
}

const safeScale = (scale: number | undefined): number => (scale && Number.isFinite(scale) && scale > 0 ? scale : 1);

/** Snapped minute delta for a vertical client-pixel travel. */
function snappedMinutes(dy: number, scale: number | undefined): number {
  return snapMinutes(pxToMinutes(dy / safeScale(scale))) || 0; // `|| 0` folds -0 into 0
}

export interface MoveInput {
  /** Rendered column the block sits in. */
  origDay: number;
  /** Start, in minutes from that column's anchor. */
  origStartMin: number;
  durationMin: number;
  dx: number;
  dy: number;
  /** One column's width (client px); 0 / unknown → no horizontal move. */
  colWidth: number;
  /** Rendered columns (1–7). */
  dayCount: number;
  scale?: number;
}

/**
 * Where a moved block lands. The DELTA snaps to 15 minutes (not the absolute start), so an
 * off-grid block keeps its offset and a pure cross-day move keeps its exact time — the same rule
 * the arrow keys follow (±15). The day is rounded from the horizontal travel and clamped to the
 * rendered columns. Only the START is clamped to the 24h column (`moveStartMin`): the block keeps
 * its length, so its end may run past the column — an overnight block is never squeezed back in.
 */
export function moveTarget({ origDay, origStartMin, dx, dy, colWidth, dayCount, scale }: MoveInput): { dayIndex: number; startMin: number } {
  const days = colWidth > 0 ? Math.round(dx / colWidth) : 0;
  const dayIndex = Math.max(0, Math.min(Math.max(0, dayCount - 1), origDay + days));
  return { dayIndex, startMin: moveStartMin(origStartMin, snappedMinutes(dy, scale)) };
}

/**
 * Where a bottom-edge resize ends: snapped delta, at least one 15-min slot, never grown past the
 * column end and never cut back to it (`resizeEndMin`) — a zero snapped delta (a click on the
 * handle) is always a no-op.
 */
export function resizeTarget({ startMin, origEndMin, dy, scale }: { startMin: number; origEndMin: number; dy: number; scale?: number }): { endMin: number } {
  return { endMin: resizeEndMin(startMin, origEndMin, snappedMinutes(dy, scale)) };
}

/**
 * Absolute times of a target. Column anchors are wall-clock times (midnight, or the configured
 * day start), so a cross-day move shifts by wall-clock days rather than a flat 24h — DST-safe.
 */
export function targetTimes({ dayStartMs, dayDelta, startMin, endMin, zone }: { dayStartMs: number; dayDelta: number; startMin: number; endMin: number; zone: string }): { startMs: number; endMs: number } {
  const anchor = shiftDays(dayStartMs, dayDelta, zone);
  return { startMs: anchor + startMin * MS_PER_MIN, endMs: anchor + endMin * MS_PER_MIN };
}

/** Ghost pill while moving: "Sat · 12:15 AM" — the target COLUMN's weekday (matches its header). */
export function moveLabel(columnDayMs: number, startMs: number, zone: string): string {
  return `${weekdayLabel(columnDayMs, zone)} · ${formatHm(startMs, zone)}`;
}

/** Ghost pill while resizing: "1h 15m · ends 9:15 PM". */
export function resizeLabel(durationMin: number, endMs: number, zone: string): string {
  return `${formatDurationShort(durationMin * MS_PER_MIN)} · ends ${formatHm(endMs, zone)}`;
}
