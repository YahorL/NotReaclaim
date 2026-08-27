import { describe, it, expect } from 'vitest';
import { dayDropFromOver, draggedTaskId, pinnedBlockTimes, PANEL_TASK_DRAG_TYPE } from './scheduleDrop';

const DAY = Date.parse('2026-01-07T00:00:00.000Z');
const dayCol = { type: 'day-col', dayIndex: 2, dayStartMs: DAY };

describe('draggedTaskId', () => {
  it('reads the task id off a panel-task drag', () => {
    expect(draggedTaskId({ type: PANEL_TASK_DRAG_TYPE, taskId: 't1' })).toBe('t1');
  });

  it('is null for any other drag payload', () => {
    expect(draggedTaskId({ type: 'sortable' })).toBeNull();
    expect(draggedTaskId(undefined)).toBeNull();
    expect(draggedTaskId(null)).toBeNull();
  });
});

describe('dayDropFromOver', () => {
  it('snaps the pointer offset inside the column to a create slot', () => {
    // 1392px column, pointer 348px down = 25% = 06:00.
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: 348 });
    expect(target).toEqual({ dayIndex: 2, dayStartMs: DAY, startMin: 360 });
  });

  it('accounts for the column being scrolled down the page', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 100, height: 1392 }, pointerY: 448 });
    expect(target!.startMin).toBe(360);
  });

  it('clamps a pointer above the column to the first slot', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: -500 });
    expect(target!.startMin).toBe(0);
  });

  it('clamps a pointer below the column to the last slot', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: 9999 });
    expect(target!.startMin).toBe(24 * 60 - 15);
  });

  it('is null when the drag is not over a day column', () => {
    expect(dayDropFromOver({ overData: { type: 'sortable' }, overRect: { top: 0, height: 1392 }, pointerY: 300 })).toBeNull();
    expect(dayDropFromOver({ overData: null, overRect: null, pointerY: 300 })).toBeNull();
  });

  it('is null without pointer coordinates or a measured column', () => {
    expect(dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: null })).toBeNull();
    expect(dayDropFromOver({ overData: dayCol, overRect: null, pointerY: 300 })).toBeNull();
  });
});

describe('pinnedBlockTimes', () => {
  it('places a one-hour task at the dropped slot', () => {
    // Ported from the deleted Planner drop test (jsdom 0-height column => 00:00 slot).
    expect(pinnedBlockTimes({ durationMs: 3_600_000, dayStartMs: DAY, startMin: 0 })).toEqual({
      startsAt: '2026-01-07T00:00:00.000Z',
      endsAt: '2026-01-07T01:00:00.000Z',
    });
  });

  it('pulls a block back so it never runs past the end of the day', () => {
    expect(pinnedBlockTimes({ durationMs: 3_600_000, dayStartMs: DAY, startMin: 23 * 60 + 45 })).toEqual({
      startsAt: '2026-01-07T23:00:00.000Z',
      endsAt: '2026-01-08T00:00:00.000Z',
    });
  });

  it('floors a sub-15-minute task at 15 minutes', () => {
    const { startsAt, endsAt } = pinnedBlockTimes({ durationMs: 60_000, dayStartMs: DAY, startMin: 600 });
    expect(Date.parse(endsAt) - Date.parse(startsAt)).toBe(15 * 60_000);
  });
});
