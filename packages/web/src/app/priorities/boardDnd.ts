import type { DroppableContainer, DroppableContainers, KeyboardCoordinateGetter, UniqueIdentifier } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
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

/**
 * The board's ArrowUp/ArrowDown getter: `sortableKeyboardCoordinates`, but blind to the `col:*`
 * container droppables.
 *
 * The stock getter keeps every enabled droppable whose rect merely lies in the arrow's direction
 * (`collisionRect.top > rect.top` for ArrowUp), and a column's rect starts above every card it
 * holds — so a column is always a candidate. On the *first* card of a column that is fatal: no card
 * is above it, the column is the only survivor, `closestCorners` returns it, and the overlay jumps
 * to the column header while `over` becomes `col:<key>` — which `resolveBoardDrop`'s container
 * branch reads as "append to the bottom of this column". ArrowUp on the top card silently sent it
 * to the bottom.
 *
 * Dropping the containers from the *candidate* set fixes it without touching their droppable state:
 * pointer drops still need the column rect to land in a column's empty area, and ArrowUp on the
 * first card now correctly does nothing.
 *
 * Known limitation: with the containers filtered out, a keyboard drag can only ever land on a card,
 * so an EMPTY column is unreachable by keyboard (it has no cards to aim at). Accepted — the board
 * was 0% keyboard-accessible before this getter existed, and the alternative (keeping columns as
 * candidates) silently teleports the top card of every column to the bottom on ArrowUp.
 *
 * The filtered collection is rebuilt through `droppableContainers.constructor` rather than a plain
 * `Map`, because the getter calls `getEnabled()` and `get()` on it — dnd-kit's own reducer clones
 * the collection the same way (`new DroppableContainersMap(state.droppable.containers)`), so this
 * is the library's idiom rather than a workaround.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const containers = args.context.droppableContainers;
  const cardsOnly = Array.from(containers.entries())
    .filter(([id]) => !String(id).startsWith(COLUMN_DROPPABLE_PREFIX));
  const CollectionCtor = containers.constructor as unknown as
    new (entries: Iterable<[UniqueIdentifier, DroppableContainer]>) => DroppableContainers;

  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: new CollectionCtor(cardsOnly) },
  });
};

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
