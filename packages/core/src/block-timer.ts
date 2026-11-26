import { QUARTER_HOUR_MS, round15 } from './time-windows.js';

export interface StartBlockPatch {
  pinned: true;
  startedAt: Date;
  startsAt?: Date;
  endsAt?: Date;
}

/**
 * Start: pin and stamp startedAt = now (the raw instant), then
 * - pressed BEFORE the block (now < startsAt): move it to round15(now), keeping its length —
 *   unless round15(now) is not earlier than its planned start (pressed within 7.5 minutes of a
 *   start that is not on the quarter grid), in which case its times are kept: Start never pushes
 *   a block later than planned. No clamping against what follows: the replan plans around it.
 * - pressed once it has begun (startsAt <= now, so also exactly at its start): pull the start to
 *   round15(now), keeping the end (it shrinks, or grows by up to 7.5 minutes when round15 lands
 *   before a start off the quarter grid) — unless round15(now) is not before the end.
 */
export function startBlockPatch(startsAtMs: number, endsAtMs: number, now: number): StartBlockPatch {
  const snapped = round15(now);
  const patch: StartBlockPatch = { pinned: true, startedAt: new Date(now) };
  if (now < startsAtMs) {
    if (snapped < startsAtMs) {
      patch.startsAt = new Date(snapped);
      patch.endsAt = new Date(snapped + (endsAtMs - startsAtMs));
    }
  } else if (snapped < endsAtMs) {
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
