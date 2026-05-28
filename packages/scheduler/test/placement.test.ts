import { describe, it, expect } from 'vitest';
import { splitDuration } from '../src/placement.js';
import { placeItem } from '../src/placement.js';

describe('splitDuration', () => {
  it('returns a single chunk when duration fits in maxChunk', () => {
    expect(splitDuration(20, 15, 30)).toEqual([20]);
  });

  it('splits evenly into the fewest chunks not exceeding maxChunk', () => {
    expect(splitDuration(60, 15, 30)).toEqual([30, 30]);
    expect(splitDuration(90, 15, 30)).toEqual([30, 30, 30]);
  });

  it('distributes a non-divisible total as evenly as possible (sums exactly)', () => {
    const chunks = splitDuration(50, 15, 30);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(50);
    expect(chunks).toEqual([25, 25]);
  });

  it('returns empty for non-positive duration', () => {
    expect(splitDuration(0, 15, 30)).toEqual([]);
  });

  it('never exceeds maxChunkMs even when min and max conflict', () => {
    const chunks = splitDuration(35, 30, 30);
    expect(chunks.every((c) => c <= 30)).toBe(true);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(35);
  });
});

describe('placeItem', () => {
  it('places chunks into the earliest free slots and shrinks free time', () => {
    const free = [{ start: 0, end: 100 }];
    const result = placeItem(free, [30, 30], 100);
    expect(result.placements).toEqual([
      { start: 0, end: 30 },
      { start: 30, end: 60 },
    ]);
    expect(result.unplaced).toEqual([]);
    expect(result.free).toEqual([{ start: 60, end: 100 }]);
  });

  it('does not place a chunk that would end after the deadline', () => {
    const free = [{ start: 0, end: 100 }];
    const result = placeItem(free, [30], 20);
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([30]);
    expect(result.free).toEqual([{ start: 0, end: 100 }]);
  });

  it('restricts placement to candidate windows when provided', () => {
    const free = [{ start: 0, end: 100 }];
    const candidates = [{ start: 40, end: 100 }];
    const result = placeItem(free, [30], 100, candidates);
    expect(result.placements).toEqual([{ start: 40, end: 70 }]);
    expect(result.free).toEqual([{ start: 0, end: 40 }, { start: 70, end: 100 }]);
  });

  it('reports chunks that do not fit as unplaced', () => {
    const free = [{ start: 0, end: 40 }];
    const result = placeItem(free, [30, 30], 1000);
    expect(result.placements).toEqual([{ start: 0, end: 30 }]);
    expect(result.unplaced).toEqual([30]);
  });
});
