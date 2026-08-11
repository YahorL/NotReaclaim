import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { intersectIntervals, subtractIntervals } from './intervals.js';
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
 */
function consumeWindowContaining(budget: HabitWindowBudget, time: number): void {
  if (!budget.allowed) return;
  const day = budget.allowed.find((w) => time >= w.start && time < w.end);
  if (!day) return;
  budget.allowed = budget.allowed.filter((w) => w !== day);
  if (budget.preferred) {
    budget.preferred = subtractIntervals(budget.preferred, [day]);
  }
}

export function scheduleHabit(free: Interval[], habit: Habit, gapMs = 0): ScheduleItemResult {
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

  for (let i = 0; i < habit.periods.length; i++) {
    const period = habit.periods[i]!;
    const target = habit.periodTargets?.[i] ?? habit.perPeriod;
    const periodWindow: Interval[] = [period];

    for (let k = 0; k < target; k++) {
      // Recomputed per occurrence: consumed days shrink the budget as we go.
      const bound = budget.allowed
        ? intersectIntervals(budget.allowed, periodWindow)
        : periodWindow;
      const preferred = budget.preferred
        ? intersectIntervals(budget.preferred, bound)
        : undefined;

      const primaryWindow = preferred && preferred.length > 0 ? preferred : bound;
      let res = placeItem(remainingFree, [habit.chunkMs], period.end, primaryWindow, gapMs);
      if (res.placements.length === 0 && primaryWindow !== bound) {
        res = placeItem(remainingFree, [habit.chunkMs], period.end, bound, gapMs);
      }

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      remainingFree = res.free;
      const p = res.placements[0]!;
      consumeWindowContaining(budget, p.start);
      blocks.push({
        id: `habit:${habit.id}:${index}`,
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
