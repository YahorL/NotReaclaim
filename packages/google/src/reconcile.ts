import type { UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  applyDesiredSchedule,
  horizonEndMs,
  SettingsRequiredError,
  type BlocksRepo,
  type Exclusive,
  type RowFailure,
  type ReplanCounts,
  type ScheduleMirror,
  type SchedulingRepositories,
} from '@notreclaim/core';
import type { GoogleClient } from './client.js';
import type { AccessTokenProvider } from './sync.js';
import { ensureAutoScheduledCalendar } from './ensure-calendar.js';
import { detectDrift } from './detect-drift.js';
import { toGoogleEventWrite } from './writeback.js';
import { GoogleApiError, GoogleTimeoutError } from './errors.js';

/**
 * A Google error that belongs to the one event being written, so apply may skip that row and
 * carry on (on top of the row-scoped DB errors core already knows): Google ANSWERED, about
 * this event — any 4xx/5xx GoogleApiError except a 401 and a timeout.
 * - 429 and 5xx count as answers too. They come back fast (no lock-hold cost), the row is
 *   retried next cycle either way, and isolating them is the long-standing rule for first
 *   inserts (a rate-limited insert must not abort a first link's mass attach).
 * - A 401 says the access token itself was rejected, so every later call would fail too.
 * - A timeout, a network failure (`fetch failed` surfaces as a plain TypeError), any auth
 *   error and anything unknown are not answers at all: they abort the apply, so a Google that
 *   is unreachable is not called again row after row while the user's lock is held.
 */
function isRowScopedGoogleError(err: unknown): boolean {
  return err instanceof GoogleApiError && !(err instanceof GoogleTimeoutError) && err.status !== 401;
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
  /** Told about every row apply skips (see ApplyScheduleOptions.onRowFailure), for logging. */
  onRowFailure?: (failure: RowFailure) => void;
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
      now, horizonEnd, mirror, mirrorSnapshot: observed, isRowScoped: isRowScopedGoogleError, onRowFailure: deps.onRowFailure,
    });
  });

  // Every apply count (including the per-row failure counts, present only when non-zero) plus
  // drift's pulls from Google.
  return { ...counts, pinned, removed };
}
