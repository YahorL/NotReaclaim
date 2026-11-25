import { describe, it, expect } from 'vitest';
import { keyboardChange } from './blockKeyboard';
import { WINDOW_END_MIN } from './weekModel';

const cur = { dayIndex: 2, startMin: 540, endMin: 600 }; // Wed 9:00–10:00 of a 7-day view

describe('keyboardChange', () => {
  it('ArrowUp / ArrowDown move by 15 minutes, keeping the length', () => {
    expect(keyboardChange('ArrowUp', false, cur, 7)).toEqual({ dayIndex: 2, startMin: 525, endMin: 585 });
    expect(keyboardChange('ArrowDown', false, cur, 7)).toEqual({ dayIndex: 2, startMin: 555, endMin: 615 });
  });

  it('ArrowLeft / ArrowRight move by one day, keeping the time', () => {
    expect(keyboardChange('ArrowLeft', false, cur, 7)).toEqual({ dayIndex: 1, startMin: 540, endMin: 600 });
    expect(keyboardChange('ArrowRight', false, cur, 7)).toEqual({ dayIndex: 3, startMin: 540, endMin: 600 });
  });

  it('Shift+ArrowUp / Shift+ArrowDown shorten / lengthen by 15 minutes', () => {
    expect(keyboardChange('ArrowUp', true, cur, 7)).toEqual({ dayIndex: 2, startMin: 540, endMin: 585 });
    expect(keyboardChange('ArrowDown', true, cur, 7)).toEqual({ dayIndex: 2, startMin: 540, endMin: 615 });
  });

  it('never shortens below one 15-minute slot', () => {
    const short = { dayIndex: 2, startMin: 540, endMin: 555 };
    expect(keyboardChange('ArrowUp', true, short, 7)).toEqual(short);
  });

  it('never lengthens past the end of the column', () => {
    const late = { dayIndex: 2, startMin: 1380, endMin: WINDOW_END_MIN };
    expect(keyboardChange('ArrowDown', true, late, 7)).toEqual(late);
  });

  it('clamps a move of a block that fits to the column: the first slot cannot go up, the last cannot go down', () => {
    const first = { dayIndex: 2, startMin: 0, endMin: 60 };
    expect(keyboardChange('ArrowUp', false, first, 7)).toEqual(first);
    // 23:00–24:00 ↓ stays put: a block that fits never crosses the column end (interactions.md §1).
    const last = { dayIndex: 2, startMin: WINDOW_END_MIN - 60, endMin: WINDOW_END_MIN };
    expect(keyboardChange('ArrowDown', false, last, 7)).toEqual(last);
    // An off-grid block near the end is clamped flush to the column end, never past it.
    const nearEnd = { dayIndex: 2, startMin: WINDOW_END_MIN - 65, endMin: WINDOW_END_MIN - 5 };
    expect(keyboardChange('ArrowDown', false, nearEnd, 7)).toEqual(last);
  });

  it('an already-overflowing block in the last start slot cannot go down (only its start is clamped)', () => {
    const lastStart = { dayIndex: 2, startMin: WINDOW_END_MIN - 15, endMin: WINDOW_END_MIN + 45 };
    expect(keyboardChange('ArrowDown', false, lastStart, 7)).toEqual(lastStart);
  });

  it('an overnight block (23:00–07:00) moves by 15 minutes and keeps its 8 hours', () => {
    const night = { dayIndex: 2, startMin: 23 * 60, endMin: 31 * 60 };
    expect(keyboardChange('ArrowDown', false, night, 7)).toEqual({ dayIndex: 2, startMin: 23 * 60 + 15, endMin: 31 * 60 + 15 });
    expect(keyboardChange('ArrowUp', false, night, 7)).toEqual({ dayIndex: 2, startMin: 23 * 60 - 15, endMin: 31 * 60 - 15 });
  });

  it('never moves against the key: an off-grid start in the last slot stays put on ↓', () => {
    const offGrid = { dayIndex: 2, startMin: WINDOW_END_MIN - 10, endMin: WINDOW_END_MIN + 50 };
    expect(keyboardChange('ArrowDown', false, offGrid, 7)).toEqual(offGrid);
  });

  it('Shift+↑/↓ on an overnight block shortens from its real end and never truncates it to the column', () => {
    const night = { dayIndex: 2, startMin: 23 * 60, endMin: 31 * 60 };
    expect(keyboardChange('ArrowUp', true, night, 7)).toEqual({ ...night, endMin: 31 * 60 - 15 });
    // Already past the column end: lengthening is a no-op, never a cut back to 24:00.
    expect(keyboardChange('ArrowDown', true, night, 7)).toEqual(night);
  });

  it('keeps an off-grid start off-grid (a 9:05 block moves to 9:20)', () => {
    expect(keyboardChange('ArrowDown', false, { dayIndex: 0, startMin: 545, endMin: 575 }, 7)).toEqual({ dayIndex: 0, startMin: 560, endMin: 590 });
  });

  it('at the edge of the rendered days reports the edge instead of moving', () => {
    expect(keyboardChange('ArrowLeft', false, { ...cur, dayIndex: 0 }, 7)).toEqual({ edge: 'left' });
    expect(keyboardChange('ArrowRight', false, { ...cur, dayIndex: 6 }, 7)).toEqual({ edge: 'right' });
    expect(keyboardChange('ArrowRight', false, { ...cur, dayIndex: 0 }, 1)).toEqual({ edge: 'right' });
    expect(keyboardChange('ArrowRight', false, { ...cur, dayIndex: 1 }, 3)).toEqual({ dayIndex: 2, startMin: 540, endMin: 600 });
  });

  it('Shift does not change a horizontal move', () => {
    expect(keyboardChange('ArrowRight', true, cur, 7)).toEqual({ dayIndex: 3, startMin: 540, endMin: 600 });
  });

  it('ignores every other key', () => {
    for (const k of ['Enter', ' ', 'Tab', 'Escape', 'a', 'Delete', 'PageDown']) expect(keyboardChange(k, false, cur, 7)).toBeNull();
  });
});
