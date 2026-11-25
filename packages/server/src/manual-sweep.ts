import type { FastifyInstance } from 'fastify';
import { isDiscardableUnstarted } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { isMirrored, prefetchAccessToken, removeMirroredEventWithToken, type PrefetchedToken } from './google-writeback.js';

/** Stands in for a token that was never looked up because no candidate had a Google event. */
const NO_TOKEN: PrefetchedToken = { error: new Error('no access token: the block had no Google event when the sweep started') };

/**
 * Manual mode: delete the user's past task blocks that were never started, one row at a time
 * in list order, each followed by the best-effort removal of its mirrored Google event.
 * Returns how many rows THIS call deleted (a row another request removed first is skipped).
 *
 * The candidates are read without the user lock, so a user with nothing to discard never
 * waits for a replan. Otherwise the Google token is looked up first (still unlocked, and only
 * if a candidate has a Google event), then the deletes run under the lock, each candidate
 * re-checked against a fresh read: a replan that held the lock meanwhile may have moved one
 * forward (a reissued engine key) or the user may have started it.
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
  // A past row cannot gain Google ids while this waits (apply only attaches events to rows it
  // places in the future), so deciding from the candidates is enough.
  const token = candidates.some(isMirrored) ? await prefetchAccessToken(deps, userId) : NO_TOKEN;

  return deps.withUserLock(userId, async () => {
    let discarded = 0;
    for (const b of await listPast()) {
      if (!candidateIds.has(b.id) || !isDiscardableUnstarted(b, now)) continue;
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
      await removeMirroredEventWithToken(app, deps, token, b, {
        fields: { blockId: b.id }, message: 'google write-back failed: discarded block event not removed remotely',
      });
    }
    return discarded;
  });
}
