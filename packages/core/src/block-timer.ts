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
 *   unless round15(now) is not earlier than its planned start (pressed within 7.5 minutes of a start
 *   that is not on the quarter grid), in which case its times are kept: Start never pushes a block
 *   later than planned. No clamping against what follows: the replan plans around it.
 * - pressed once it has begun (startsAt <= now, so also exactly at its start): pull the start to
 *   round15(now), keeping the end (it shrinks, or grows by up to 7.5 minutes when round15 lands
 *   before a start off the quarter grid) — unless round15(now) is not before the end.
 * Moving a start EARLIER never goes back over time that already counted: `recentEnds` are the ends
 * of the user's other task blocks that count as spent (the caller decides which), and a new start
 * before the latest of them that lies in (new start, now] is raised to it — never past the block's
 * own start (a block that already overlapped one keeps its start). Since that latest end is at
 * most `now` and the block's own start bounds it, the clamp never empties a block.
 * `from` replaces round15(now) as the candidate start in both branches (see exactStartMs); the
 * clamp then applies to it the same way, so the start is the later of the two.
 */
export function startBlockPatch(
  startsAtMs: number, endsAtMs: number, now: number, recentEnds: number[] = [], from: number = round15(now),
): StartBlockPatch {
  const snapped = from;
  const patch: StartBlockPatch = { pinned: true, startedAt: new Date(now) };
  let start = now < startsAtMs ? Math.min(snapped, startsAtMs) : snapped;
  if (start < startsAtMs) {
    const counted = recentEnds.filter((end) => end > start && end <= now);
    if (counted.length > 0) start = Math.min(Math.max(...counted), startsAtMs);
  }
  if (now < startsAtMs) {
    if (start < startsAtMs) {
      patch.startsAt = new Date(start);
      patch.endsAt = new Date(start + (endsAtMs - startsAtMs));
    }
  } else if (start < endsAtMs) {
    patch.startsAt = new Date(start);
  }
  return patch;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

/**
 * Start at the exact minute (automatic tracking, owner decision). `startsToCut` are the starts of
 * the OTHER running hand-placed, never-Started task blocks that begin at or after the Started
 * block's snapped start, so Start would leave them whole beside it (both counting). Returns where
 * the Started block begins instead, so that they can end there: the current minute, truncated
 * (times without seconds), when every one that can be cut began before it; otherwise (pressed
 * within the minute one began) the current second, truncated. Always a whole second, never
 * milliseconds: Google keeps whole seconds, so a row with milliseconds would never match its event
 * (drift would rewrite it) and a block cut within a second would leave a zero-length event. So one
 * that began within the current second (at or after it) cannot be cut: it is ignored here and left
 * whole by the caller. Null when none can be cut: Start keeps round15(now).
 */
export function exactStartMs(now: number, startsToCut: number[]): number | null {
  const second = Math.floor(now / SECOND_MS) * SECOND_MS;
  const cuttable = startsToCut.filter((s) => s < second);
  if (cuttable.length === 0) return null;
  const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  return minute > Math.max(...cuttable) ? minute : second;
}

/** Stop: end at round15(now), never before start+15min, never after the original end. */
export function stopBlockEndMs(startsAtMs: number, endsAtMs: number, now: number): number {
  const minEnd = startsAtMs + QUARTER_HOUR_MS;
  // End the running block now: snap end to the nearest 15 min, never below start+15 min
  // (no zero-length block) and never past the original end (Stop only shortens).
  return Math.min(endsAtMs, Math.max(round15(now), minEnd));
}
