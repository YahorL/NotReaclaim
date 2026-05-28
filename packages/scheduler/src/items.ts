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
