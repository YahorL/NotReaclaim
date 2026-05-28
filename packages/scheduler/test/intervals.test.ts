import { describe, it, expect } from 'vitest';
import { mergeIntervals, subtractIntervals, intersectIntervals } from '../src/intervals.js';

describe('mergeIntervals', () => {
  it('sorts and merges overlapping and touching intervals, dropping empties', () => {
    const input = [
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 10, end: 20 }, // touches previous -> merges
      { start: 15, end: 18 }, // contained -> merges
      { start: 50, end: 50 }, // empty -> dropped
    ];
    expect(mergeIntervals(input)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });
});

describe('subtractIntervals', () => {
  it('removes busy ranges from base, splitting where needed', () => {
    const base = [{ start: 0, end: 100 }];
    const busy = [
      { start: 20, end: 30 },
      { start: 60, end: 70 },
    ];
    expect(subtractIntervals(base, busy)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
      { start: 70, end: 100 },
    ]);
  });

  it('returns base unchanged when busy does not overlap', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 20, end: 30 }]))
      .toEqual([{ start: 0, end: 10 }]);
  });

  it('returns empty when busy fully covers base', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 0, end: 10 }]))
      .toEqual([]);
  });
});

describe('intersectIntervals', () => {
  it('returns only the overlapping regions', () => {
    const a = [{ start: 0, end: 50 }, { start: 60, end: 100 }];
    const b = [{ start: 40, end: 70 }];
    expect(intersectIntervals(a, b)).toEqual([
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ]);
  });
});
