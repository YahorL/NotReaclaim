import { getEventCoordinates } from '@dnd-kit/utilities';
import { clampToWindow, snapClickToSlot, WINDOW_END_MIN, WINDOW_START_MIN } from './weekModel';

/** Marks a drag that started on a task card in the planner side panel / Tasks sheet. */
export const PANEL_TASK_DRAG_TYPE = 'panel-task';

export interface PanelTaskDragData {
  type: typeof PANEL_TASK_DRAG_TYPE;
  taskId: string;
}

export interface DayColumnDropData {
  type: 'day-col';
  dayIndex: number;
  dayStartMs: number;
}

export interface DayDropTarget {
  dayIndex: number;
  dayStartMs: number;
  startMin: number;
}

/** The task id behind an active drag, or null when the drag is anything else. */
export function draggedTaskId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<PanelTaskDragData>;
  return d.type === PANEL_TASK_DRAG_TYPE && typeof d.taskId === 'string' ? d.taskId : null;
}

/**
 * Approximate viewport Y of the pointer in the DRAG-START frame of reference: dnd-kit reports the
 * original activator event plus a running translate rather than live coordinates, so the pointer is
 * the sum of the two.
 *
 * It is an approximation, not the truth: `delta` folds in a scroll adjustment whose tracked
 * scrollable ancestors switch from the active node's to the over node's when a droppable is
 * entered, without the offset baseline resetting — so the sum can jump by a container's scrollTop
 * mid-drag. Callers should prefer a live `pointermove` reading (`useLivePointerY`) and fall back to
 * this only for the first frame, before any move has been observed.
 */
export function pointerClientY(activatorEvent: Event | null, delta: { y: number }): number | null {
  if (!activatorEvent) return null;
  const coords = getEventCoordinates(activatorEvent);
  return coords ? coords.y + delta.y : null;
}

/**
 * Which day column and which 15-minute slot a drag is currently over. Uses the same
 * fraction → `snapClickToSlot` maths the grid's click-to-create has always used, so a dropped card
 * and a tapped slot land on identical times.
 *
 * BOTH INPUTS MUST BE LIVE, in the same (viewport) frame of reference: a live `pointerY` from a
 * `pointermove` listener paired with an `overRect` re-measured while dragging. The planner's
 * DndContext therefore REQUIRES `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}`
 * — pairing a live pointer with a drag-start rect (dnd-kit's default WhileDragging strategy) is
 * off by whatever the hours-scroll container has scrolled since the drag began.
 *
 * The tempting mirror-image — a drag-start-frame pointer with a drag-start rect, letting the two
 * stale offsets cancel — does NOT hold: dnd-kit's `delta` swaps the scrollable ancestors it adjusts
 * for (active node's → over node's) the moment a column is entered while its offset baseline stays
 * put, so the "cancellation" breaks exactly when the drag reaches the grid.
 */
export function dayDropFromOver({ overData, overRect, pointerY }: {
  overData: unknown;
  overRect: { top: number; height: number } | null;
  pointerY: number | null;
}): DayDropTarget | null {
  if (!overData || typeof overData !== 'object') return null;
  const d = overData as Partial<DayColumnDropData>;
  if (d.type !== 'day-col' || typeof d.dayIndex !== 'number' || typeof d.dayStartMs !== 'number') return null;
  if (overRect === null || pointerY === null) return null;
  const fraction = overRect.height > 0 ? (pointerY - overRect.top) / overRect.height : 0;
  return { dayIndex: d.dayIndex, dayStartMs: d.dayStartMs, startMin: snapClickToSlot(fraction) };
}

/**
 * ISO start/end for the pinned block a dropped task creates: at least 15 minutes, never longer
 * than the day window, and pulled back so it cannot spill past the end of the column.
 */
export function pinnedBlockTimes({ durationMs, dayStartMs, startMin }: {
  durationMs: number;
  dayStartMs: number;
  startMin: number;
}): { startsAt: string; endsAt: string } {
  const windowSpan = WINDOW_END_MIN - WINDOW_START_MIN;
  const durationMin = Math.min(Math.max(15, Math.round(durationMs / 60_000)), windowSpan);
  const { startMin: s, endMin: e } = clampToWindow(startMin, durationMin);
  return {
    startsAt: new Date(dayStartMs + s * 60_000).toISOString(),
    endsAt: new Date(dayStartMs + e * 60_000).toISOString(),
  };
}
