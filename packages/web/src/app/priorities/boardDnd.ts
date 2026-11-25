import type { Task, UpdateTaskInput } from '../../api/types';
import { type BucketKey, type BoardColumnKey, bucketToPriority, columnMeta, insertionSortOrder, priorityToBucket } from './priorityBucket';

/** Column droppables are prefixed so a drop id is unambiguously a column, not a card. */
export const COLUMN_DROPPABLE_PREFIX = 'col:';

export function columnDroppableId(key: BoardColumnKey): string {
  return `${COLUMN_DROPPABLE_PREFIX}${key}`;
}

export interface BoardDropColumn {
  key: BoardColumnKey;
  tasks: { id: string }[];
}

export interface BoardDrop {
  taskId: string;
  to: BoardColumnKey;
  index: number;
}

/** Which column a dnd-kit `over.id` names — the column itself, or the column holding that card. */
export function overColumnKey(columns: BoardDropColumn[], overId: string | null): BoardColumnKey | null {
  if (overId === null) return null;
  if (overId.startsWith(COLUMN_DROPPABLE_PREFIX)) {
    const key = overId.slice(COLUMN_DROPPABLE_PREFIX.length);
    return columns.some((c) => c.key === key) ? (key as BoardColumnKey) : null;
  }
  return columns.find((c) => c.tasks.some((t) => t.id === overId))?.key ?? null;
}

/**
 * What a drag announcement should call the thing under the pointer: a container droppable is "the
 * High priority column", anything else is the card's own title (`null` when the caller's title
 * lookup does not know it either, leaving it to fall back to the raw id).
 *
 * Only `col:`-prefixed ids may take the column branch. `overColumnKey` deliberately resolves a CARD
 * id to the column holding it — right for a drop, fatal for an announcement: every card in a column
 * would produce the same sentence, and dnd-kit's live region is `useState`-backed and aria-atomic,
 * so an announcement identical to the previous one mutates no DOM and is never spoken. Naming cards
 * by their column made a within-column keyboard reorder silent from the second arrow key onwards.
 */
export function boardDropTargetName(
  columns: BoardDropColumn[],
  overId: string,
  titleOf: (id: string) => string | null,
): string | null {
  if (!overId.startsWith(COLUMN_DROPPABLE_PREFIX)) return titleOf(overId);
  const key = overColumnKey(columns, overId);
  return key ? `the ${columnMeta(key).label} column` : null;
}

export type BoardArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function isBoardArrowKey(key: string): key is BoardArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * The board's keyboard model (prototype `interactions.md §2`): with a card's grip focused, ↑/↓
 * swap it with its neighbour and ←/→ move it to the neighbouring *rendered* column at the same
 * position (clamped to that column's length). No lift/drop step — each key press is a move.
 *
 * Driven by column order rather than by geometry: dnd-kit's rect-based keyboard getter could not
 * reach an empty column (no card to aim at), and on the first card of a column ArrowUp landed on
 * the column container and sent the card to the bottom. Completed is neither a source (its cards
 * have no grip) nor a target (it rejects drops), so ←/→ stop at Backlog.
 *
 * Returns a `BoardDrop` in `resolveBoardDrop`'s contract (index into the target column as
 * rendered, still counting the moving card when it is its own column), or null at an edge.
 */
export function keyboardMove(columns: BoardDropColumn[], taskId: string, key: BoardArrowKey): BoardDrop | null {
  const from = columns.find((c) => c.tasks.some((t) => t.id === taskId));
  if (!from || from.key === 'completed') return null;
  const i = from.tasks.findIndex((t) => t.id === taskId);

  if (key === 'ArrowUp') return i > 0 ? { taskId, to: from.key, index: i - 1 } : null;
  if (key === 'ArrowDown') return i < from.tasks.length - 1 ? { taskId, to: from.key, index: i + 2 } : null;

  const droppable = columns.filter((c) => c.key !== 'completed');
  const target = droppable[droppable.indexOf(from) + (key === 'ArrowLeft' ? -1 : 1)];
  if (!target) return null;
  return { taskId, to: target.key, index: Math.min(i, target.tasks.length) };
}

/** The 1-based slot a drop leaves the card in, as the board will show it after the move. */
export function dropPosition(columns: BoardDropColumn[], drop: BoardDrop): number {
  const sourceIndex = columns.find((c) => c.key === drop.to)?.tasks.findIndex((t) => t.id === drop.taskId) ?? -1;
  return (sourceIndex !== -1 && sourceIndex < drop.index ? drop.index - 1 : drop.index) + 1;
}

/** The live-region sentence for a finished move: "Moved Write spec to High priority, position 2." */
export function moveAnnouncement(title: string, to: BoardColumnKey, position: number): string {
  return `Moved ${title} to ${columnMeta(to).label}, position ${position}.`;
}

/**
 * The board after `drop`, for display only: the card leaves its column and lands in its slot.
 * Board renders this from the drop until the task query reflects the move, so nothing snaps back
 * in between (the PATCH and its refetch are asynchronous).
 */
export function applyBoardDrop<C extends { key: BoardColumnKey; tasks: { id: string }[] }>(columns: C[], drop: BoardDrop): C[] {
  const from = columns.find((c) => c.tasks.some((t) => t.id === drop.taskId));
  if (!from) return columns;
  const card = from.tasks.find((t) => t.id === drop.taskId)!;
  const slot = dropPosition(columns, drop) - 1;
  return columns.map((c) => {
    if (c.key !== from.key && c.key !== drop.to) return c;
    const tasks = c.tasks.filter((t) => t.id !== drop.taskId);
    if (c.key === drop.to) tasks.splice(slot, 0, card);
    return { ...c, tasks };
  });
}

/**
 * Turn a dnd-kit drop into the board's existing `(taskId, to, index)` contract, where `index` is
 * the insertion index **in the target column as currently rendered** (i.e. still including the
 * dragged card when the column is its own). `Priorities.onMove` / `taskMovePatch` already handle
 * the off-by-one for that case, so the downstream arithmetic is untouched.
 *
 * A same-column downward drag inserts *after* the hovered card, matching what dnd-kit's live
 * preview showed; an upward drag inserts before it, exactly as the old HTML5 path did.
 *
 * A drop that would not move the card returns null instead of a drop. Every drop PATCHes a fresh
 * midpoint `sortOrder`, which the server answers with a full replan — so releasing a card on
 * itself, or on its own column's empty area when it is already last, must not reach the wire. The
 * keyboard path makes this cheap to hit: Space to lift and Space to drop, with no arrow key in
 * between, is a no-movement drop.
 */
export function resolveBoardDrop(
  columns: BoardDropColumn[],
  activeId: string,
  overId: string | null,
): BoardDrop | null {
  const to = overColumnKey(columns, overId);
  if (to === null || to === 'completed') return null;

  const fromColumn = columns.find((c) => c.tasks.some((t) => t.id === activeId));
  if (!fromColumn) return null;
  const activeIndex = fromColumn.tasks.findIndex((t) => t.id === activeId);

  const target = columns.find((c) => c.key === to)!;
  const sameColumn = fromColumn.key === to;
  const isContainerDrop = overId!.startsWith(COLUMN_DROPPABLE_PREFIX);
  if (isContainerDrop) {
    // "Append to the bottom" is a no-op when the card already is the bottom.
    if (sameColumn && activeIndex === fromColumn.tasks.length - 1) return null;
    return { taskId: activeId, to, index: target.tasks.length };
  }

  const overIndex = target.tasks.findIndex((t) => t.id === overId);
  if (overIndex === -1) return null;
  const index = sameColumn && activeIndex < overIndex ? overIndex + 1 : overIndex;
  if (sameColumn && index === activeIndex) return null;
  return { taskId: activeId, to, index };
}

/**
 * The PATCH a board move produces, or null when the move is a no-op (the completed column rejects
 * drops). Lifted verbatim out of `Priorities.onMove` so the payloads stay testable without a
 * gesture — the shapes are unchanged: `{sortOrder}`, `{priority, sortOrder}`,
 * `{status:'backlog', sortOrder}`, `{status:'pending', priority, sortOrder}`.
 */
export function taskMovePatch({ taskId, task, to, index, columnTasks }: {
  taskId: string;
  task: Pick<Task, 'priority' | 'status'>;
  to: BoardColumnKey;
  index: number;
  columnTasks: Pick<Task, 'id' | 'sortOrder'>[];
}): UpdateTaskInput | null {
  if (to === 'completed') return null;

  const sourceIndex = columnTasks.findIndex((x) => x.id === taskId);
  const adjustedIndex = sourceIndex !== -1 && sourceIndex < index ? index - 1 : index;
  const neighbors = columnTasks.filter((x) => x.id !== taskId);
  const sortOrder = insertionSortOrder(neighbors, adjustedIndex);

  if (to === 'backlog') return { status: 'backlog', sortOrder };

  const targetBucket = to as BucketKey;
  const patch: UpdateTaskInput = { sortOrder };
  if (priorityToBucket(task.priority) !== targetBucket) patch.priority = bucketToPriority(targetBucket);
  if (task.status === 'backlog' || task.status === 'completed') patch.status = 'pending';
  return patch;
}
