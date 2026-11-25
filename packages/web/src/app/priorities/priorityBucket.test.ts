import { describe, it, expect } from 'vitest';
import type { SchedulePreview } from '../../api/types';
import { priorityToBucket, bucketToPriority, relativeDayTimeLabel, dueShort, dueLabel, nextBlockMsForTask, BUCKETS, sortBucket, insertionSortOrder } from './priorityBucket';

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
    expect(relativeDayTimeLabel(Date.parse('2026-01-07T17:00:00.000Z'), NOW, 'UTC')).toBe('Today 5:00 PM');
    expect(relativeDayTimeLabel(Date.parse('2026-01-08T09:30:00.000Z'), NOW, 'UTC')).toBe('Tomorrow 9:30 AM');
    expect(relativeDayTimeLabel(Date.parse('2026-01-10T08:15:00.000Z'), NOW, 'UTC')).toBe('Sat 8:15 AM');
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
  it('sorts undated tasks after dated ones at the same sortOrder', () => {
    const tasks = [
      { id: 'undated', sortOrder: 1, dueBy: null },
      { id: 'dated', sortOrder: 1, dueBy: '2026-01-09T10:00:00.000Z' },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('keeps sortOrder ahead of datedness', () => {
    const tasks = [
      { id: 'dated', sortOrder: 2, dueBy: '2026-01-09T10:00:00.000Z' },
      { id: 'undated', sortOrder: 1, dueBy: null },
    ];
    expect(sortBucket(tasks).map((t) => t.id)).toEqual(['undated', 'dated']);
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

describe('relativeDayTimeLabel in the settings zone', () => {
  const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wed 07:00 in New York, Wed 21:00 in Tokyo
  it('New York: day and time are read in the settings zone', () => {
    // 02:00Z on Jan 8 is 21:00 on Jan 7 in New York.
    expect(relativeDayTimeLabel(Date.parse('2026-01-08T02:00:00.000Z'), NOW, 'America/New_York')).toBe('Today 9:00 PM');
    // 03:00Z on Sat Jan 10 is Fri 22:00 in New York.
    expect(relativeDayTimeLabel(Date.parse('2026-01-10T03:00:00.000Z'), NOW, 'America/New_York')).toBe('Fri 10:00 PM');
  });
  it('Tokyo: an afternoon UTC time is already tomorrow', () => {
    expect(relativeDayTimeLabel(Date.parse('2026-01-07T16:00:00.000Z'), NOW, 'Asia/Tokyo')).toBe('Tomorrow 1:00 AM');
  });
  it('DST: tomorrow across the New York spring-forward night', () => {
    const satNoon = Date.parse('2026-03-07T17:00:00.000Z'); // Sat 12:00 EST
    expect(relativeDayTimeLabel(Date.parse('2026-03-09T03:30:00.000Z'), satNoon, 'America/New_York')).toBe('Tomorrow 11:30 PM');
  });
});

describe('due labels in the settings zone', () => {
  it('dueShort reads the month/day in the zone', () => {
    expect(dueShort('2026-01-09T02:00:00.000Z', 'UTC')).toBe('Due 1/9');
    expect(dueShort('2026-01-09T02:00:00.000Z', 'America/New_York')).toBe('Due 1/8');
    expect(dueShort('2026-01-08T16:00:00.000Z', 'Asia/Tokyo')).toBe('Due 1/9');
    expect(dueShort(null, 'UTC')).toBe('No deadline');
  });
  it('dueLabel reads the month/day in the zone', () => {
    expect(dueLabel('2026-01-10T11:30:00.000Z', 'Pacific/Auckland')).toBe('Due Jan 11');
    expect(dueLabel('2026-01-10T03:00:00.000Z', 'America/New_York')).toBe('Due Jan 9');
    expect(dueLabel(null, 'UTC')).toBeNull();
  });
});
