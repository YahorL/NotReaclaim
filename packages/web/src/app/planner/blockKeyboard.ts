import { SLOT_MIN, moveStartMin, resizeEndMin } from './weekModel';

/** A block's place in the rendered view: column index plus minutes from that column's anchor. */
export interface KeyInterval {
  dayIndex: number;
  startMin: number;
  endMin: number;
}

export type KeyChange = KeyInterval | { edge: 'left' | 'right' };

/**
 * What an arrow key does to a focused movable block (spec §5.2 Keyboard). Pure: the block applies
 * the result as an instant preview and commits it (debounced) through the same path as a drag.
 *
 * - ↑/↓: move by one 15-min slot, keeping the length. Only the START is clamped to the column; the
 *   end may run past it (an overnight block keeps its hours — `moveStartMin`).
 * - Shift+↑/↓: shorten / lengthen by 15 min (at least one slot, never grown past the column end,
 *   never cut back to it either — `resizeEndMin`).
 * - ←/→: one day, keeping the time; at the edge of the rendered days → `{ edge }` (the caller
 *   hints at the paging arrows instead of paging under the user's focus — Q4 default).
 * - anything else → null.
 *
 * A clamped no-op returns the interval unchanged.
 */
export function keyboardChange(key: string, shift: boolean, cur: KeyInterval, dayCount: number): KeyChange | null {
  const length = cur.endMin - cur.startMin;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const dir = key === 'ArrowUp' ? -1 : 1;
      if (shift) return { ...cur, endMin: resizeEndMin(cur.startMin, cur.endMin, dir * SLOT_MIN) };
      const startMin = moveStartMin(cur.startMin, dir * SLOT_MIN);
      return { dayIndex: cur.dayIndex, startMin, endMin: startMin + length };
    }
    case 'ArrowLeft':
      return cur.dayIndex <= 0 ? { edge: 'left' } : { ...cur, dayIndex: cur.dayIndex - 1 };
    case 'ArrowRight':
      return cur.dayIndex >= dayCount - 1 ? { edge: 'right' } : { ...cur, dayIndex: cur.dayIndex + 1 };
    default:
      return null;
  }
}
