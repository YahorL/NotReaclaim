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

  return { blocks, free: result.free, unscheduled };
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
 * Every tier is the SAME plain `placeItem` call (R25): the block buffer applies
 * inside a preferred window exactly as it does anywhere else, so the tiers differ
 * only in which candidate windows they offer. What keeps an exactly-sized window
 * usable is ordering, not an exemption — `schedule()` lets the habit with the least
 * room to spare claim its window before anyone else's reservation can encroach.
 *
 * Note that `placeItem`'s FIT never consults `gapMs` (only its reservation does), so
 * a window whose interior is still free is filled exactly — Morning 10:00–11:00 with
 * working hours starting at 10:00 is placed 10:00–11:00 and pads outward only.
 */
function placeOccurrence(
  free: Interval[],
  chunkMs: number,
  deadline: number,
  bound: Interval[],
  preferred: Interval[] | undefined,
  workingWindows: Interval[] | undefined,
  gapMs: number,
): ReturnType<typeof placeItem> {
  const tiers: Interval[][] = [];
  if (preferred && preferred.length > 0) tiers.push(preferred);
  if (workingWindows && workingWindows.length > 0) {
    const inHours = intersectIntervals(bound, workingWindows);
    if (inHours.length > 0) tiers.push(inHours);
  }
  tiers.push(bound);

  let result = placeItem(free, [chunkMs], deadline, tiers[0]!, gapMs);
  for (let t = 1; t < tiers.length && result.placements.length === 0; t++) {
    result = placeItem(free, [chunkMs], deadline, tiers[t]!, gapMs);
  }
  return result;
}

export function scheduleHabit(
  free: Interval[],
  habit: Habit,
  gapMs = 0,
  workingWindows?: Interval[],
): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
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

      // One buffer rule everywhere (R25): a kept slot reserves its ± gap like any
      // other block, whether or not it sits inside a preferred window.
      remainingFree = subtractIntervals(remainingFree, [
        { start: slot.start - gapMs, end: slot.end + gapMs },
      ]);
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

      const res = placeOccurrence(
        remainingFree, habit.chunkMs, period.end, bound, preferred, workingWindows, gapMs,
      );

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      const p = res.placements[0]!;
      // Whichever tier placed it, `placeItem` already took `[start − gap, end + gap]`.
      remainingFree = res.free;
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

  return { blocks, free: remainingFree, unscheduled };
}
