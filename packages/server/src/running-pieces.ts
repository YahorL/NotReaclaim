import type { FastifyInstance } from 'fastify';
import { QUARTER_HOUR_MS, stopBlockEndMs } from '@notreclaim/core';
import { NotFoundError, type ScheduledBlock } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { isMirrored, prefetchAccessToken, removeMirroredEventWithToken, type PrefetchedToken } from './google-writeback.js';

/**
 * A running piece ended less than half a quarter hour after its start is DELETED instead of
 * stopped: Stop's arithmetic (round15, floored at start + 15 min) would leave a 15-minute block
 * ending in the future and counting 15 minutes for a few minutes of work, if any.
 */
export const SHORT_PIECE_MS = QUARTER_HOUR_MS / 2;

type Deps = Pick<AppDeps, 'repos' | 'google' | 'now'>;

/** The user's task blocks running at `now` (start ≤ now < end) that `isTarget` picks. */
async function runningTargets(deps: Deps, userId: string, now: number, isTarget: (b: ScheduledBlock) => boolean) {
  return (await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(now + 1)))
    .filter((b) => b.taskId != null && b.startsAt.getTime() <= now && b.endsAt.getTime() > now && isTarget(b));
}

const isShort = (b: ScheduledBlock, now: number) => now - b.startsAt.getTime() < SHORT_PIECE_MS;

/**
 * Before taking the user lock: an access token, fetched only when a piece that will be deleted
 * has a Google event (token lookups never run under the lock, see DELETE /schedule/:id).
 */
export async function prefetchForEnding(
  deps: Deps, userId: string, now: number, isTarget: (b: ScheduledBlock) => boolean,
): Promise<PrefetchedToken | null> {
  const targets = await runningTargets(deps, userId, now, isTarget);
  return targets.some((b) => isShort(b, now) && isMirrored(b)) ? prefetchAccessToken(deps, userId) : null;
}

/**
 * Under the user lock: end every running task piece `isTarget` picks, as of `now` (the arrival
 * clock). A piece that ran at least SHORT_PIECE_MS gets Stop's write — end = stopBlockEndMs,
 * pinned, so it is never re-planned, counts once it has ended, and the pinned pass pushes the new
 * end to Google even when it is already in the past. A shorter one is deleted with its Google
 * event (best effort, like DELETE /schedule/:id). Returns how many pieces changed, or
 * 'needs-token' when a piece to delete turned out to be mirrored and no token was prefetched:
 * the caller lets go of the lock, fetches one and comes back (nothing was written).
 */
export async function endRunningPiecesUnderLock(
  app: FastifyInstance,
  deps: Deps,
  userId: string,
  now: number,
  isTarget: (b: ScheduledBlock) => boolean,
  token: PrefetchedToken | null,
): Promise<number | 'needs-token'> {
  const targets = await runningTargets(deps, userId, now, isTarget);
  if (!token && targets.some((b) => isShort(b, now) && isMirrored(b))) return 'needs-token';
  for (const b of targets) {
    if (!isShort(b, now)) {
      await deps.repos.scheduledBlocks.update(userId, b.id, {
        endsAt: new Date(stopBlockEndMs(b.startsAt.getTime(), b.endsAt.getTime(), now)), pinned: true,
      });
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
