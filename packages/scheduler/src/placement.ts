import type { Interval } from './types.js';
import { intersectIntervals, subtractIntervals, mergeIntervals } from './intervals.js';

/**
 * Split `durationMs` into chunk sizes summing exactly to it, distributed as evenly
 * as possible. Uses the fewest chunks such that none exceeds `maxChunkMs`; that
 * count already keeps every chunk >= `minChunkMs` whenever any count can satisfy
 * both bounds. Pieces are never shorter than min unless less than min is left in
 * total (then it is one piece of the remaining size). When min and max cannot
 * both hold (e.g. an unsplit task, min = max = 60m, whose duration grew to 90m),
 * min wins: fewer, longer pieces (`floor(d / min)`, at least one) that may exceed
 * max. A non-positive or non-finite `minChunkMs` is ignored (max-only split).
 */
export function splitDuration(durationMs: number, maxChunkMs: number, minChunkMs = 0): number[] {
  if (durationMs <= 0) return [];
  if (durationMs <= maxChunkMs) return [durationMs];

  let n = Math.ceil(durationMs / maxChunkMs);
  if (Number.isFinite(minChunkMs) && minChunkMs > 0 && n * minChunkMs > durationMs) {
    n = Math.max(1, Math.floor(durationMs / minChunkMs));
  }
  const base = Math.floor(durationMs / n);
  const remainder = durationMs - base * n;
  const chunks: number[] = [];
  for (let k = 0; k < n; k++) {
    chunks.push(base + (k < remainder ? 1 : 0));
  }
  return chunks;
}

/**
 * Auto placements land on a 5-minute clock grid: "8:07 PM" reads as a glitch,
 * "8:10 PM" reads as a schedule. 5 divides 60, so plain epoch-ms rounding is
 * timezone-safe (every real UTC offset is a whole number of minutes, and the
 * grid repeats every 5).
 */
const GRID_MS = 5 * 60_000;

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
  gapMs = 0,
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

    // Nudge the start up to the grid, but only when the chunk still fits the slot
    // it was chosen for and still beats the deadline. The slot search above stays
    // earliest-fit: an exact-fit window (Evening Routine's 23:29–23:59 × 30m) is
    // kept at its raw start rather than skipped in favour of a later alignable one.
    const aligned = Math.ceil(slot.start / GRID_MS) * GRID_MS;
    const start =
      aligned + size <= slot.end && aligned + size <= deadline ? aligned : slot.start;

    const placement: Placement = { start, end: start + size };
    placements.push(placement);
    // Reserve the gap on BOTH sides so a later placement cannot butt up against
    // this one from the left either.
    remainingFree = subtractIntervals(remainingFree, [
      { start: placement.start - gapMs, end: placement.end + gapMs },
    ]);
  }

  return { placements, free: remainingFree, unplaced };
}
