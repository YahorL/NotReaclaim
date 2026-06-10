import { describe, it, expect } from 'vitest';
import type { SchedulePreview } from '../../api/types';
import { priorityToBucket, bucketToPriority, relativeDayTimeLabel, nextBlockMsForTask, BUCKETS, sortBucket, insertionSortOrder } from './priorityBucket';

describe('priorityToBucket', () => {
  it('maps priority numbers to buckets', () => {
    expect(priorityToBucket(0)).toBe('critical');
    expect(priorityToBucket(1)).toBe('critical');
    expect(priorityToBucket(2)).toBe('high');
    expect(priorityToBucket(3)).toBe('medium');
    expect(priorityToBucket(4)).toBe('low');
    expect(priorityToBucket(9)).toBe('low');
  });
  it('bucketToPriority round-trips', () => {
    for (const b of BUCKETS) expect(priorityToBucket(bucketToPriority(b))).toBe(b);
  });
});

describe('relativeDayTimeLabel', () => {
  const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday
  it('uses Today / Tomorrow / weekday (TZ=UTC)', () => {
    expect(relativeDayTimeLabel(Date.parse('2026-01-07T17:00:00.000Z'), NOW)).toBe('Today 5:00pm');
    expect(relativeDayTimeLabel(Date.parse('2026-01-08T09:30:00.000Z'), NOW)).toBe('Tomorrow 9:30am');
    expect(relativeDayTimeLabel(Date.parse('2026-01-10T08:15:00.000Z'), NOW)).toBe('Sat 8:15am');
  });
});

describe('sortBucket', () => {
  it('orders tasks by sortOrder then dueBy', () => {
    const tasks = [
      { id: 'c', sortOrder: 3, dueBy: '2026-01-07T10:00:00.000Z' },
      { id: 'a', sortOrder: 1, dueBy: '2026-01-09T10:00:00.000Z' },
      { id: 'b', sortOrder: 2, dueBy: '2026-01-05T10:00:00.000Z' },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('breaks sortOrder ties by dueBy', () => {
    const tasks = [
      { id: 'late', sortOrder: 1, dueBy: '2026-01-09T10:00:00.000Z' },
      { id: 'early', sortOrder: 1, dueBy: '2026-01-05T10:00:00.000Z' },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['early', 'late']);
  });
  it('does not mutate the original array', () => {
    const tasks = [
      { id: 'b', sortOrder: 2, dueBy: '2026-01-05T10:00:00.000Z' },
      { id: 'a', sortOrder: 1, dueBy: '2026-01-05T10:00:00.000Z' },
    ];
    const orig = [...tasks];
    sortBucket(tasks);
    expect(tasks).toEqual(orig);
  });
});

describe('insertionSortOrder', () => {
  const sorted = [{ sortOrder: 2 }, { sortOrder: 4 }, { sortOrder: 6 }];
  it('returns midpoint when inserting between two items', () => {
    expect(insertionSortOrder(sorted, 1)).toBe(3); // between 2 and 4
    expect(insertionSortOrder(sorted, 2)).toBe(5); // between 4 and 6
  });
  it('inserts at top: sortOrder of first item minus 1', () => {
    expect(insertionSortOrder(sorted, 0)).toBe(1); // 2 - 1
  });
  it('inserts at bottom: sortOrder of last item plus 1', () => {
    expect(insertionSortOrder(sorted, 3)).toBe(7); // 6 + 1
  });
  it('handles empty list', () => {
    expect(insertionSortOrder([], 0)).toBe(0);
  });
  it('clamps out-of-range index to bounds', () => {
    expect(insertionSortOrder(sorted, -5)).toBe(1);   // clamps to 0 → top
    expect(insertionSortOrder(sorted, 100)).toBe(7);  // clamps to length → bottom
  });
});

describe('nextBlockMsForTask', () => {
  const preview: SchedulePreview = {
    blocks: [
      { id: 'a', sourceType: 'task', sourceId: 't1', title: 'A', start: 300, end: 400 },
      { id: 'b', sourceType: 'task', sourceId: 't1', title: 'A', start: 100, end: 200 },
      { id: 'c', sourceType: 'habit', sourceId: 't1', title: 'H', start: 50, end: 80 },
    ],
    unscheduled: [],
  };
  it('returns the soonest matching task block', () => {
    expect(nextBlockMsForTask('t1', preview)).toBe(100);
  });
  it('returns null when no task block matches or preview is undefined', () => {
    expect(nextBlockMsForTask('zzz', preview)).toBeNull();
    expect(nextBlockMsForTask('t1', undefined)).toBeNull();
  });
});
