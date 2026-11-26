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
async function runningTargets(deps: Deps, userId: string, now: number, isTarget: (b: ScheduledBlock) => boolean) {
  return (await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(now + SHORT_PIECE_MS + 1)))
    .filter((b) => b.taskId != null && b.endsAt.getTime() > now
      && (b.startsAt.getTime() <= now || b.startedAt != null) && isTarget(b));
}

const isShort = (b: ScheduledBlock, now: number) => now - b.startsAt.getTime() < SHORT_PIECE_MS;

/**
 * Under the user lock: end every running task piece `isTarget` picks, as of `now` (the arrival
 * clock). A piece that ran at least SHORT_PIECE_MS gets Stop's write — end = stopBlockEndMs,
 * pinned, so it is never re-planned, counts once it has ended, and the pinned pass pushes the new
 * end to Google even when it is already in the past. A shorter one is deleted with its Google
 * event (best effort, like DELETE /schedule/:id). With `startedBlock` (Start), a piece that
 * would run past the started block's new start ends there instead. Returns how many pieces
 * changed, or 'needs-token' when a piece to delete has a Google event and the caller passed no
 * token: it then lets go of the lock, looks one up (token lookups never run under the lock) and
 * comes back once. Nothing is written before that answer. Callers start without a token: a piece
 * to delete that is mirrored is rare (begun under 7.5 minutes ago), and no read happens before
 * the lock.
 */
export async function endRunningPiecesUnderLock(
  app: FastifyInstance,
  deps: Deps,
  userId: string,
  now: number,
  isTarget: (b: ScheduledBlock) => boolean,
  token: PrefetchedToken | null,
  startedBlock?: { start: number },
): Promise<number | 'needs-token'> {
  const targets = await runningTargets(deps, userId, now, isTarget);
  // Where each piece ends, or null when it is deleted (begun less than SHORT_PIECE_MS ago).
  const endOf = (b: ScheduledBlock): number | null => {
    if (isShort(b, now)) return null;
    const start = b.startsAt.getTime();
    const end = stopBlockEndMs(start, b.endsAt.getTime(), now);
    // Start: the block being started now counts from its (new) start, so the ended piece stops
    // there. Stop's 15-minute floor and a start off the quarter grid would otherwise make the
    // two overlap (10:10 running, Start at 10:19: ended at 10:25, Started from 10:15).
    // (A Started block beginning at or before the piece's own start — only a block that has
    // already ended can, since Start never moves one later — is left to Stop's arithmetic.)
    return startedBlock && startedBlock.start > start && startedBlock.start < end ? startedBlock.start : end;
  };
  const plan = targets.map((b) => ({ b, end: endOf(b) }));
  if (!token && plan.some(({ b, end }) => end == null && isMirrored(b))) return 'needs-token';
  for (const { b, end } of plan) {
    if (end != null) {
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
  return targets.length;
}
