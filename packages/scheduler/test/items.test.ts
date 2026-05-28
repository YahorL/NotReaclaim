import { describe, it, expect } from 'vitest';
import { scheduleTask } from '../src/items.js';
import type { FlexibleTask } from '../src/types.js';

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
