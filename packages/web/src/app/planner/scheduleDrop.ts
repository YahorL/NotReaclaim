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
 * Which day column and which 15-minute slot a drag is currently over. Uses the same
 * fraction → `snapClickToSlot` maths the grid's click-to-create has always used, so a dropped card
 * and a tapped slot land on identical times.
 *
 * `pointerY` MUST be a live viewport reading from a `pointermove`/`touchmove` listener
 * (`useLivePointerY`), never dnd-kit's `activatorEvent + delta`: that pair is in the drag-START
 * frame of reference and jumps by a container's scrollTop the moment a droppable is entered (see
 * `useLivePointerY` for the mechanism).
 *
 * Pairing it with dnd-kit's `over.rect` is exact even though the rect was measured when the drag
 * began, and needs no `MeasuringStrategy.Always`: droppable rects are instances of dnd-kit's `Rect`
 * class, whose `top`/`bottom` are getters that re-read the scrollable ancestors' current scroll
 * offsets and subtract the drift since measurement. Reading `overRect.top` therefore yields today's
 * viewport coordinate, in the same frame as the live pointer. (`MeasuringStrategy` only feeds
 * dnd-kit's `isDisabled()`, which gates re-measurement OUTSIDE a drag — during one it is inert.)
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
