import type { ScheduledBlock as DbScheduledBlock, ScheduledBlockRepository } from '@notreclaim/db';
import { toScheduledBlock } from '@notreclaim/db/mappers';
import type { ScheduledBlock as EngineScheduledBlock, ScheduleResult } from '@notreclaim/scheduler';
import { toScheduledBlockInput } from './bridge.js';
import { computeDesiredSchedule } from './compute.js';
import { SettingsRequiredError } from './errors.js';
import type { SchedulingRepositories } from './assemble.js';
import { horizonEndMs } from './time-windows.js';

/** The external calendar's ids for one mirrored block. */
export interface MirrorIds {
  googleEventId: string;
  googleCalendarId: string;
}

/** Side-effect adapter: mirror committed blocks to an external calendar (e.g. Google). */
export interface ScheduleMirror {
  create(block: EngineScheduledBlock): Promise<MirrorIds>;
  /**
   * Push a changed block. `existing` may have never been mirrored (planned locally before the
   * calendar was linked: null ids); the mirror then creates the event and returns its ids,
   * which the caller stores on the row. A plain in-place update returns undefined.
   */
  update(block: EngineScheduledBlock, existing: DbScheduledBlock): Promise<MirrorIds | undefined>;
  delete(existing: DbScheduledBlock): Promise<void>;
}

export type BlocksRepo = Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>;

/** What the external calendar currently holds for one mirrored event. */
export interface MirrorEventState {
  start: number;
  end: number;
  title: string | null;
  /** External last-modification stamp (ms epoch), when the provider reports one. */
  updatedAt?: number;
}

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
  /** PINNED rows whose external write threw and was swallowed (retried next cycle). */
  pinnedFailed: number;
  /**
   * Engine rows that had no external event (planned before the calendar was linked) and got
   * one this cycle. A changed row that got one counts here AND in `updated`.
   * applyDesiredSchedule always sets it; optional only so ReplanCounts producers and fixtures
   * written before it existed still type-check.
   */
  attached?: number;
  /**
   * Engine rows whose external insert threw and was swallowed (the row stays unmirrored and is
   * retried next cycle), plus rows deleted mid-apply whose just-inserted event could not be
   * removed again. Always set by applyDesiredSchedule; optional for the same reason.
   */
  attachFailed?: number;
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
  const pinnedIds = new Set<string>();
  const existingByKey = new Map<string, DbScheduledBlock>();
  // Pinned rows are detached from engine planning but may still hold a unique
  // (userId, engineKey) — e.g. a drag-pinned chunk, or a pinned row now in the past.
  const pinnedKeyHolders = new Map<string, DbScheduledBlock>();
  for (const b of existing) {
    if (b.pinned) {
      pinnedIds.add(b.id);
      if (b.engineKey) pinnedKeyHolders.set(b.engineKey, b);
    } else if (b.engineKey) {
      existingByKey.set(b.engineKey, b);
    }
  }

  const desiredNew = desired.blocks.filter((b) => !pinnedIds.has(b.id));

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let attached = 0;
  let attachFailed = 0;
  const seenKeys = new Set<string>();

  // Inserting the event of a never-mirrored row is isolated per row, like the pinned pass
  // (see mirrorPinnedBlocks): the first reconcile after linking Google makes one insert per
  // planned block, and a single rejected one (rate limit, transient 5xx) must not abort the
  // apply — later blocks, the sweep, the pinned pass and the schedule.updated event would all
  // be skipped, on every cycle, for as long as that row keeps failing. A row whose insert
  // failed stays unmirrored and is retried next cycle by the unchanged-row branch below.
  for (const block of desiredNew) {
    seenKeys.add(block.id);
    const match = existingByKey.get(block.id);
    if (match) {
      const timesDiffer = match.startsAt.getTime() !== block.start || match.endsAt.getTime() !== block.end;
      // The title must be diffed too: renaming a task/habit leaves its kept slots byte-identical
      // in time, so a times-only diff would let the stale title persist here and on Google forever.
      const changed = timesDiffer || match.title !== block.title;
      if (changed) {
        const fields = { startsAt: new Date(block.start), endsAt: new Date(block.end), title: block.title };
        // A never-mirrored row makes the mirror INSERT here (ScheduleMirror.update).
        const unmirrored = mirror != null && match.googleEventId == null;
        let ids: MirrorIds | undefined;
        try {
          ids = await mirror?.update(block, match);
        } catch (err) {
          if (!unmirrored) throw err; // an in-place update of a mirrored row is not isolated
          attachFailed += 1; // the plan still applies below; the row is retried next cycle
        }
        if (ids && mirror) {
          const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, match, ids, fields);
          if (outcome === 'stored') {
            updated += 1;
            attached += 1;
          } else if (outcome === 'orphaned') {
            attachFailed += 1;
          }
          continue;
        }
        await scheduledBlocks.update(userId, match.id, fields);
        updated += 1;
      } else if (mirror && match.googleEventId == null) {
        // Planned locally before the calendar was linked and unchanged since: the diff alone
        // would never mirror it, so the block would stay missing from the calendar for good.
        let ids: MirrorIds;
        try {
          ids = await mirror.create(block);
        } catch {
          attachFailed += 1;
          continue;
        }
        const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, match, ids);
        if (outcome === 'stored') attached += 1;
        else if (outcome === 'orphaned') attachFailed += 1;
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

  const { synced: pinnedSynced, failed: pinnedFailed } = mirror
    ? await mirrorPinnedBlocks(scheduledBlocks, userId, existing, { now, mirror, mirrorSnapshot })
    : { synced: 0, failed: 0 };

  return { created, updated, deleted, pinnedSynced, pinnedFailed, attached, attachFailed };
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
 *
 * Every row is isolated: one external write that throws is counted and skipped, never
 * allowed to reject the pass. A rejection here would abort the whole reconcile, so no
 * `schedule.updated` would be emitted — one deterministically-failing row would leave a
 * user with no live updates at all. A skipped row simply retries on the next cycle.
 */
async function mirrorPinnedBlocks(
  scheduledBlocks: BlocksRepo,
  userId: string,
  existing: DbScheduledBlock[],
  opts: { now: number; mirror: ScheduleMirror; mirrorSnapshot?: MirrorSnapshot },
): Promise<{ synced: number; failed: number }> {
  const { now, mirror, mirrorSnapshot } = opts;
  let synced = 0;
  let failed = 0;

  for (const row of existing) {
    if (!row.pinned) continue;
    if (row.endsAt.getTime() <= now) continue; // ended: history, not worth a write
    if (!row.taskId && !row.habitId) continue; // not a mappable placement
    const block = toScheduledBlock(row); // engine id === row id (mappers.ts)

    try {
      if (row.googleEventId == null) {
        const ids = await mirror.create(block);
        const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, row, ids);
        // 'gone': the user deleted the row mid-apply and its event was removed again.
        if (outcome === 'stored') synced += 1;
        else if (outcome === 'orphaned') failed += 1;
        continue;
      }

      const snapshot = mirrorSnapshot?.get(row.googleEventId);
      if (!snapshot) continue; // nothing observed this cycle: never push blind (that would churn every poll)
      // One arbitration governs BOTH fields. detectDrift pulls a Google-newer TIME edit into
      // the row, but it compares times only — a Google-side RENAME never reaches the row, so
      // pushing here would silently overwrite the user's calendar edit with our stale title.
      // Same rule as detectDrift's: whoever edited last wins; no stamp at all -> the app wins.
      if (snapshot.updatedAt != null && snapshot.updatedAt > row.updatedAt.getTime()) continue;
      const timesDiffer = snapshot.start !== row.startsAt.getTime() || snapshot.end !== row.endsAt.getTime();
      // A null remote title carries no information (Google drops empty summaries), so only
      // a title we actually saw can count as divergence.
      const titleDiffers = snapshot.title != null && snapshot.title !== row.title;
      if (!timesDiffer && !titleDiffers) continue;
      await mirror.update(block, row);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
}

/**
 * What became of a just-inserted external event: its ids were stored on the row; the row was
 * gone and the event was deleted again; or the row was gone and that delete failed too, so
 * the event is left behind in the calendar (surfaced as a failure by the caller).
 */
type StoreOutcome = 'stored' | 'gone' | 'orphaned';

/**
 * Store a freshly inserted external event's ids on its EXISTING row (never create a second
 * row), together with any other `fields` changed in the same write.
 *
 * The event is inserted first and the ids written after, and the row can disappear in
 * between: DELETE /schedule/:id and GET /schedule's manual-mode sweep run outside the
 * per-user replan queue. The write then fails with the repository's NotFoundError and nothing
 * would ever reference the new event again (drift detection only walks rows), so the event is
 * deleted again and the row treated as gone. Any other DB failure propagates unchanged — the
 * row may still exist, so its event is never deleted blind.
 */
async function storeInsertedIds(
  scheduledBlocks: BlocksRepo,
  mirror: ScheduleMirror,
  userId: string,
  row: DbScheduledBlock,
  ids: MirrorIds,
  fields: { startsAt?: Date; endsAt?: Date; title?: string } = {},
): Promise<StoreOutcome> {
  try {
    await scheduledBlocks.update(userId, row.id, {
      ...fields,
      googleEventId: ids.googleEventId,
      googleCalendarId: ids.googleCalendarId,
    });
    return 'stored';
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  try {
    await mirror.delete({ ...row, googleEventId: ids.googleEventId, googleCalendarId: ids.googleCalendarId });
    return 'gone';
  } catch {
    return 'orphaned';
  }
}

/**
 * The repository's NotFoundError (@notreclaim/db errors.ts: missing or not-owned row, raised by
 * updateOwned). Matched by name because core imports @notreclaim/db for types only — its index
 * module instantiates the Prisma client on load.
 */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotFoundError';
}

/**
 * Outcome of one replan cycle, local or Google. `pinned`/`removed` count drift pulled in
 * from the external calendar (Google's detectDrift); a local plan has none, so both are 0.
 */
export interface ReplanCounts extends ApplyCounts {
  pinned: number;
  removed: number;
}

/**
 * Runs `fn` as one critical section, resolving or rejecting exactly as `fn` does. The server
 * passes its per-user lock here, so a replan's read-diff-write and the block routes'
 * read-modify-writes never interleave (a drag committed between apply's read and its writes
 * would otherwise be overwritten or swept by the stale plan).
 */
export type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

/** No lock: run the section directly (tests, and callers with nothing to exclude). */
const runDirectly: Exclusive = (fn) => fn();

/**
 * Compute the desired schedule and persist it to the DB with no external sync (no Google).
 * The compute (its block read) and the whole apply run inside `exclusive`.
 */
export async function planLocally(
  repos: SchedulingRepositories,
  scheduledBlocks: BlocksRepo,
  userId: string,
  now: number,
  exclusive: Exclusive = runDirectly,
): Promise<ReplanCounts> {
  const settings = await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);
  const horizonEnd = horizonEndMs(now, settings.horizonDays);
  const counts = await exclusive(async () => {
    const desired = await computeDesiredSchedule(repos, userId, now);
    // No mirror locally, so nothing to push for pinned rows either: apply reports
    // pinnedSynced/pinnedFailed as 0 on this path.
    return applyDesiredSchedule(scheduledBlocks, userId, desired, { now, horizonEnd });
  });
  return { ...counts, pinned: 0, removed: 0 };
}
