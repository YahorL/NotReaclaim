import type { Interval } from './types.js';
import { intersectIntervals, subtractIntervals, mergeIntervals } from './intervals.js';

/**
 * Split `durationMs` into chunk sizes summing exactly to it, using the fewest
 * chunks such that none exceeds `maxChunkMs` (a hard upper bound), distributed
 * as evenly as possible. `minChunkMs` is best-effort: minimizing the chunk count
 * already maximizes chunk size, so chunks stay at or above `minChunkMs` whenever
 * that is feasible given the hard `maxChunkMs` cap.
 */
export function splitDuration(
  durationMs: number,
  minChunkMs: number,
  maxChunkMs: number,
): number[] {
  if (durationMs <= 0) return [];
  if (durationMs <= maxChunkMs) return [durationMs];

  const n = Math.ceil(durationMs / maxChunkMs);
  const base = Math.floor(durationMs / n);
  const remainder = durationMs - base * n;
  const chunks: number[] = [];
  for (let k = 0; k < n; k++) {
    chunks.push(base + (k < remainder ? 1 : 0));
  }
  return chunks;
}

export interface Placement {
  start: number;
  end: number;
}

export interface PlaceItemResult {
  placements: Placement[];
  /** Free timeline after removing the placed blocks. */
  free: Interval[];
  /** Chunk sizes that could not be placed. */
  unplaced: number[];
}

/**
 * Greedily place each chunk size into the earliest free slot large enough,
 * optionally restricted to `candidateWindows`, never ending after `deadline`.
 */
export function placeItem(
  free: Interval[],
  chunkSizes: number[],
  deadline: number,
  candidateWindows?: Interval[],
): PlaceItemResult {
  let remainingFree = mergeIntervals(free);
  const placements: Placement[] = [];
  const unplaced: number[] = [];

  for (const size of chunkSizes) {
    const candidates = candidateWindows
      ? intersectIntervals(remainingFree, candidateWindows)
      : remainingFree;

    const slot = candidates.find(
      (s) => s.end - s.start >= size && s.start + size <= deadline,
    );

    if (!slot) {
      unplaced.push(size);
      continue;
    }

    const placement: Placement = { start: slot.start, end: slot.start + size };
    placements.push(placement);
    remainingFree = subtractIntervals(remainingFree, [placement]);
  }

  return { placements, free: remainingFree, unplaced };
}
