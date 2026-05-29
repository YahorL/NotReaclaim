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

describe('scheduleHabit with allowedWindows (hard restriction)', () => {
  it('places within preferred ∩ allowed', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 100, end: 200 }],
      preferredWindows: [{ start: 150, end: 300 }],
    }));
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 150, end: 180 },
    ]);
  });

  it('falls back to allowed (not outside) when preferred does not fit', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 0, end: 200 }],
      preferredWindows: [{ start: 0, end: 20 }],
    }));
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
  });

  it('leaves an occurrence unscheduled rather than placing outside allowedWindows', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 500, end: 520 }],
    }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]).toMatchObject({ sourceId: 'h1', remainingMs: 30 });
  });

  it('does not place a second occurrence outside the allowed window', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      allowedWindows: [{ start: 0, end: 40 }],
    }));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
    expect(result.unscheduled[0]).toMatchObject({ remainingMs: 30 });
  });

  it('schedules nothing when allowedWindows is empty', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({ perPeriod: 1, allowedWindows: [] }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled[0]).toMatchObject({ sourceId: 'h1', remainingMs: 30 });
  });
});

describe('scheduleHabit with periodTargets (per-period counts)', () => {
  it("uses periodTargets[i] as each period's occurrence count", () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 3,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [1, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(1);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('places nothing in a period whose target is 0', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      periods: [{ start: 0, end: 500 }, { start: 500, end: 1000 }],
      periodTargets: [0, 2],
    }));
    expect(result.blocks.filter((b) => b.start < 500)).toHaveLength(0);
    expect(result.blocks.filter((b) => b.start >= 500)).toHaveLength(2);
  });

  it('falls back to perPeriod when periodTargets is absent (unchanged behavior)', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2, periods: [{ start: 0, end: 1000 }] }));
    expect(result.blocks).toHaveLength(2);
  });
});
