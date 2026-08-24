import type { ScheduledBlock as DbScheduledBlock, ScheduledBlockRepository } from '@notreclaim/db';
import { toScheduledBlock } from '@notreclaim/db/mappers';
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

/** What the external calendar currently holds for one mirrored event. */
export interface MirrorEventState { start: number; end: number; title: string | null }

/**
 * What the external calendar held at the start of this cycle, keyed by googleEventId
 * (Google: the events detectDrift just listed). It is the only way the pinned pass can
 * tell "the app moved this block" from "nothing changed", so pinned rows are pushed
 * once per real change instead of on every poll.
 */
export type MirrorSnapshot = ReadonlyMap<string, MirrorEventState>;

export interface ApplyScheduleOptions {
  now: number;
  horizonEnd: number;
  mirror?: ScheduleMirror;
  mirrorSnapshot?: MirrorSnapshot;
}

export interface ApplyCounts {
  created: number;
  updated: number;
  deleted: number;
  /** External-calendar writes made for PINNED rows (creates + pushed moves). */
  pinnedSynced: number;
}

/** Apply a desired schedule to the DB as a keyed (engineKey) in-place diff. With a mirror, also writes the external calendar. Without one, blocks persist with null google fields. */
export async function applyDesiredSchedule(
  scheduledBlocks: BlocksRepo,
  userId: string,
  desired: ScheduleResult,
  opts: ApplyScheduleOptions,
): Promise<ApplyCounts> {
  const { now, horizonEnd, mirror, mirrorSnapshot } = opts;
  // The keyed map must span ALL prior placements, not just [now, horizonEnd]: engine keys
  // (task:<id>:<chunk>, habit:<id>:<occurrence>) are horizon-relative and recur over time,
  // so a reissued key must MOVE its old (possibly past) row — unique (userId, engineKey) —
  // instead of colliding on create. History stays intact: the delete sweep skips past rows.
  const existing = await scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(horizonEnd));
  const pinnedIds = new Set(existing.filter((b) => b.pinned).map((b) => b.id));
  const existingByKey = new Map(
    existing.filter((b) => !b.pinned && b.engineKey).map((b) => [b.engineKey as string, b]),
  );
  // Pinned rows are detached from engine planning but may still hold a unique
  // (userId, engineKey) — e.g. a drag-pinned chunk, or a pinned row now in the past.
  const pinnedKeyHolders = new Map(
    existing.filter((b) => b.pinned && b.engineKey).map((b) => [b.engineKey as string, b]),
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
      const timesDiffer = match.startsAt.getTime() !== block.start || match.endsAt.getTime() !== block.end;
      // The title must be diffed too: renaming a task/habit leaves its kept slots byte-identical
      // in time, so a times-only diff would let the stale title persist here and on Google forever.
      const changed = timesDiffer || match.title !== block.title;
      if (changed) {
        await mirror?.update(block, match);
        await scheduledBlocks.update(userId, match.id, {
          startsAt: new Date(block.start), endsAt: new Date(block.end), title: block.title,
        });
        updated += 1;
      }
      continue;
    }
    const holder = pinnedKeyHolders.get(block.id);
    if (holder) {
      // Release the key from the pinned holder so the reissued placement can be created.
      await scheduledBlocks.update(userId, holder.id, { engineKey: null });
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
    if (block.endsAt.getTime() <= now) continue; // ended in the past: history, not a stale placement
    // A habit occurrence that has already STARTED is history too — missed or done, the
    // app has no habit-completion concept — so it freezes in place instead of vanishing
    // when the engine stops emitting its (now consumed) day. Tasks keep the old sweep:
    // an in-progress task placement superseded by a replan must still be removable.
    if (block.habitId != null && block.startsAt.getTime() <= now) continue;
    await mirror?.delete(block);
    await scheduledBlocks.delete(userId, block.id);
    deleted += 1;
  }

  const pinnedSynced = mirror
    ? await mirrorPinnedBlocks(scheduledBlocks, userId, existing, { now, mirror, mirrorSnapshot })
    : 0;

  return { created, updated, deleted, pinnedSynced };
}

/**
 * Mirror PINNED rows, which the engine diff above cannot see.
 *
 * Pinned rows are detached from engine planning, so they never reach the create/update
 * branches — which used to mean a block the user dropped on the planner (POST /schedule
 * stores `{pinned:true, googleEventId:null}`) was silently never written to Google, by any
 * cycle, ever. For these rows the APP is the source of truth: detectDrift only pulls a
 * pinned row back from Google when the Google event was edited more recently, so anything
 * still divergent here is an app-side move that must be pushed outbound.
 */
async function mirrorPinnedBlocks(
  scheduledBlocks: BlocksRepo,
  userId: string,
  existing: DbScheduledBlock[],
  opts: { now: number; mirror: ScheduleMirror; mirrorSnapshot?: MirrorSnapshot },
): Promise<number> {
  const { now, mirror, mirrorSnapshot } = opts;
  let synced = 0;

  for (const row of existing) {
    if (!row.pinned) continue;
    if (row.endsAt.getTime() <= now) continue; // ended: history, not worth a write
    if (!row.taskId && !row.habitId) continue; // not a mappable placement
    const block = toScheduledBlock(row); // engine id === row id (mappers.ts)

    if (row.googleEventId == null) {
      const ids = await mirror.create(block);
      // The row already exists — attach the external ids to it, never create a second one.
      await scheduledBlocks.update(userId, row.id, {
        googleEventId: ids.googleEventId,
        googleCalendarId: ids.googleCalendarId,
      });
      synced += 1;
      continue;
    }

    const snapshot = mirrorSnapshot?.get(row.googleEventId);
    if (!snapshot) continue; // nothing observed this cycle: never push blind (that would churn every poll)
    const timesDiffer = snapshot.start !== row.startsAt.getTime() || snapshot.end !== row.endsAt.getTime();
    // A null remote title carries no information (Google drops empty summaries), so only
    // a title we actually saw can count as divergence.
    const titleDiffers = snapshot.title != null && snapshot.title !== row.title;
    if (!timesDiffer && !titleDiffers) continue;
    await mirror.update(block, row);
    synced += 1;
  }

  return synced;
}

export interface LocalPlanResult {
  created: number; updated: number; deleted: number; pinned: number; removed: number; pinnedSynced: number;
}

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
  // No mirror locally, so nothing to push for pinned rows either.
  const { created, updated, deleted } = await applyDesiredSchedule(scheduledBlocks, userId, desired, { now, horizonEnd });
  return { created, updated, deleted, pinned: 0, removed: 0, pinnedSynced: 0 };
}
