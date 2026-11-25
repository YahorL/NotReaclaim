import type { UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  applyDesiredSchedule,
  horizonEndMs,
  SettingsRequiredError,
  type BlocksRepo,
  type Exclusive,
  type ReplanCounts,
  type ScheduleMirror,
  type SchedulingRepositories,
} from '@notreclaim/core';
import type { GoogleClient } from './client.js';
import type { AccessTokenProvider } from './sync.js';
import { ensureAutoScheduledCalendar } from './ensure-calendar.js';
import { detectDrift } from './detect-drift.js';
import { toGoogleEventWrite } from './writeback.js';
import { GoogleApiError, GoogleAuthError, GoogleTimeoutError } from './errors.js';

/**
 * The errors that still abort a reconcile's apply instead of being isolated to their row:
 * they say the connection itself is unusable, so every later Google call would fail too.
 * - Any auth failure, a revoked grant included. The token is refreshed before apply starts,
 *   so none is expected from a mirror call today; if one ever is, it must reach the caller
 *   (the token service flags a revoked grant as a broken connection) instead of being counted.
 * - A 401: Google rejected the access token itself.
 * - A request timeout: Google is unreachable, and isolating it would make every remaining row
 *   wait out its own 15 s timeout while the user's lock is held (edits wait for apply).
 * Everything else (a 4xx/5xx/429 on one event, a DB error on one row) is isolated and counted.
 */
function abortsApply(err: unknown): boolean {
  return err instanceof GoogleAuthError
    || err instanceof GoogleTimeoutError
    || (err instanceof GoogleApiError && err.status === 401);
}

export interface ReconcileDeps {
  client: GoogleClient;
  tokens: AccessTokenProvider;
  users: Pick<UserRepository, 'findById' | 'update'>;
  scheduledBlocks: BlocksRepo;
  schedulingRepos: SchedulingRepositories;
  /**
   * Runs the compute + apply phase as one critical section (the server passes its per-user
   * lock, shared with the block routes). Token refresh, the calendar check and drift
   * detection stay outside it. Default: no lock.
   */
  exclusive?: Exclusive;
}

/** Same counts as a local replan; `pinned`/`removed` here are detectDrift's pulls from Google. */
export type ReconcileResult = ReplanCounts;

/** Detect drift, recompute the desired schedule, and apply a keyed diff to Google + DB. */
export async function reconcile(deps: ReconcileDeps, userId: string, now: number): Promise<ReconcileResult> {
  const accessToken = await deps.tokens.getAccessToken(userId, now);
  const calendarId = await ensureAutoScheduledCalendar(
    { client: deps.client, users: deps.users },
    userId,
    accessToken,
  );

  const settings = await deps.schedulingRepos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);
  const horizonEnd = horizonEndMs(now, settings.horizonDays);

  const { pinned, removed, observed } = await detectDrift(
    { client: deps.client, scheduledBlocks: deps.scheduledBlocks },
    userId,
    calendarId,
    accessToken,
    now,
    horizonEnd,
  );

  const insert: ScheduleMirror['create'] = async (block) => {
    const { googleEventId } = await deps.client.insertEvent(accessToken, calendarId, toGoogleEventWrite(block));
    return { googleEventId, googleCalendarId: calendarId };
  };
  const mirror: ScheduleMirror = {
    create: insert,
    update: async (block, existing) => {
      // A block planned locally before Google was linked has no event yet: create it (apply
      // stores the returned ids) instead of PUTting to `events/null`, which Google 404s.
      if (existing.googleEventId == null) return insert(block);
      await deps.client.updateEvent(accessToken, calendarId, existing.googleEventId, toGoogleEventWrite(block));
      return undefined;
    },
    delete: async (existing) => {
      if (existing.googleEventId) await deps.client.deleteEvent(accessToken, calendarId, existing.googleEventId);
    },
  };

  // Compute reads the blocks and apply writes from that read (with a Google call before most
  // writes), so both run inside `exclusive`: a block route's write can then never land
  // between them and be overwritten, swept, or pushed stale to Google.
  const exclusive = deps.exclusive ?? ((fn) => fn());
  const counts = await exclusive(async () => {
    const desired = await computeDesiredSchedule(deps.schedulingRepos, userId, now);
    // `observed` is Google's pre-apply state: it lets the pinned pass push exactly the blocks
    // the app moved, once, instead of re-writing every pinned event on every poll cycle.
    return applyDesiredSchedule(deps.scheduledBlocks, userId, desired, {
      now, horizonEnd, mirror, mirrorSnapshot: observed, isFatal: abortsApply,
    });
  });

  // Every apply count (including the per-row failure counts, present only when non-zero) plus
  // drift's pulls from Google.
  return { ...counts, pinned, removed };
}
