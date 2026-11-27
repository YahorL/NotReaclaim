import type { FastifyInstance } from 'fastify';
import { QUARTER_HOUR_MS, stopBlockEndMs } from '@notreclaim/core';
import { NotFoundError, type ScheduledBlock } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { isMirrored, removeMirroredEventWithToken, type PrefetchedToken } from './google-writeback.js';

/**
 * A running piece ended less than half a quarter hour after its start is DELETED instead of
 * stopped: Stop's arithmetic (round15, floored at start + 15 min) would leave a 15-minute block
 * ending in the future and counting 15 minutes for a few minutes of work, if any.
 */
export const SHORT_PIECE_MS = QUARTER_HOUR_MS / 2;

type Deps = Pick<AppDeps, 'repos' | 'google' | 'now'>;

/**
 * The user's task blocks running at `now` that `isTarget` picks: start ≤ now < end, or Started
 * with a start still ahead — Start snaps to the NEAREST quarter, so a block Started at 09:08 runs
 * from 09:15 (at most 7.5 minutes ahead); it is running all the same (the web's rule is
 * `startedAt != null && endsAt > now`) and, having begun "in the future", it is short.
 */
export async function runningTargets(deps: Deps, userId: string, now: number, isTarget: (b: ScheduledBlock) => boolean) {
  return (await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(now + SHORT_PIECE_MS + 1)))
    .filter((b) => b.taskId != null && b.endsAt.getTime() > now
      && (b.startsAt.getTime() <= now || b.startedAt != null) && isTarget(b));
}

/**
 * When the user began working on a piece. Start snaps a block's start to the NEAREST quarter (up
 * to 7.5 minutes either way), so when a Started block's `startedAt` lies within that distance of
 * its start, the piece began at the EARLIER of the two: Started at 09:08 → runs from 09:15, so at
 * 09:22 it has been worked on for 14 minutes, not 7; Started at 09:07 on a block that began at
 * 09:00 → it began at 09:00 (Start did not move it), as did a Started block dragged earlier ("I
 * actually began at 9"). Otherwise — never Started, or Started long ago and dragged since — its
 * start.
 */
function beganAt(b: ScheduledBlock): number {
  const start = b.startsAt.getTime();
  const started = b.startedAt?.getTime();
  return started != null && started >= start - SHORT_PIECE_MS ? Math.min(started, start) : start;
}

const isShort = (b: ScheduledBlock, now: number) => now - beganAt(b) < SHORT_PIECE_MS;

/**
 * Whether Start (automatic tracking) deletes this running block instead of ending it: begun less
 * than SHORT_PIECE_MS ago and either an auto piece never Started, or Started — whatever its
 * origin (owner decision 2026-11-27, "Remove X's block": the user moved on within moments, so the
 * block goes and its task returns to automatic planning; those few minutes are not counted). A
 * hand-placed (pinned) block that was never Started is never deleted.
 */
export const deletedOnStart = (b: ScheduledBlock, now: number) =>
  isShort(b, now) && (b.startedAt != null || !b.pinned);

/**
 * Under the user lock: end every running task piece `isTarget` picks, as of `now` (the arrival
 * clock). See endRunningPieces.
 */
export async function endRunningPiecesUnderLock(
  app: FastifyInstance,
  deps: Deps,
  userId: string,
  now: number,
  isTarget: (b: ScheduledBlock) => boolean,
  token: PrefetchedToken | null,
): Promise<number | 'needs-token'> {
  return endRunningPieces(app, deps, userId, now, await runningTargets(deps, userId, now, isTarget), token);
}

/**
 * Under the user lock: end the running task pieces `targets` (from runningTargets), as of `now`
 * (the arrival clock). A piece that ran at least SHORT_PIECE_MS gets Stop's write — end =
 * stopBlockEndMs, pinned (a Started one keeps its startedAt), so it is never re-planned, counts once it has ended, and the pinned pass
 * pushes the new end to Google even when it is already in the past. A shorter one is deleted with
 * its Google event (best effort, like DELETE /schedule/:id). With `startedBlock` (Start), a piece
 * that would run past the started block's new start ends there instead; a hand-placed (pinned)
 * block that was never Started is never deleted: young or not, it ends at the started block's
 * start, or is left as it is when that would leave it with no length; a Started block is deleted
 * when begun under SHORT_PIECE_MS ago (deletedOnStart), and otherwise ended like a hand-placed one. A Started block always ends
 * exactly at the started block's start when that lies inside it, even where Stop's arithmetic
 * would end it earlier (the recent-end clamp can raise the new start above round15(now)): it was
 * the user's explicit timer, running up to the hand-over. With `startedBlock.exact` (Start at the exact
 * minute, see exactStartMs) every piece begun before the started block's start ends exactly
 * there, even where Stop's arithmetic would end it earlier (round15(now) rounded down), so no
 * minute between the two is left uncounted. Returns how many pieces changed, or 'needs-token'
 * when a piece to delete has a Google event and the caller passed no token: it then lets go of
 * the lock, looks one up (token lookups never run under the lock) and comes back once. Nothing is
 * written before that answer. Callers start without a token: a piece to delete that is mirrored
 * is rare (begun under 7.5 minutes ago), and no read happens before the lock.
 */
export async function endRunningPieces(
  app: FastifyInstance,
  deps: Deps,
  userId: string,
  now: number,
  targets: ScheduledBlock[],
  token: PrefetchedToken | null,
  startedBlock?: { start: number; exact: boolean },
): Promise<number | 'needs-token'> {
  // What becomes of each piece: a new end, 'delete' (begun less than SHORT_PIECE_MS ago), or
  // 'keep' (a hand-placed block that Start may not shorten to nothing).
  const fate = (b: ScheduledBlock): number | 'delete' | 'keep' => {
    // Start never deletes a hand-placed (pinned) block that was never Started: the user put it
    // there. A Started block begun under SHORT_PIECE_MS ago is deleted (deletedOnStart); a longer
    // one (pinned or unpinned since through PATCH) is ended like a hand-placed block.
    const handPlaced = startedBlock != null && (b.pinned || b.startedAt != null);
    if (startedBlock ? deletedOnStart(b, now) : isShort(b, now)) return 'delete';
    const start = b.startsAt.getTime();
    const end = stopBlockEndMs(start, b.endsAt.getTime(), now);
    if (!startedBlock) return end;
    // Start: the block being started now counts from its (new) start, so the ended piece stops
    // there. Stop's 15-minute floor and a start off the quarter grid would otherwise make the
    // two overlap (10:10 running, Start at 10:19: ended at 10:25, Started from 10:15).
    if (startedBlock.start > start && startedBlock.start < end) return startedBlock.start;
    // At the exact minute (at most `now`, so before the piece's end): ending at round15(now) would
    // leave a gap before it (a piece running at 09:17 would end at 09:15, the Started one 09:17).
    if (startedBlock.exact && startedBlock.start > start && startedBlock.start < b.endsAt.getTime()) return startedBlock.start;
    // A Started block (automatic tracking, "Start next") ran up to the hand-over: it ends exactly there.
    if (b.startedAt != null && startedBlock.start > start && startedBlock.start < b.endsAt.getTime()) return startedBlock.start;
    // A hand-placed block that begins where (or after) the Started block begins would be left
    // with no length at all: it is left as it is. An auto piece in that position (only a Started
    // block that has already ended can begin before it) keeps Stop's arithmetic.
    if (handPlaced && startedBlock.start <= start) return 'keep';
    return end;
  };
  const plan = targets.map((b) => ({ b, end: fate(b) })).filter(({ end }) => end !== 'keep');
  if (!token && plan.some(({ b, end }) => end === 'delete' && isMirrored(b))) return 'needs-token';
  for (const { b, end } of plan) {
    if (typeof end === 'number') {
      await deps.repos.scheduledBlocks.update(userId, b.id, { endsAt: new Date(end), pinned: true });
      continue;
    }
    if (token) {
      await removeMirroredEventWithToken(app, deps, token, b, {
        fields: { blockId: b.id }, message: 'google write-back failed: ended piece event not removed remotely',
      });
    }
    try {
      await deps.repos.scheduledBlocks.delete(userId, b.id);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err; // gone meanwhile (a cascade or drift): already done
    }
  }
  return plan.length;
}
