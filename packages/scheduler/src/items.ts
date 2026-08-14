import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { intersectIntervals, mergeIntervals, subtractIntervals } from './intervals.js';
import { placeItem, splitDuration } from './placement.js';

export interface ScheduleItemResult {
  blocks: ScheduledBlock[];
  free: Interval[];
  unscheduled: UnscheduledItem[];
  /**
   * Margin that a placement did NOT reserve because it fell inside the supplied
   * preferred-window union (see `windowReservation`). Always empty for tasks and
   * for placements that reserve their full padding. `schedule()` re-reserves the
   * parts of it no habit ends up occupying — see its reconciliation step.
   */
  suspendedMargins: Interval[];
}

/** Split a task into chunks and place them before its due date. */
export function scheduleTask(free: Interval[], task: FlexibleTask, gapMs = 0): ScheduleItemResult {
  const chunkSizes = splitDuration(task.durationMs, task.minChunkMs, task.maxChunkMs);
  const result = placeItem(free, chunkSizes, task.dueBy, task.allowedWindows, gapMs);

  const blocks: ScheduledBlock[] = result.placements.map((p, i) => ({
    id: `task:${task.id}:${i}`,
    sourceType: 'task',
    sourceId: task.id,
    title: task.title,
    start: p.start,
    end: p.end,
  }));

  const remainingMs = result.unplaced.reduce((a, b) => a + b, 0);
  const unscheduled: UnscheduledItem[] =
    remainingMs > 0
      ? [
          {
            sourceType: 'task',
            sourceId: task.id,
            title: task.title,
            reason: 'insufficient free time before due date',
            remainingMs,
          },
        ]
      : [];

  return { blocks, free: result.free, unscheduled, suspendedMargins: [] };
}

/**
 * Cap state for "one habit occurrence per allowed-window day": the allowed (and
 * matching preferred) windows a habit may still be placed into. `allowed` stays
 * `undefined` for habits without `allowedWindows`, which are exempt from the cap.
 */
interface HabitWindowBudget {
  allowed: Interval[] | undefined;
  preferred: Interval[] | undefined;
}

/**
 * Drop the `allowed` entry containing `time` from the budget (and subtract it
 * from `preferred`), so no further occurrence can land on that day.
 *
 * Entries are day-granular by construction — core's `expandHabit` emits one per
 * eligible day — so consuming the containing entry is exactly "one per calendar
 * day" without any timezone logic in the engine.
 *
 * Returns the consumed entry (used as the occurrence's stable day identity), or
 * `undefined` when the habit is uncapped or the day was already consumed.
 */
function consumeWindowContaining(
  budget: HabitWindowBudget,
  time: number,
): Interval | undefined {
  if (!budget.allowed) return undefined;
  const day = budget.allowed.find((w) => time >= w.start && time < w.end);
  if (!day) return undefined;
  budget.allowed = budget.allowed.filter((w) => w !== day);
  if (budget.preferred) {
    budget.preferred = subtractIntervals(budget.preferred, [day]);
  }
  return day;
}

/**
 * Stable id for one habit occurrence.
 *
 * Capped habits (those with `allowedWindows`) key on the allowed entry the
 * occurrence's day was consumed from: the one-per-day cap makes that day unique
 * within a run, so an occurrence keeps its id across replans no matter how many
 * other occurrences appear, move or disappear — no index shifting exists.
 * Uncapped habits have no day identity and fall back to the ordinal.
 */
function occurrenceId(habitId: string, day: Interval | undefined, index: number): string {
  return `habit:${habitId}:${day ? day.start : index}`;
}

/** True when `time` still falls in an unconsumed allowed entry (always for uncapped habits). */
function dayAvailable(budget: HabitWindowBudget, time: number): boolean {
  if (!budget.allowed) return true;
  return budget.allowed.some((w) => time >= w.start && time < w.end);
}

/**
 * When a habit states a preference, stickiness must not outrank it: a prior slot
 * sitting outside every preferred window is re-placed (preferred-first) instead
 * of being kept forever. Habits with no preference keep their slots unchanged.
 *
 * `preferred` is expected pre-merged (see `preferredBounds`), so a slot straddling
 * two touching preferred windows still counts as "fully inside one".
 */
function insidePreferred(preferred: Interval[] | undefined, slot: Interval): boolean {
  if (!preferred) return true;
  return preferred.some((w) => slot.start >= w.start && slot.end <= w.end);
}

/**
 * Place one occurrence, trying ever-wider windows:
 *   1. `preferred` — what the user asked for;
 *   2. `bound ∩ workingWindows` — the user is awake and available there;
 *   3. `bound` — the whole eligible day, which starts at midnight. Last resort.
 *
 * Tier 2 is what keeps a habit whose preference is booked out from landing at
 * 00:00; it is skipped when the caller supplies no working windows (direct
 * engine callers) or when they do not overlap `bound` at all.
 *
 * The block buffer does NOT apply inside a preferred window: that window is exact
 * user intent, so tier 1 places with `gapMs = 0` and the caller reserves the result
 * via `windowReservation`. Two habits whose windows abut (10:00–11:00 and
 * 11:00–11:15) then both get what they asked for whichever is placed first — with
 * the buffer, the first placement's padding ate into the second's exactly-sized
 * window and pushed it out to a tier-2 fallback. Tiers 2/3 are ordinary fallback
 * placements and keep the full two-sided reservation, applied by `placeItem`.
 *
 * R25: tier 1 gives up the buffer only when it MUST. It is tried twice — the flush
 * placement above, plus a gap-respecting attempt on a timeline that excludes the
 * margins suspended so far (`pendingMargins`: the space an ordinary ± gap reservation
 * would have covered), which wins when it finds room. A window merely STARTING where
 * another block ends (CleanUp 11:00–12:00 after Morning 10:00–11:00) is wide enough to
 * afford the gap, so the chunk starts at 11:10; an exactly-sized window (Evening
 * Routine's 23:29–23:59) has no room to give and keeps the flush placement.
 */
function placeOccurrence(
  free: Interval[],
  chunkMs: number,
  deadline: number,
  bound: Interval[],
  preferred: Interval[] | undefined,
  workingWindows: Interval[] | undefined,
  gapMs: number,
  pendingMargins: Interval[],
  /** The habit's remaining allowed entries — day identity for the R25 gap attempt. */
  days: Interval[] | undefined,
): { result: ReturnType<typeof placeItem>; viaPreferred: boolean } {
  const tiers: { windows: Interval[]; gapMs: number }[] = [];
  const hasPreferred = !!preferred && preferred.length > 0;
  if (hasPreferred) tiers.push({ windows: preferred!, gapMs: 0 });
  if (workingWindows && workingWindows.length > 0) {
    const inHours = intersectIntervals(bound, workingWindows);
    if (inHours.length > 0) tiers.push({ windows: inHours, gapMs });
  }
  tiers.push({ windows: bound, gapMs });

  let placedTier = 0;
  let result = placeItem(free, [chunkMs], deadline, tiers[0]!.windows, tiers[0]!.gapMs);
  if (hasPreferred && result.placements.length > 0) {
    result = preferGap(free, chunkMs, deadline, tiers[0]!.windows, pendingMargins, days, result);
  }
  for (let t = 1; t < tiers.length && result.placements.length === 0; t++) {
    result = placeItem(free, [chunkMs], deadline, tiers[t]!.windows, tiers[t]!.gapMs);
    placedTier = t;
  }
  // Tier 0 is the preferred window, and only exists when the habit stated one.
  const viaPreferred = hasPreferred && placedTier === 0 && result.placements.length > 0;
  return { result, viaPreferred };
}

/**
 * Improve a tier-1 placement to one that leaves the pending margins intact (R25),
 * keeping `flush` when there is no room for that.
 *
 * The gap-respecting attempt only CHOOSES a spot: it runs on a timeline shrunk by the
 * pending margins, which must not leak into any bookkeeping (those margins are merely
 * suspended — `schedule()` reconciles them later, and a habit may still legitimately
 * flush into one). So the chosen span is re-placed on the REAL free timeline,
 * restricted to exactly that span, and the caller sees a result identical in shape to
 * the plain single-attempt one.
 *
 * The improvement must stay on `flush`'s day (`days` = the habit's remaining allowed
 * entries, one per eligible day): moving an occurrence to ANOTHER day to win a
 * 10-minute gap would be a far bigger surprise than the flush contact it avoids, and
 * would hand the vacated day back to the one-per-day budget. Uncapped habits have no
 * day identity at all, so the check does not apply to them.
 */
function preferGap(
  free: Interval[],
  chunkMs: number,
  deadline: number,
  windows: Interval[],
  pendingMargins: Interval[],
  days: Interval[] | undefined,
  flush: ReturnType<typeof placeItem>,
): ReturnType<typeof placeItem> {
  if (pendingMargins.length === 0) return flush;
  const chosen = placeItem(
    subtractIntervals(free, pendingMargins), [chunkMs], deadline, windows, 0,
  ).placements[0];
  if (!chosen) return flush;
  if (days && dayIndex(days, chosen.start) !== dayIndex(days, flush.placements[0]!.start)) {
    return flush;
  }
  // Exact-size candidate window ⇒ `placeItem` reproduces `chosen` verbatim,
  // including its R24 alignment, on the unshrunken timeline.
  return placeItem(free, [chunkMs], deadline, [chosen], 0);
}

/** Index of the allowed (day) entry holding `time`; -1 if none. */
function dayIndex(days: Interval[], time: number): number {
  return days.findIndex((w) => time >= w.start && time < w.end);
}

/**
 * What a placement INSIDE a preferred window takes out of the free timeline: the
 * block itself, plus its ± `gapMs` margins except where those fall inside some
 * habit's preferred window.
 *
 * The block buffer exists to keep ordinary work off a block's edges, and that still
 * holds here — a later task or fallback placement finds the margin reserved. What it
 * must NOT do is encroach on a neighbouring exactly-sized preferred window, which is
 * the R22 bug: `preferredUnion` (every habit's preferred windows, supplied by
 * `schedule`) is precisely the space where the buffer is suspended.
 *
 * Without a union — direct engine callers, which have no view of the other habits —
 * the reservation stays exactly `[start, end]`.
 *
 * The `suspended` remainder (`padded − reservation`) is the margin given up to the
 * union. Declared ≠ claimed, so `schedule()` collects it and hands back whatever no
 * habit actually occupies (R23) — see the reconciliation step there.
 */
function windowReservation(
  span: Interval,
  gapMs: number,
  preferredUnion: Interval[] | undefined,
): { reservation: Interval[]; suspended: Interval[] } {
  if (gapMs <= 0 || !preferredUnion || preferredUnion.length === 0) {
    return { reservation: [span], suspended: [] };
  }
  const padded = [{ start: span.start - gapMs, end: span.end + gapMs }];
  const reservation = mergeIntervals([span, ...subtractIntervals(padded, preferredUnion)]);
  return { reservation, suspended: subtractIntervals(padded, reservation) };
}

export function scheduleHabit(
  free: Interval[],
  habit: Habit,
  gapMs = 0,
  workingWindows?: Interval[],
  /** Every habit's preferred windows — the space in which the buffer is suspended. */
  preferredUnion?: Interval[],
  /**
   * Margins suspended by the habits processed BEFORE this one (R25). Tier-1
   * placement prefers a spot that leaves them intact — see `placeGapPreferring`.
   * Copied on entry, so the caller's array is never touched.
   */
  pendingMargins?: Interval[],
): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
  const suspendedMargins: Interval[] = [];
  // Merging both copies and normalizes: no aliasing of the caller's array, and the
  // habit's own margins join the list as it generates them (an earlier occurrence's
  // margin is respected by the next one).
  const inheritedMargins = pendingMargins ? mergeIntervals(pendingMargins) : [];
  let missed = 0;
  let index = 0;

  // Shared across the preferred-first attempt, the bound fallback and all
  // periods (allowed entries are period-disjoint anyway).
  const budget: HabitWindowBudget = {
    allowed: habit.allowedWindows,
    preferred: habit.preferredWindows,
  };

  // Hoisted out of the sticky loop: merged so a slot straddling two TOUCHING
  // preferred windows still counts as "fully inside one". `undefined` = the
  // habit states no preference, so stickiness is unconstrained by one.
  const preferredBounds =
    habit.preferredWindows && habit.preferredWindows.length > 0
      ? mergeIntervals(habit.preferredWindows)
      : undefined;

  // Occurrences settled outside the engine (user-pinned, or already begun) are not
  // emitted here, but their days are off-limits so an auto occurrence cannot double
  // up on them.
  for (const time of habit.consumedSlotTimes ?? []) {
    consumeWindowContaining(budget, time);
  }

  for (let i = 0; i < habit.periods.length; i++) {
    const period = habit.periods[i]!;
    const target = habit.periodTargets?.[i] ?? habit.perPeriod;
    const periodWindow: Interval[] = [period];
    let placed = 0;

    // Sticky slots first: keep prior placements that are still valid, so a
    // replan does not move habits the user has already seen.
    for (const slot of habit.existingSlots ?? []) {
      if (placed >= target) break;
      // A length mismatch means the user changed the habit's duration since the
      // slot was placed — re-place it at the new chunkMs instead of keeping it.
      if (slot.end - slot.start !== habit.chunkMs) continue;
      if (slot.start < period.start || slot.end > period.end) continue;
      if (!dayAvailable(budget, slot.start)) continue;
      // Preference beats stickiness: a slot outside it is re-placed below.
      if (!insidePreferred(preferredBounds, slot)) continue;

      const bound = budget.allowed
        ? intersectIntervals(budget.allowed, periodWindow)
        : periodWindow;
      const room = intersectIntervals(remainingFree, bound);
      const fits = room.some((iv) => iv.start <= slot.start && iv.end >= slot.end);
      if (!fits) continue;

      // A kept slot of a preferring habit is a tier-1 placement that already
      // happened: it passed `insidePreferred` above, so it lies inside a preferred
      // window and reserves like one. Habits with no preference keep the ordinary
      // two-sided reservation.
      if (preferredBounds) {
        const kept = windowReservation(slot, gapMs, preferredUnion);
        remainingFree = subtractIntervals(remainingFree, kept.reservation);
        suspendedMargins.push(...kept.suspended);
      } else {
        remainingFree = subtractIntervals(remainingFree, [
          { start: slot.start - gapMs, end: slot.end + gapMs },
        ]);
      }
      const day = consumeWindowContaining(budget, slot.start);
      blocks.push({
        id: occurrenceId(habit.id, day, index),
        sourceType: 'habit',
        sourceId: habit.id,
        title: habit.title,
        start: slot.start,
        end: slot.end,
      });
      index++;
      placed++;
    }

    for (let k = placed; k < target; k++) {
      // Recomputed per occurrence: consumed days shrink the budget as we go.
      const bound = budget.allowed
        ? intersectIntervals(budget.allowed, periodWindow)
        : periodWindow;
      const preferred = budget.preferred
        ? intersectIntervals(budget.preferred, bound)
        : undefined;

      const { result: res, viaPreferred } = placeOccurrence(
        remainingFree, habit.chunkMs, period.end, bound, preferred, workingWindows, gapMs,
        [...inheritedMargins, ...suspendedMargins], budget.allowed,
      );

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      const p = res.placements[0]!;
      // Tiers 2/3 already reserved `[start − gap, end + gap]` inside `placeItem`;
      // a tier-1 placement left `res.free` abutting the block, so the margins that
      // fall outside every preferred window are taken here.
      if (viaPreferred) {
        const placedRes = windowReservation(p, gapMs, preferredUnion);
        remainingFree = subtractIntervals(res.free, placedRes.reservation);
        suspendedMargins.push(...placedRes.suspended);
      } else {
        remainingFree = res.free;
      }
      const day = consumeWindowContaining(budget, p.start);
      blocks.push({
        id: occurrenceId(habit.id, day, index),
        sourceType: 'habit',
        sourceId: habit.id,
        title: habit.title,
        start: p.start,
        end: p.end,
      });
      index++;
    }
  }

  const unscheduled: UnscheduledItem[] =
    missed > 0
      ? [
          {
            sourceType: 'habit',
            sourceId: habit.id,
            title: habit.title,
            reason: 'could not place all habit occurrences in free time',
            remainingMs: missed * habit.chunkMs,
          },
        ]
      : [];

  return { blocks, free: remainingFree, unscheduled, suspendedMargins };
}
