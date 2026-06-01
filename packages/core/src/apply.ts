import type { ScheduledBlock as DbScheduledBlock, ScheduledBlockRepository } from '@notreclaim/db';
import type { ScheduledBlock as EngineScheduledBlock, ScheduleResult } from '@notreclaim/scheduler';
import { toScheduledBlockInput } from './bridge.js';
import { computeDesiredSchedule } from './compute.js';
import { SettingsRequiredError } from './errors.js';
import type { SchedulingRepositories } from './assemble.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Side-effect adapter: mirror committed blocks to an external calendar (e.g. Google). */
export interface ScheduleMirror {
  create(block: EngineScheduledBlock): Promise<{ googleEventId: string; googleCalendarId: string }>;
  update(block: EngineScheduledBlock, existing: DbScheduledBlock): Promise<void>;
  delete(existing: DbScheduledBlock): Promise<void>;
}

type BlocksRepo = Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>;

export interface ApplyScheduleOptions {
  now: number;
  horizonEnd: number;
  mirror?: ScheduleMirror;
}

export interface ApplyCounts { created: number; updated: number; deleted: number }

/** Apply a desired schedule to the DB as a keyed (engineKey) in-place diff. With a mirror, also writes the external calendar. Without one, blocks persist with null google fields. */
export async function applyDesiredSchedule(
  scheduledBlocks: BlocksRepo,
  userId: string,
  desired: ScheduleResult,
  opts: ApplyScheduleOptions,
): Promise<ApplyCounts> {
  const { now, horizonEnd, mirror } = opts;
  const existing = await scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
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
        await mirror?.update(block, match);
        await scheduledBlocks.update(userId, match.id, { startsAt: new Date(block.start), endsAt: new Date(block.end) });
        updated += 1;
      }
      continue;
    }
    const ids = mirror ? await mirror.create(block) : null;
    await scheduledBlocks.create(userId, {
      ...toScheduledBlockInput(block),
      engineKey: block.id,
      googleEventId: ids?.googleEventId ?? null,
      googleCalendarId: ids?.googleCalendarId ?? null,
    });
    created += 1;
  }

  for (const [key, block] of existingByKey) {
    if (seenKeys.has(key)) continue;
    await mirror?.delete(block);
    await scheduledBlocks.delete(userId, block.id);
    deleted += 1;
  }

  return { created, updated, deleted };
}

export interface LocalPlanResult { created: number; updated: number; deleted: number; pinned: number; removed: number }

/** Compute the desired schedule and persist it to the DB with no external sync (no Google). */
export async function planLocally(
  repos: SchedulingRepositories,
  scheduledBlocks: BlocksRepo,
  userId: string,
  now: number,
): Promise<LocalPlanResult> {
  const settings = await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);
  const horizonEnd = now + settings.horizonDays * MS_PER_DAY;
  const desired = await computeDesiredSchedule(repos, userId, now);
  const { created, updated, deleted } = await applyDesiredSchedule(scheduledBlocks, userId, desired, { now, horizonEnd });
  return { created, updated, deleted, pinned: 0, removed: 0 };
}
