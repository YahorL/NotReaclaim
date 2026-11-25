import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';

/** Maps a dnd-kit id to something a person would say. `null` means "no better name than the id". */
export type NameLookup = (id: string) => string | null;

/**
 * dnd-kit's stock announcements read the raw draggable id — on this board that is a cuid, so a
 * screen-reader user hears "Picked up draggable item cm4x8…". These say the task's title and the
 * column's or day's name instead.
 */
export function makeAnnouncements(name: NameLookup, dropTargetName: NameLookup): Announcements {
  const of = (id: string | number) => name(String(id)) ?? String(id);
  const target = (id: string | number) => dropTargetName(String(id)) ?? String(id);
  return {
    onDragStart: ({ active }) => `Picked up ${of(active.id)}.`,
    onDragOver: ({ active, over }) => (over
      ? `${of(active.id)} is over ${target(over.id)}.`
      : `${of(active.id)} is not over a drop target.`),
    onDragEnd: ({ active, over }) => (over
      ? `${of(active.id)} was dropped on ${target(over.id)}.`
      : `${of(active.id)} was dropped where it started.`),
    onDragCancel: ({ active }) => `Moving ${of(active.id)} was cancelled.`,
  };
}

/**
 * The same treatment for a task's subtask list (board card and edit drawer). The only drop
 * targets are the other subtasks, and a sortable drop lands the item at the hovered item's index
 * (`subtaskDropSortOrder`), so targets are read as that position — "Draft is over position 3 of
 * 4." Positions also keep consecutive messages distinct: dnd-kit's live region is aria-atomic and
 * state-backed, so a sentence identical to the previous one is never spoken (see
 * `boardDropTargetName`). `subtasks` must be in rendered order — the array the SortableContext gets.
 */
export function makeSubtaskAnnouncements(subtasks: { id: string; title: string }[], taskTitle: string): Announcements {
  const n = subtasks.length;
  const indexOf = (id: string | number) => subtasks.findIndex((s) => s.id === String(id));
  const of = (id: string | number) => subtasks[indexOf(id)]?.title ?? String(id);
  const position = (id: string | number) => {
    const i = indexOf(id);
    return i === -1 ? String(id) : `position ${i + 1} of ${n}`;
  };
  return {
    onDragStart: ({ active }) => (indexOf(active.id) === -1
      ? `Picked up ${of(active.id)}.`
      : `Picked up ${of(active.id)}, ${position(active.id)} in ${taskTitle}.`),
    onDragOver: ({ active, over }) => (over
      ? `${of(active.id)} is over ${position(over.id)}.`
      : `${of(active.id)} is not over a drop target.`),
    onDragEnd: ({ active, over }) => (over && over.id !== active.id
      ? `${of(active.id)} was dropped at ${position(over.id)} in ${taskTitle}.`
      : `${of(active.id)} was dropped where it started.`),
    onDragCancel: ({ active }) => `Moving ${of(active.id)} was cancelled.`,
  };
}

/**
 * For drag surfaces with no KeyboardSensor. dnd-kit's default text promises "press the space bar
 * to pick up", which the planner's drag-to-schedule does not implement (day columns have no
 * keyboard coordinate story — see `useDragToScheduleSensors`).
 */
export const POINTER_ONLY_DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Drag a task onto a day column to schedule it. Dragging here works with a pointer or touch only.',
};
