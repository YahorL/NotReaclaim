import type { ScheduledBlockRepository, UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  applyDesiredSchedule,
  SettingsRequiredError,
  type ScheduleMirror,
  type SchedulingRepositories,
} from '@notreclaim/core';
import type { GoogleClient } from './client.js';
import type { AccessTokenProvider } from './sync.js';
import { ensureAutoScheduledCalendar } from './ensure-calendar.js';
import { detectDrift } from './detect-drift.js';
import { toGoogleEventWrite } from './writeback.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReconcileDeps {
  client: GoogleClient;
  tokens: AccessTokenProvider;
  users: Pick<UserRepository, 'findById' | 'update'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>;
  schedulingRepos: SchedulingRepositories;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  pinned: number;
  removed: number;
  /** Google writes made for PINNED blocks (created events + pushed app-side moves). */
  pinnedSynced: number;
  /** PINNED blocks whose Google write failed this cycle (skipped, retried next cycle). */
  pinnedFailed: number;
}

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
  const horizonEnd = now + settings.horizonDays * MS_PER_DAY;

  const { pinned, removed, observed } = await detectDrift(
    { client: deps.client, scheduledBlocks: deps.scheduledBlocks },
    userId,
    calendarId,
    accessToken,
    now,
    horizonEnd,
  );

  const desired = await computeDesiredSchedule(deps.schedulingRepos, userId, now);

  const mirror: ScheduleMirror = {
    create: async (block) => {
      const { googleEventId } = await deps.client.insertEvent(accessToken, calendarId, toGoogleEventWrite(block));
      return { googleEventId, googleCalendarId: calendarId };
    },
    update: async (block, existing) => {
      await deps.client.updateEvent(accessToken, calendarId, existing.googleEventId as string, toGoogleEventWrite(block));
    },
    delete: async (existing) => {
      if (existing.googleEventId) await deps.client.deleteEvent(accessToken, calendarId, existing.googleEventId);
    },
  };

  // `observed` is Google's pre-apply state: it lets the pinned pass push exactly the blocks
  // the app moved, once, instead of re-writing every pinned event on every poll cycle.
  const { created, updated, deleted, pinnedSynced, pinnedFailed } = await applyDesiredSchedule(
    deps.scheduledBlocks, userId, desired, { now, horizonEnd, mirror, mirrorSnapshot: observed },
  );

  return { created, updated, deleted, pinned, removed, pinnedSynced, pinnedFailed };
}
