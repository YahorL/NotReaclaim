import { clampToWindow, snapClickToSlot, SLOT_MIN, WINDOW_SPAN_MIN } from './weekModel';
import { MS_PER_MIN, toIso } from '../lib/time';

/** Marks a drag that started on a task card in the planner side panel / Tasks sheet. */
export const PANEL_TASK_DRAG_TYPE = 'panel-task';

/** dnd-kit id for a task card in the planner panel / Tasks sheet. Prefixed so it can never
 *  collide with a bare task id used elsewhere (the board's sortables are bare ids). */
export function panelTaskDraggableId(taskId: string): string {
  return `panel-task:${taskId}`;
}

export interface PanelTaskDragData {
  type: typeof PANEL_TASK_DRAG_TYPE;
  taskId: string;
}

/** Marks a planner day column as a drop target. */
export const DAY_COLUMN_DROP_TYPE = 'day-col';

/** dnd-kit droppable id for the day column at `dayIndex`. */
export function dayColumnDroppableId(dayIndex: number): string {
  return `${DAY_COLUMN_DROP_TYPE}:${dayIndex}`;
}

/** The day index behind a `dayColumnDroppableId`, or null when `id` is not one. */
export function dayIndexFromDroppableId(id: string): number | null {
  const m = /^day-col:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export interface DayColumnDropData {
  type: typeof DAY_COLUMN_DROP_TYPE;
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
  if (d.type !== DAY_COLUMN_DROP_TYPE || typeof d.dayIndex !== 'number' || typeof d.dayStartMs !== 'number') return null;
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
  const durationMin = Math.min(Math.max(SLOT_MIN, Math.round(durationMs / MS_PER_MIN)), WINDOW_SPAN_MIN);
  const { startMin: s, endMin: e } = clampToWindow(startMin, durationMin);
  return {
    startsAt: toIso(dayStartMs + s * MS_PER_MIN),
    endsAt: toIso(dayStartMs + e * MS_PER_MIN),
  };
}

/**
 * The whole drag-end decision as one pure function: the `createScheduledBlock` payload a released
 * drag produces, or null when it produces nothing (the drag was not a panel task card, it was
 * released outside every day column, or the task has since vanished from the list).
 *
 * Composing `draggedTaskId` + `dayDropFromOver` + `pinnedBlockTimes` here rather than in
 * `Planner.onDragEnd` keeps the only write path of this gesture testable without a synthetic
 * dnd-kit drag: the caller is left with "compute, clear drag state, fire the mutation".
 */
export function scheduleDropResult({ activeData, overData, overRect, pointerY, tasks }: {
  activeData: unknown;
  overData: unknown;
  overRect: { top: number; height: number } | null;
  pointerY: number | null;
  tasks: readonly { id: string; durationMs: number }[];
}): { taskId: string; startsAt: string; endsAt: string } | null {
  const taskId = draggedTaskId(activeData);
  if (taskId === null) return null;
  const target = dayDropFromOver({ overData, overRect, pointerY });
  if (target === null) return null;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  return {
    taskId,
    ...pinnedBlockTimes({ durationMs: task.durationMs, dayStartMs: target.dayStartMs, startMin: target.startMin }),
  };
}
