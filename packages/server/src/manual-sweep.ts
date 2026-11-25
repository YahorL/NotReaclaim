import type { FastifyInstance } from 'fastify';
import { isDiscardableUnstarted } from '@notreclaim/core';
import { NotFoundError } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { bestEffortGoogleWrite } from './google-writeback.js';

/**
 * Manual mode: delete the user's past task blocks that were never started, one row at a time
 * in list order, each followed by the best-effort removal of its mirrored Google event.
 * Returns how many rows THIS call deleted (a row another request removed first is skipped).
 */
export async function discardUnstartedPastBlocks(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'repos' | 'google' | 'now'>,
  userId: string,
  now: number,
): Promise<number> {
  const past = await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(now));
  let discarded = 0;
  for (const b of past) {
    if (isDiscardableUnstarted(b, now)) {
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
      const { googleEventId, googleCalendarId } = b;
      if (googleEventId && googleCalendarId) {
        await bestEffortGoogleWrite(
          app, deps, userId,
          { fields: { blockId: b.id }, message: 'google write-back failed: discarded block event not removed remotely' },
          (accessToken) => deps.google.client.deleteEvent(accessToken, googleCalendarId, googleEventId),
        );
      }
    }
  }
  return discarded;
}
