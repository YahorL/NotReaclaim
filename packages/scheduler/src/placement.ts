import type { Interval } from './types.js';
import { intersectIntervals, subtractIntervals, mergeIntervals } from './intervals.js';

/**
 * Split `durationMs` into chunk sizes summing exactly to it, using the fewest
 * chunks such that each is <= maxChunkMs, while avoiding chunks below minChunkMs
 * when the total allows. Distribution is even and deterministic.
 */
export function splitDuration(
  durationMs: number,
  minChunkMs: number,
  maxChunkMs: number,
): number[] {
  if (durationMs <= 0) return [];
  if (durationMs <= maxChunkMs) return [durationMs];

  let n = Math.ceil(durationMs / maxChunkMs);
  const maxChunks = Math.max(1, Math.floor(durationMs / minChunkMs));
  if (n > maxChunks) n = maxChunks;

  const base = Math.floor(durationMs / n);
  const remainder = durationMs - base * n;
  const chunks: number[] = [];
  for (let k = 0; k < n; k++) {
    chunks.push(base + (k < remainder ? 1 : 0));
  }
  return chunks;
}
