import { describe, it, expect } from 'vitest';
import type { SchedulePreview } from '../../api/types';
import { priorityToBucket, bucketToPriority, relativeDayTimeLabel, nextBlockMsForTask, BUCKETS } from './priorityBucket';

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
