import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { intersectIntervals } from './intervals.js';
import { placeItem, splitDuration } from './placement.js';

export interface ScheduleItemResult {
  blocks: ScheduledBlock[];
  free: Interval[];
  unscheduled: UnscheduledItem[];
}

/** Split a task into chunks and place them before its due date. */
export function scheduleTask(free: Interval[], task: FlexibleTask): ScheduleItemResult {
  const chunkSizes = splitDuration(task.durationMs, task.minChunkMs, task.maxChunkMs);
  const result = placeItem(free, chunkSizes, task.dueBy);

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

export function scheduleHabit(free: Interval[], habit: Habit): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
  let missed = 0;
  let index = 0;

  for (let i = 0; i < habit.periods.length; i++) {
    const period = habit.periods[i]!;
    const target = habit.periodTargets?.[i] ?? habit.perPeriod;
    const periodWindow: Interval[] = [period];
    const bound = habit.allowedWindows
      ? intersectIntervals(habit.allowedWindows, periodWindow)
      : periodWindow;
    const preferred = habit.preferredWindows
      ? intersectIntervals(habit.preferredWindows, bound)
      : undefined;

    for (let k = 0; k < target; k++) {
      const primaryWindow = preferred && preferred.length > 0 ? preferred : bound;
      let res = placeItem(remainingFree, [habit.chunkMs], period.end, primaryWindow);
      if (res.placements.length === 0 && primaryWindow !== bound) {
        res = placeItem(remainingFree, [habit.chunkMs], period.end, bound);
      }

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      remainingFree = res.free;
      const p = res.placements[0]!;
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
