import { arrayMove } from '@dnd-kit/sortable';
import { insertionSortOrder } from '../priorities/priorityBucket';

export interface SortOrdered {
  id: string;
  sortOrder: number;
}

/**
 * The `sortOrder` to PATCH after a sortable drop, or null when nothing moved.
 *
 * Semantics follow dnd-kit rather than the old HTML5 handlers: the dragged item lands exactly
 * where the live preview put it (`arrayMove(from, to)`), so an upward drag lands above the hovered
 * row and a downward drag lands below it. The value itself is the midpoint of the item's new
 * neighbours, which keeps the existing sparse-`sortOrder` scheme and its server contract intact.
 */
export function subtaskDropSortOrder<T extends SortOrdered>(
  items: T[],
  activeId: string,
  overId: string,
): number | null {
  const from = items.findIndex((i) => i.id === activeId);
  const to = items.findIndex((i) => i.id === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const moved = arrayMove(items, from, to);
  const at = moved.findIndex((i) => i.id === activeId);
  // Removing the dragged item shifts everything after it left by one, so its index in `moved` is
  // also its insertion index among the remaining items.
  const others = moved.filter((i) => i.id !== activeId);
  return insertionSortOrder(others, at);
}
