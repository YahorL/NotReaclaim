import type { ScheduledBlockRepository, UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  toScheduledBlockInput,
  SettingsRequiredError,
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
}

/** Detect drift, recompute the desired schedule, and apply a keyed in-place diff to Google + DB. */
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

  const { pinned, removed } = await detectDrift(
    { client: deps.client, scheduledBlocks: deps.scheduledBlocks },
    userId,
    calendarId,
    accessToken,
    now,
    horizonEnd,
  );

  const desired = await computeDesiredSchedule(deps.schedulingRepos, userId, now);

  const existing = await deps.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
  const pinnedIds = new Set(existing.filter((b) => b.pinned).map((b) => b.id));
  const existingByKey = new Map(
    existing.filter((b) => !b.pinned && b.engineKey).map((b) => [b.engineKey as string, b]),
  );

  const desiredNew = desired.blocks.filter((b) => !pinnedIds.has(b.id));

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const seenKeys = new Set<string>();

  for (const block of desiredNew) {
    seenKeys.add(block.id);
    const match = existingByKey.get(block.id);
    if (match) {
      if (match.startsAt.getTime() !== block.start || match.endsAt.getTime() !== block.end) {
        await deps.client.updateEvent(accessToken, calendarId, match.googleEventId as string, toGoogleEventWrite(block));
        await deps.scheduledBlocks.update(userId, match.id, {
          startsAt: new Date(block.start),
          endsAt: new Date(block.end),
        });
        updated += 1;
      }
      continue;
    }
    const { googleEventId } = await deps.client.insertEvent(accessToken, calendarId, toGoogleEventWrite(block));
    await deps.scheduledBlocks.create(userId, {
      ...toScheduledBlockInput(block),
      engineKey: block.id,
      googleEventId,
      googleCalendarId: calendarId,
    });
    created += 1;
  }

  for (const [key, block] of existingByKey) {
    if (seenKeys.has(key)) continue;
    if (block.googleEventId) {
      await deps.client.deleteEvent(accessToken, calendarId, block.googleEventId);
    }
    await deps.scheduledBlocks.delete(userId, block.id);
    deleted += 1;
  }

  return { created, updated, deleted, pinned, removed };
}
