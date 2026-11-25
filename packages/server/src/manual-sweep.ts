import type { FastifyInstance } from 'fastify';
import { isDiscardableUnstarted } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { isMirrored, prefetchAccessToken, removeMirroredEventWithToken, type PrefetchedToken } from './google-writeback.js';

/**
 * Manual mode: delete the user's past task blocks that were never started, one row at a time
 * in list order, each followed by the best-effort removal of its mirrored Google event.
 * Returns how many rows THIS call deleted (a row another request removed first is skipped).
 *
 * The candidates are read without the user lock, so a user with nothing to discard never
 * waits for a replan. Otherwise the Google token is looked up first (still unlocked, and only
 * if a candidate has a Google event), then the deletes run under the lock, each candidate
 * re-checked against a fresh read: a replan that held the lock meanwhile may have moved one
 * forward (a reissued engine key), the user may have started it — or a replan clocked before
 * the row ended may have given it a Google event (its pinned pass or a first insert). In that
 * last case no token was fetched, so the sweep lets go of the lock, fetches one and comes back
 * once, exactly like DELETE /schedule/:id: the token lookup never runs under the lock.
 */
export async function discardUnstartedPastBlocks(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'repos' | 'google' | 'now' | 'withUserLock'>,
  userId: string,
  now: number,
): Promise<number> {
  const listPast = () => deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(now));
  const candidates = (await listPast()).filter((b) => isDiscardableUnstarted(b, now));
  if (candidates.length === 0) return 0;
  const candidateIds = new Set(candidates.map((b) => b.id));

  const sweepUnderLock = (token: PrefetchedToken | null) => deps.withUserLock(userId, async () => {
    const rows = (await listPast()).filter((b) => candidateIds.has(b.id) && isDiscardableUnstarted(b, now));
    if (!token && rows.some(isMirrored)) return 'needs-token' as const;
    let discarded = 0;
    for (const b of rows) {
      // Row first: an overlapping GET may have discarded it already (it then owns the
      // Google delete too), which must not fail this request.
      try {
        await deps.repos.scheduledBlocks.delete(userId, b.id);
      } catch (err) {
        if (err instanceof NotFoundError) continue;
        throw err;
      }
      discarded++;
      // Remove the mirrored event too: nothing else ever will (reconcile only deletes
      // events of rows it still holds, and drift only lists [now, horizon]). Best-effort
      // and per row, same as DELETE /schedule/:id — a Google failure never fails the GET.
      // (No token here means no row of this sweep is mirrored: checked above.)
      if (token) {
        await removeMirroredEventWithToken(app, deps, token, b, {
          fields: { blockId: b.id }, message: 'google write-back failed: discarded block event not removed remotely',
        });
      }
    }
    return discarded;
  });

  const first = await sweepUnderLock(candidates.some(isMirrored) ? await prefetchAccessToken(deps, userId) : null);
  if (first !== 'needs-token') return first;
  const second = await sweepUnderLock(await prefetchAccessToken(deps, userId));
  return second === 'needs-token' ? 0 : second; // unreachable: a token was passed
}
