import { WINDOW_END_MIN, SLOT_MIN, clampToWindow } from './weekModel';

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
 * - ↑/↓: move by one 15-min slot, keeping the length, clamped to the 24h column.
 * - Shift+↑/↓: shorten / lengthen by 15 min (at least one slot, never past the column end).
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
      if (shift) {
        const endMin = Math.min(WINDOW_END_MIN, Math.max(cur.startMin + SLOT_MIN, cur.endMin + dir * SLOT_MIN));
        return { ...cur, endMin };
      }
      const moved = clampToWindow(cur.startMin + dir * SLOT_MIN, length);
      return { dayIndex: cur.dayIndex, startMin: moved.startMin, endMin: moved.endMin };
    }
    case 'ArrowLeft':
      return cur.dayIndex <= 0 ? { edge: 'left' } : { ...cur, dayIndex: cur.dayIndex - 1 };
    case 'ArrowRight':
      return cur.dayIndex >= dayCount - 1 ? { edge: 'right' } : { ...cur, dayIndex: cur.dayIndex + 1 };
    default:
      return null;
  }
}
