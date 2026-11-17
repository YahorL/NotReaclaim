import { describe, it, expect } from 'vitest';
import { splitDuration } from '../src/placement.js';
import { placeItem } from '../src/placement.js';

describe('splitDuration', () => {
  it('returns a single chunk when duration fits in maxChunk', () => {
    expect(splitDuration(20, 30)).toEqual([20]);
  });

  it('splits evenly into the fewest chunks not exceeding maxChunk', () => {
    expect(splitDuration(60, 30)).toEqual([30, 30]);
    expect(splitDuration(90, 30)).toEqual([30, 30, 30]);
  });

  it('distributes a non-divisible total as evenly as possible (sums exactly)', () => {
    const chunks = splitDuration(50, 30);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(50);
    expect(chunks).toEqual([25, 25]);
  });

  it('returns empty for non-positive duration', () => {
    expect(splitDuration(0, 30)).toEqual([]);
  });

  it('never exceeds maxChunkMs', () => {
    const chunks = splitDuration(35, 30);
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

describe('placeItem 5-minute grid alignment', () => {
  const M = 60_000;
  const H = 60 * M;

  it('rounds an odd free start up to the next 5-minute mark', () => {
    const free = [{ start: 5 * H + 7 * M, end: 8 * H }];
    const res = placeItem(free, [30 * M], 8 * H);
    expect(res.placements).toEqual([{ start: 5 * H + 10 * M, end: 5 * H + 40 * M }]);
    // The 3-minute sliver the alignment stepped over stays free (nothing that
    // small is ever placed, and a buffer would swallow it anyway).
    expect(res.free).toEqual([
      { start: 5 * H + 7 * M, end: 5 * H + 10 * M },
      { start: 5 * H + 40 * M, end: 8 * H },
    ]);
  });

  it('leaves an already-aligned start untouched', () => {
    const free = [{ start: 5 * H + 10 * M, end: 8 * H }];
    const res = placeItem(free, [30 * M], 8 * H);
    expect(res.placements).toEqual([{ start: 5 * H + 10 * M, end: 5 * H + 40 * M }]);
  });

  it('keeps the raw start when alignment would overflow the slot (Evening Routine 23:29–23:59)', () => {
    const free = [{ start: 23 * H + 29 * M, end: 23 * H + 59 * M }];
    const res = placeItem(free, [30 * M], 24 * H);
    expect(res.placements).toEqual([{ start: 23 * H + 29 * M, end: 23 * H + 59 * M }]);
  });

  it('keeps the raw start when alignment would breach the deadline', () => {
    const free = [{ start: 5 * H + 7 * M, end: 8 * H }];
    const res = placeItem(free, [30 * M], 5 * H + 37 * M);
    expect(res.placements).toEqual([{ start: 5 * H + 7 * M, end: 5 * H + 37 * M }]);
  });

  it('does not skip an exact-fit slot in favour of a later alignable one', () => {
    const free = [
      { start: 23 * H + 29 * M, end: 23 * H + 59 * M },
      { start: 25 * H + 1 * M, end: 27 * H },
    ];
    const res = placeItem(free, [30 * M], 30 * H);
    expect(res.placements).toEqual([{ start: 23 * H + 29 * M, end: 23 * H + 59 * M }]);
  });

  it('measures the gap reservation from the aligned start', () => {
    const G = 15 * M;
    const free = [{ start: 5 * H + 7 * M, end: 8 * H }];
    const res = placeItem(free, [30 * M], 8 * H, undefined, G);
    expect(res.placements).toEqual([{ start: 5 * H + 10 * M, end: 5 * H + 40 * M }]);
    // Leading margin measured from the ALIGNED start (5:10 − 15m = 4:55), which is
    // before the slot, so only the trailing margin shows; it starts at 5:40 + 15m.
    expect(res.free).toEqual([{ start: 5 * H + 55 * M, end: 8 * H }]);
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

describe('splitDuration min wins over max on a conflict', () => {
  const M = 60_000;
  const Q = 15 * M;

  /** The pre-change algorithm (max-only), inlined as the oracle for consistent inputs. */
  const oldSplit = (d: number, max: number): number[] => {
    if (d <= 0) return [];
    if (d <= max) return [d];
    const n = Math.ceil(d / max);
    const base = Math.floor(d / n);
    const remainder = d - base * n;
    return Array.from({ length: n }, (_, k) => base + (k < remainder ? 1 : 0));
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('splits an unsplit task whose duration grew past min = max into one longer piece, not two short ones', () => {
    expect(splitDuration(90 * M, 60 * M, 60 * M)).toEqual([90 * M]);
  });

  it('keeps every piece at or above min when no chunk count fits both bounds', () => {
    expect(splitDuration(150 * M, 120 * M, 90 * M)).toEqual([150 * M]);
    expect(splitDuration(119 * M, 60 * M, 60 * M)).toEqual([119 * M]);
    // Several pieces still possible: 5h with min 2h, max 90m → 2 × 150m (was 4 × 75m).
    expect(splitDuration(300 * M, 90 * M, 120 * M)).toEqual([150 * M, 150 * M]);
  });

  it('returns one piece of the remaining size when less than min is left in total', () => {
    expect(splitDuration(20 * M, 30 * M, 45 * M)).toEqual([20 * M]); // d ≤ max
    expect(splitDuration(50 * M, 30 * M, 60 * M)).toEqual([50 * M]); // d > max, d < min
  });

  it('returns one piece when the total fits in max', () => {
    expect(splitDuration(45 * M, 60 * M, 15 * M)).toEqual([45 * M]);
  });

  it('deliberately reverses the d7d810a hard max cap when min and max conflict', () => {
    // d7d810a made maxChunkMs a hard cap even then: (35, min 30, max 30) → [18, 17], both
    // below min. The owner chose min-wins: fewer, longer pieces instead.
    expect(splitDuration(35, 30, 30)).toEqual([35]);
  });

  it('ignores a degenerate min (≤ 0 or non-finite) exactly like the max-only split', () => {
    for (const min of [0, -15, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const [d, max] of [[35, 30], [90, 30], [50, 30], [20, 30], [0, 30]]) {
        expect(splitDuration(d, max, min), `d=${d} max=${max} min=${min}`).toEqual(oldSplit(d, max));
      }
    }
  });

  it('property: matches the old split whenever min/max are consistent, never goes below min, sums to d', () => {
    let cases = 0;
    let conflicts = 0;
    for (let d = Q; d <= 12 * 60 * M; d += Q) {
      for (let min = Q; min <= 4 * 60 * M; min += Q) {
        for (let max = Q; max <= 4 * 60 * M; max += Q) {
          cases++;
          const parts = splitDuration(d, max, min);
          const label = `d=${d / M}m min=${min / M}m max=${max / M}m → ${parts.map((p) => p / M).join(',')}`;
          expect(sum(parts), label).toBe(d);
          expect(parts.every((p) => p > 0), label).toBe(true);
          // Even distribution: pieces differ by at most 1 ms.
          expect(Math.max(...parts) - Math.min(...parts), label).toBeLessThanOrEqual(1);
          // A count n with n·min ≤ d ≤ n·max exists ⇔ ceil(d/max)·min ≤ d.
          const consistent = Math.ceil(d / max) * min <= d;
          if (consistent) {
            expect(parts, label).toEqual(oldSplit(d, max));
            expect(parts.every((p) => p <= max), label).toBe(true);
          } else {
            conflicts++;
            expect(parts.length, label).toBe(Math.max(1, Math.floor(d / min)));
            // Fewer, longer pieces: never more than the max-only split (equal only when d < min → [d]).
            expect(parts.length, label).toBeLessThanOrEqual(oldSplit(d, max).length);
          }
          if (d < min) expect(parts, label).toEqual([d]);
          else expect(parts.every((p) => p >= min), label).toBe(true);
        }
      }
    }
    expect(cases).toBe(48 * 16 * 16);
    expect(conflicts).toBeGreaterThan(0);
  });
});
