import { describe, it, expect } from 'vitest';
import { splitDuration } from '../src/placement.js';

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
});
