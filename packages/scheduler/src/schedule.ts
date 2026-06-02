import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduleInput,
  ScheduleResult,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { mergeIntervals, subtractIntervals } from './intervals.js';
import { scheduleHabit, scheduleTask } from './items.js';

type WorkItem =
  | { kind: 'task'; priority: number; tie: number; id: string; task: FlexibleTask }
  | { kind: 'habit'; priority: number; tie: number; id: string; habit: Habit };

function earliestPeriodStart(periods: Interval[]): number {
  let min = Infinity;
  for (const p of periods) if (p.start < min) min = p.start;
  return min;
}

/** Pure auto-scheduling entry point. */
export function schedule(input: ScheduleInput): ScheduleResult {
  const busy = mergeIntervals([
    ...input.fixedEvents.map((e) => ({ start: e.start, end: e.end })),
    ...input.pinnedBlocks.map((b) => ({ start: b.start, end: b.end })),
  ]);
  let free = subtractIntervals(input.workingWindows, busy);

  const work: WorkItem[] = [
    ...input.tasks.map(
      (t): WorkItem => ({ kind: 'task', priority: t.priority, tie: t.dueBy, id: t.id, task: t }),
    ),
    ...input.habits.map(
      (h): WorkItem => ({
        kind: 'habit',
        priority: h.priority,
        tie: earliestPeriodStart(h.periods),
        id: h.id,
        habit: h,
      }),
    ),
  ];
  work.sort(
    (a, b) => a.priority - b.priority || a.tie - b.tie || a.id.localeCompare(b.id),
  );

  const blocks: ScheduledBlock[] = [...input.pinnedBlocks];
  const unscheduled: UnscheduledItem[] = [];

  for (const item of work) {
    const gapMs = input.blockBufferMs ?? 0;
    const res =
      item.kind === 'task'
        ? scheduleTask(free, item.task, gapMs)
        : scheduleHabit(free, item.habit, gapMs);
    blocks.push(...res.blocks);
    unscheduled.push(...res.unscheduled);
    free = res.free;
  }

  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return { blocks, unscheduled };
}
