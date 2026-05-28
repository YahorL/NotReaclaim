import { describe, it, expect } from 'vitest';
import { scheduleTask } from '../src/items.js';
import type { FlexibleTask } from '../src/types.js';
import { scheduleHabit } from '../src/items.js';
import type { Habit } from '../src/types.js';

const task = (over: Partial<FlexibleTask> = {}): FlexibleTask => ({
  id: 't1',
  title: 'Write report',
  priority: 1,
  durationMs: 60,
  dueBy: 1000,
  minChunkMs: 15,
  maxChunkMs: 30,
  ...over,
});

describe('scheduleTask', () => {
  it('places chunks and returns blocks with deterministic ids', () => {
    const free = [{ start: 0, end: 100 }];
    const result = scheduleTask(free, task());
    expect(result.blocks).toEqual([
      { id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 0, end: 30 },
      { id: 'task:t1:1', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
    expect(result.free).toEqual([{ start: 60, end: 100 }]);
  });

  it('reports unplaced time when free space runs out before the due date', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleTask(free, task({ durationMs: 60 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'task',
        sourceId: 't1',
        title: 'Write report',
        reason: 'insufficient free time before due date',
        remainingMs: 30,
      },
    ]);
  });
});

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Exercise',
  priority: 2,
  chunkMs: 30,
  perPeriod: 2,
  periods: [{ start: 0, end: 1000 }],
  ...over,
});

describe('scheduleHabit', () => {
  it('places perPeriod occurrences within the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit());
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 0, end: 30 },
      { id: 'habit:h1:1', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('prefers preferredWindows but falls back to any free time in the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(
      free,
      habit({ perPeriod: 1, preferredWindows: [{ start: 500, end: 600 }] }),
    );
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 500, end: 530 },
    ]);
  });

  it('falls back to free time in the period when preferred windows lie outside it', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(
      free,
      habit({ perPeriod: 1, periods: [{ start: 0, end: 100 }], preferredWindows: [{ start: 500, end: 600 }] }),
    );
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 0, end: 30 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('reports missed occurrences when free time is exhausted', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'habit',
        sourceId: 'h1',
        title: 'Exercise',
        reason: 'could not place all habit occurrences in free time',
        remainingMs: 30,
      },
    ]);
  });
});
