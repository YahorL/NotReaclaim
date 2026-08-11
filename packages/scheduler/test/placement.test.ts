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

describe('placeItem gapMs', () => {
  it('reserves the gap after each placement so the next chunk starts gap later', () => {
    const res = placeItem([{ start: 0, end: 100 }], [20, 20], 100, undefined, 10);
    expect(res.placements).toEqual([{ start: 0, end: 20 }, { start: 30, end: 50 }]);
  });
  it('is unchanged when gapMs is 0 / omitted (regression)', () => {
    const res = placeItem([{ start: 0, end: 100 }], [20, 20], 100);
    expect(res.placements).toEqual([{ start: 0, end: 20 }, { start: 20, end: 40 }]);
  });

  it('reserves the gap on both sides of a placement', () => {
    const H = 3_600_000;
    const G = 900_000;
    const free = [{ start: 9 * H, end: 18 * H }];
    const res = placeItem(free, [H], 24 * H, undefined, G);
    expect(res.placements).toEqual([{ start: 9 * H, end: 10 * H }]);
    // leading side is clipped by the interval edge; trailing side reserved:
    expect(res.free).toEqual([{ start: 10 * H + G, end: 18 * H }]);
  });

  it('keeps a later placement from touching an earlier one from the left', () => {
    const H = 3_600_000;
    const G = 900_000;
    const free = [{ start: 9 * H, end: 18 * H }];
    // First: confined to 12:00+ via candidate window.
    const first = placeItem(free, [H], 24 * H, [{ start: 12 * H, end: 18 * H }], G);
    expect(first.placements[0]).toEqual({ start: 12 * H, end: 13 * H });
    // Second: unconstrained — earliest slot must END by 12:00 − 15m.
    const second = placeItem(first.free, [2 * H], 24 * H, undefined, G);
    expect(second.placements[0]).toEqual({ start: 9 * H, end: 11 * H });
    expect(first.free[0]!.end).toBe(12 * H - G); // leading gap reserved
  });
});
