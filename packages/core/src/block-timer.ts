import { QUARTER_HOUR_MS, round15 } from './time-windows.js';

/** Start: pin, stamp startedAt=now, and pull the start to round15(now) unless that is not before the end. */
export function startBlockPatch(endsAtMs: number, now: number): { pinned: true; startedAt: Date; startsAt?: Date } {
  const snapped = round15(now);
  const patch: { pinned: true; startedAt: Date; startsAt?: Date } = { pinned: true, startedAt: new Date(now) };
  // Pull the start to the snapped current time (Start always targets the upcoming task),
  // keeping the end. The lower-bound guard is gone so a future block is pulled forward too.
  if (snapped < endsAtMs) {
    patch.startsAt = new Date(snapped);
  }
  return patch;
}

/** Stop: end at round15(now), never before start+15min, never after the original end. */
export function stopBlockEndMs(startsAtMs: number, endsAtMs: number, now: number): number {
  const minEnd = startsAtMs + QUARTER_HOUR_MS;
  // End the running block now: snap end to the nearest 15 min, never below start+15 min
  // (no zero-length block) and never past the original end (Stop only shortens).
  return Math.min(endsAtMs, Math.max(round15(now), minEnd));
}
