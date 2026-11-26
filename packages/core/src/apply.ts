import type { ScheduledBlock as DbScheduledBlock, ScheduledBlockRepository, CreateScheduledBlockInput } from '@notreclaim/db';
import { toScheduledBlock } from '@notreclaim/db/mappers';
import type { ScheduledBlock as EngineScheduledBlock, ScheduleResult } from '@notreclaim/scheduler';
import { toScheduledBlockInput } from './bridge.js';
import { computeDesiredSchedule } from './compute.js';
import { SettingsRequiredError } from './errors.js';
import type { SchedulingRepositories } from './assemble.js';
import { horizonEndMs } from './time-windows.js';
import { isFrozenTaskRow } from './spent.js';

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
  /** Remove a row's event. A row with no googleEventId has none: that call is a no-op (no external call). */
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
  /**
   * Settings.requireStartToTrack. In automatic tracking (false) an un-pinned task row whose start
   * has passed is frozen (isFrozenTaskRow): never moved or swept, and it gives its engine key up
   * when the engine reissues it. Required, so no caller can silently fall back to a mode.
   */
  requireStartToTrack: boolean;
  mirror?: ScheduleMirror;
  mirrorSnapshot?: MirrorSnapshot;
  /**
   * Further errors that belong to ONE row and may be isolated to it (see the diff loop), on
   * top of the db layer's own (isRowScopedDbError). Google's reconcile passes its own: an API
   * answer about one event. Anything neither predicate claims aborts the apply.
   */
  isRowScoped?: (err: unknown) => boolean;
  /**
   * Of the caller's row-scoped errors, the ones that may be systemic rather than about the one
   * row (Google: a 5xx or 429 answer). Each is isolated, but MAX_TRANSIENT_STREAK of them in
   * a row open the circuit: the apply makes no further external call (see applyDesiredSchedule).
   * DB errors are never transient.
   */
  isTransient?: (err: unknown) => boolean;
  /**
   * Told about every write failure the apply isolates, with the row and the error, so the
   * caller can log them: the counts deliberately carry no error objects (they are sent to
   * clients). A compensating event delete that failed (the event is left behind) is reported
   * as an extra 'orphan' entry next to the row's own failure, without a count of its own. The
   * circuit opening is reported once, as a 'circuit-open' entry carrying the failure that
   * opened it; the steps skipped after it are only counted. A callback that throws is
   * ignored: reporting never aborts the apply.
   */
  onRowFailure?: (failure: RowFailure) => void;
}

/** One row the apply skipped: what it was doing, which row (null for a not-yet-created one), and why. */
export interface RowFailure {
  kind: 'create' | 'update' | 'delete' | 'attach' | 'pinned' | 'orphan' | 'circuit-open';
  blockId: string | null;
  engineKey: string | null;
  error: unknown;
}

/**
 * Consecutive transient external failures (see ApplyScheduleOptions.isTransient) after which
 * the circuit opens and the apply makes no further external call: a struggling external
 * calendar is not called once per remaining row while the user's lock is held, and a 5xx may
 * even have been applied remotely (the next cycle's drift would then pin that row at the
 * remote time).
 */
const MAX_TRANSIENT_STREAK = 3;

/** Upper bound for "every row": a plain ISO year the database stores as is. */
const END_OF_TIME = new Date('9999-12-31T23:59:59.999Z');

/** Thrown, instead of making the call, by the mirror once the circuit is open. */
class ExternalCallSkipped extends Error {
  constructor() {
    super('external call skipped: too many consecutive transient failures in this apply');
    this.name = 'ExternalCallSkipped';
  }
}

/**
 * A DB error that belongs to the one row being written, so the diff loop may skip that row
 * and carry on: the repository's NotFoundError (the row is gone, e.g. cascaded with its
 * deleted task) or ConflictError (a unique key), and a foreign-key violation (Prisma P2003,
 * left untranslated by the repository: the row's task/habit was deleted meanwhile). Matched by
 * name/code because core imports @notreclaim/db for types only. Anything else — the database
 * unreachable, a reset connection, a pool timeout, an unknown error — would fail every later
 * row too, so it must abort.
 */
export function isRowScopedDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'NotFoundError' || err.name === 'ConflictError') return true;
  return (err as { code?: unknown }).code === 'P2003';
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
  /**
   * Rows of the main diff whose write threw and was skipped (retried next cycle): a desired
   * block that could not be created, an existing engine row that could not be moved/renamed,
   * a stale engine row that could not be swept. Unlike the counts above these are present
   * only when non-zero, so the result of a clean run keeps its long-standing shape.
   */
  createFailed?: number;
  updateFailed?: number;
  deleteFailed?: number;
}

/** Apply a desired schedule to the DB as a keyed (engineKey) in-place diff. With a mirror, also writes the external calendar. Without one, blocks persist with null google fields. */
export async function applyDesiredSchedule(
  scheduledBlocks: BlocksRepo,
  userId: string,
  desired: ScheduleResult,
  opts: ApplyScheduleOptions,
): Promise<ApplyCounts> {
  const { now, horizonEnd, mirrorSnapshot } = opts;
  // The streak of transient external failures: only isTransient errors extend it, a successful
  // external call resets it, other isolated failures leave it be. At MAX_TRANSIENT_STREAK the
  // circuit opens for the rest of this apply: the mirror then throws ExternalCallSkipped
  // instead of calling out, so every step that needs an external call fails like an isolated
  // row (counted, no DB write — Google first) while steps that need none still run, and the
  // apply returns its counts (the caller announces them; the next cycle retries).
  let transientStreak = 0;
  let circuitOpen = false;
  const mirror: ScheduleMirror | undefined = opts.mirror && guardedMirror(opts.mirror, {
    isOpen: () => circuitOpen,
    onSuccess: () => { transientStreak = 0; },
  });
  // Per-row isolation: a row whose write throws an error that belongs to that row alone is
  // skipped and counted, and the loop goes on. Every other error is rethrown, aborting the
  // apply at that row exactly as before isolation existed — so a database or network outage
  // stops at the first row instead of pushing every remaining row to Google with no DB write.
  const skipIfRowScoped = (err: unknown): void => {
    if (err instanceof ExternalCallSkipped || isRowScopedDbError(err)) return;
    if (!opts.isRowScoped?.(err)) throw err;
    if (opts.isTransient?.(err) && ++transientStreak >= MAX_TRANSIENT_STREAK && !circuitOpen) {
      circuitOpen = true;
      report('circuit-open', null, null, err);
    }
  };
  const report = (kind: RowFailure['kind'], row: { id: string; engineKey: string | null } | null, engineKey: string | null, error: unknown) => {
    if (error instanceof ExternalCallSkipped) return; // counted only: 'circuit-open' says why
    try {
      opts.onRowFailure?.({ kind, blockId: row?.id ?? null, engineKey: row?.engineKey ?? engineKey, error });
    } catch {
      // reporting is best effort: a failing logger must never abort the apply
    }
  };
  const reportOrphan = (row: DbScheduledBlock | null, engineKey: string | null) =>
    (err: unknown) => report('orphan', row, engineKey, err);
  // The keyed map must span ALL prior placements, not just [now, horizonEnd]: engine keys
  // (task:<id>:<chunk>, habit:<id>:<occurrence>) are horizon-relative and recur over time,
  // so a reissued key must not collide on create (unique (userId, engineKey)). A key held by a
  // pinned or frozen row is taken off that row (below); any other old row is MOVED to the new
  // placement — in automatic tracking that is never a task row whose start has passed (frozen),
  // so tracked time is never moved. History stays intact: the delete sweep skips past rows.
  // No upper bound either: after the user shortens horizonDays, rows planned beyond the new
  // horizon still hold their keys, and a reissued one must move (or be released), not collide
  // on every cycle; one no longer issued is swept like any stale future row.
  const existing = await scheduledBlocks.listByUserInRange(userId, new Date(0), END_OF_TIME);
  const pinnedIds = new Set<string>();
  const existingByKey = new Map<string, DbScheduledBlock>();
  // Pinned rows are detached from engine planning but may still hold a unique
  // (userId, engineKey) — e.g. a drag-pinned chunk, or a pinned row now in the past. Frozen task
  // rows (automatic tracking, start passed) are treated exactly the same here: never matched,
  // so never moved; not in existingByKey, so never swept; their engine echo (assemble passes
  // the running ones as pinned blocks) is skipped by row id; their key is released on reissue.
  // Unlike pinned rows they are not pushed by the pinned pass: nothing ever changes their times.
  const pinnedKeyHolders = new Map<string, DbScheduledBlock>();
  for (const b of existing) {
    if (b.pinned || isFrozenTaskRow(b, now, opts.requireStartToTrack)) {
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
  let createFailed = 0;
  let updateFailed = 0;
  let deleteFailed = 0;
  const seenKeys = new Set<string>();

  // Every row's writes are isolated, like the pinned pass (see mirrorPinnedBlocks): one row
  // that fails (a rejected Google call — rate limit, transient 5xx — or a DB write whose task
  // was deleted a moment ago) must not abort the apply, or later blocks, the sweep, the pinned
  // pass and the schedule.updated event would all be skipped, on every cycle, for as long as
  // that row keeps failing. A failed row is counted (createFailed / updateFailed /
  // deleteFailed, or attachFailed for a failed first insert) and retried next cycle; a row
  // whose insert failed stays unmirrored and is retried by the unchanged-row branch below.
  // Only errors that belong to the row are isolated (skipIfRowScoped); any other error
  // aborts. The order of writes is unchanged.
  for (const block of desiredNew) {
    seenKeys.add(block.id);
    const match = existingByKey.get(block.id);
    if (match) {
      const timesDiffer = match.startsAt.getTime() !== block.start || match.endsAt.getTime() !== block.end;
      // The title must be diffed too: renaming a task/habit leaves its kept slots byte-identical
      // in time, so a times-only diff would let the stale title persist here and on Google forever.
      const changed = timesDiffer || match.title !== block.title;
      if (changed) {
        // Isolated per row: a failed Google push skips the DB write too (Google goes first),
        // and a failed DB write (e.g. the row went with its deleted task) leaves the row as
        // it was. Either way the next cycle retries it.
        try {
          const fields = { startsAt: new Date(block.start), endsAt: new Date(block.end), title: block.title };
          // A never-mirrored row makes the mirror INSERT here (ScheduleMirror.update).
          const unmirrored = mirror != null && match.googleEventId == null;
          let ids: MirrorIds | undefined;
          // A failed first insert is counted once the move below has landed: a row whose move
          // fails too counts once, as updateFailed (its plan did not apply at all).
          let insertError: { error: unknown } | null = null;
          try {
            ids = await mirror?.update(block, match);
          } catch (err) {
            if (!unmirrored) throw err; // an in-place update of a mirrored row fails the row
            skipIfRowScoped(err);
            insertError = { error: err }; // the plan still applies below; the row is retried next cycle
          }
          if (ids && mirror) {
            const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, match, ids, reportOrphan(match, block.id), fields);
            if (outcome === 'stored') {
              updated += 1;
              attached += 1;
            } else if (outcome === 'orphaned') {
              attachFailed += 1;
            }
            continue;
          }
          try {
            await scheduledBlocks.update(userId, match.id, fields);
          } catch (err) {
            // The row is gone (a cascade from its deleted task/habit) but Google was just
            // moved: nothing references that event any more, so remove it (best effort).
            if (mirror && !unmirrored && isNotFoundError(err)) await deleteQuietly(mirror, match, reportOrphan(match, block.id));
            throw err;
          }
          updated += 1;
          if (insertError) {
            attachFailed += 1;
            report('attach', match, block.id, insertError.error);
          }
        } catch (err) {
          skipIfRowScoped(err);
          updateFailed += 1;
          report('update', match, block.id, err);
        }
      } else if (mirror && match.googleEventId == null) {
        // Planned locally before the calendar was linked and unchanged since: the diff alone
        // would never mirror it, so the block would stay missing from the calendar for good.
        let ids: MirrorIds;
        try {
          ids = await mirror.create(block);
        } catch (err) {
          skipIfRowScoped(err);
          attachFailed += 1;
          report('attach', match, block.id, err);
          continue;
        }
        try {
          const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, match, ids, reportOrphan(match, block.id));
          if (outcome === 'stored') attached += 1;
          else if (outcome === 'orphaned') attachFailed += 1;
        } catch (err) {
          // Storing the ids failed for another reason than a vanished row: the row may still
          // exist (and may even hold the ids), so the event is not deleted blind.
          skipIfRowScoped(err);
          attachFailed += 1;
          report('attach', match, block.id, err);
        }
      }
      continue;
    }
    try {
      const holder = pinnedKeyHolders.get(block.id);
      if (holder) {
        // Release the key from the pinned holder so the reissued placement can be created.
        await scheduledBlocks.update(userId, holder.id, { engineKey: null });
      }
      const ids = mirror ? await mirror.create(block) : null;
      const input = {
        ...toScheduledBlockInput(block),
        engineKey: block.id,
        googleEventId: ids?.googleEventId ?? null,
        googleCalendarId: ids?.googleCalendarId ?? null,
      };
      try {
        await scheduledBlocks.create(userId, input);
      } catch (err) {
        // A foreign-key or unique-key rejection proves the row was never stored, so nothing
        // will ever reference the just-inserted event: remove it (best effort). Any other
        // failure may have committed anyway (a lost reply), so that event is left alone.
        if (mirror && ids && isRejectedCreate(err)) await deleteQuietly(mirror, unsavedRow(userId, input, now), reportOrphan(null, block.id));
        throw err;
      }
      created += 1;
    } catch (err) {
      skipIfRowScoped(err);
      createFailed += 1;
      report('create', null, block.id, err);
    }
  }

  for (const [key, block] of existingByKey) {
    if (seenKeys.has(key)) continue;
    if (block.endsAt.getTime() <= now) continue; // ended in the past: history, not a stale placement
    // A habit occurrence that has already STARTED is history too — missed or done, the
    // app has no habit-completion concept — so it freezes in place instead of vanishing
    // when the engine stops emitting its (now consumed) day. Task rows that have begun reach
    // this sweep only in manual tracking (in automatic tracking they are frozen, see above), so
    // there an in-progress un-started placement superseded by a replan is still removable.
    if (block.habitId != null && block.startsAt.getTime() <= now) continue;
    try {
      // Google first: a failed event delete keeps the row, so the next cycle retries both.
      await mirror?.delete(block);
      await scheduledBlocks.delete(userId, block.id);
      deleted += 1;
    } catch (err) {
      skipIfRowScoped(err);
      deleteFailed += 1;
      report('delete', block, key, err);
    }
  }

  const { synced: pinnedSynced, failed: pinnedFailed } = mirror
    // Only pinned rows inside the horizon, as before the read lost its upper bound: drift lists
    // Google only up to the horizon, so further out there is no snapshot to arbitrate a push
    // against, and a never-mirrored row there is not mirrored ahead of time.
    ? await mirrorPinnedBlocks(scheduledBlocks, userId, existing.filter((b) => b.startsAt.getTime() < horizonEnd), {
      now, mirror, mirrorSnapshot,
      onFailure: (row, err) => report('pinned', row, null, err),
      onOrphan: (row, err) => report('orphan', row, null, err),
    })
    : { synced: 0, failed: 0 };

  return {
    created, updated, deleted, pinnedSynced, pinnedFailed, attached, attachFailed,
    ...(createFailed ? { createFailed } : {}),
    ...(updateFailed ? { updateFailed } : {}),
    ...(deleteFailed ? { deleteFailed } : {}),
  };
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
  opts: {
    now: number;
    mirror: ScheduleMirror;
    mirrorSnapshot?: MirrorSnapshot;
    onFailure?: (row: DbScheduledBlock, err: unknown) => void;
    onOrphan?: (row: DbScheduledBlock, err: unknown) => void;
  },
): Promise<{ synced: number; failed: number }> {
  const { now, mirror, mirrorSnapshot } = opts;
  let synced = 0;
  let failed = 0;

  for (const row of existing) {
    if (!row.pinned) continue;
    // Ended: history, not worth a write — unless its event still runs past now. Stop (and
    // completing a task mid-piece) moves the end down to round15(now), which can already be in
    // the past: the shortened end must still reach the event once. Drift never fixes it (it
    // only reads rows overlapping [now, horizon]), and after this push the event ends before
    // now, drops out of drift's listing and is never pushed again.
    if (row.endsAt.getTime() <= now) {
      const observed = row.googleEventId ? mirrorSnapshot?.get(row.googleEventId) : undefined;
      if (!observed || observed.end <= now) continue;
    }
    if (!row.taskId && !row.habitId) continue; // not a mappable placement
    const block = toScheduledBlock(row); // engine id === row id (mappers.ts)

    try {
      if (row.googleEventId == null) {
        const ids = await mirror.create(block);
        const outcome = await storeInsertedIds(scheduledBlocks, mirror, userId, row, ids, (err) => opts.onOrphan?.(row, err));
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
    } catch (err) {
      failed += 1;
      opts.onFailure?.(row, err);
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
 * between: deleting a task or habit cascades to its blocks, and none of that is serialised
 * with the replan (the block routes are, via the server's per-user lock, but only when the
 * caller runs apply inside it). The write then fails with the repository's NotFoundError and nothing
 * would ever reference the new event again (drift detection only walks rows), so the event is
 * deleted again and the row treated as gone. Any other DB failure propagates unchanged (to
 * the caller's per-row isolation) — the row may still exist, so its event is never deleted blind.
 */
async function storeInsertedIds(
  scheduledBlocks: BlocksRepo,
  mirror: ScheduleMirror,
  userId: string,
  row: DbScheduledBlock,
  ids: MirrorIds,
  onOrphan: (err: unknown) => void,
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
  } catch (err) {
    onOrphan(err);
    return 'orphaned';
  }
}

/**
 * The mirror as the apply uses it: while `isOpen()` every external call is skipped (throws
 * ExternalCallSkipped), and each external call that succeeds calls `onSuccess`. Deleting a row
 * with no event is no external call (ScheduleMirror.delete), so it is neither skipped nor a
 * success.
 */
function guardedMirror(mirror: ScheduleMirror, circuit: { isOpen: () => boolean; onSuccess: () => void }): ScheduleMirror {
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (circuit.isOpen()) throw new ExternalCallSkipped();
    const out = await fn();
    circuit.onSuccess();
    return out;
  };
  return {
    create: (block) => call(() => mirror.create(block)),
    update: (block, existing) => call(() => mirror.update(block, existing)),
    // Falsiness, exactly like reconcile's mirror (`if (existing.googleEventId) deleteEvent…`).
    delete: (existing) => (!existing.googleEventId ? mirror.delete(existing) : call(() => mirror.delete(existing))),
  };
}

/** A create the database refused outright: the row provably does not exist. */
function isRejectedCreate(err: unknown): boolean {
  return err instanceof Error && (err.name === 'ConflictError' || (err as { code?: unknown }).code === 'P2003');
}

/** The shape mirror.delete expects, for an event whose row was never stored (it reads only the ids). */
function unsavedRow(userId: string, input: CreateScheduledBlockInput, now: number): DbScheduledBlock {
  const at = new Date(now);
  return {
    id: '', userId, taskId: input.taskId ?? null, habitId: input.habitId ?? null, title: input.title,
    startsAt: input.startsAt, endsAt: input.endsAt, pinned: false, engineKey: input.engineKey ?? null,
    googleEventId: input.googleEventId ?? null, googleCalendarId: input.googleCalendarId ?? null,
    startedAt: null, createdAt: at, updatedAt: at,
  };
}

/** Best-effort compensating event delete: its failure leaves an orphan event (reported), never fails the row. */
async function deleteQuietly(mirror: ScheduleMirror, row: DbScheduledBlock, onOrphan: (err: unknown) => void): Promise<void> {
  try {
    await mirror.delete(row);
  } catch (err) {
    onOrphan(err); // orphaned on the external calendar; the row's own failure is what gets counted
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
 * The settings read, the compute (its block read) and the whole apply run inside `exclusive`,
 * and assemble and apply share that one settings read: the tracking mode decides which rows
 * are frozen, so the two must never see different modes (a PUT /settings landing while the
 * replan waits for the lock would otherwise double-count or sweep a running piece).
 */
export async function planLocally(
  repos: SchedulingRepositories,
  scheduledBlocks: BlocksRepo,
  userId: string,
  now: number,
  exclusive: Exclusive = runDirectly,
  onRowFailure?: (failure: RowFailure) => void,
): Promise<ReplanCounts> {
  const counts = await exclusive(async () => {
    const settings = await repos.settings.getByUserId(userId);
    if (!settings) throw new SettingsRequiredError(userId);
    const horizonEnd = horizonEndMs(now, settings.horizonDays);
    const desired = await computeDesiredSchedule(repos, userId, now, settings);
    // No mirror locally, so nothing to push for pinned rows either: apply reports
    // pinnedSynced/pinnedFailed as 0 on this path.
    return applyDesiredSchedule(scheduledBlocks, userId, desired, {
      now, horizonEnd, requireStartToTrack: settings.requireStartToTrack, onRowFailure,
    });
  });
  return { ...counts, pinned: 0, removed: 0 };
}
