import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduleInput,
  ScheduleResult,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { intersectIntervals, mergeIntervals, subtractIntervals } from './intervals.js';
import { scheduleHabit, scheduleTask } from './items.js';

type WorkItem =
  | { kind: 'task'; priority: number; order: number; tie: number; id: string; task: FlexibleTask }
  | { kind: 'habit'; priority: number; order: number; tie: number; id: string; habit: Habit };

function earliestPeriodStart(periods: Interval[]): number {
  let min = Infinity;
  for (const p of periods) if (p.start < min) min = p.start;
  return min;
}

/**
 * Clip a task's candidate windows to the working windows.
 *
 * Only used when a `horizon` widened the free timeline past working hours: a
 * task's own `allowedWindows` (e.g. a category's evening hours) must never let
 * it escape them, and a task without any inherits them outright. `bound`
 * undefined = no horizon, so the free timeline still confines tasks by itself.
 */
function confineTask(task: FlexibleTask, bound: Interval[] | undefined): FlexibleTask {
  if (!bound) return task;
  return { ...task, allowedWindows: intersectIntervals(task.allowedWindows ?? bound, bound) };
}

/** Pure auto-scheduling entry point. */
export function schedule(input: ScheduleInput): ScheduleResult {
  const gapMs = input.blockBufferMs ?? 0;
  // Pinned blocks are task/habit work, so they get the same breathing room as
  // auto-placed ones: reserve the buffer on BOTH sides in the busy set. Fixed
  // events stay RAW here — meeting padding is `meetingBufferMs`' job upstream.
  const busy = mergeIntervals([
    ...input.fixedEvents.map((e) => ({ start: e.start, end: e.end })),
    ...input.pinnedBlocks.map((b) => ({ start: b.start - gapMs, end: b.end + gapMs })),
  ]);
  // With a `horizon`, the shared free timeline spans the WHOLE planning window:
  // habits carry their own full-day allowedWindows and may roam outside working
  // hours (a late-evening routine can finally be placed at 23:30). Tasks are then
  // re-confined below — the free envelope no longer does it for them.
  let free = subtractIntervals(input.horizon ? [input.horizon] : input.workingWindows, busy);
  // Only meaningful with a horizon; without one, free ⊆ workingWindows already.
  const taskBound = input.horizon ? mergeIntervals(input.workingWindows) : undefined;

  const work: WorkItem[] = [
    ...input.tasks.map(
      (t): WorkItem => ({ kind: 'task', priority: t.priority, order: t.sortOrder ?? 0, tie: t.dueBy, id: t.id, task: t }),
    ),
    ...input.habits.map(
      (h): WorkItem => ({
        kind: 'habit',
        priority: h.priority,
        order: 0,
        tie: earliestPeriodStart(h.periods),
        id: h.id,
        habit: h,
      }),
    ),
  ];
  work.sort(
    (a, b) => a.priority - b.priority || a.order - b.order || a.tie - b.tie || a.id.localeCompare(b.id),
  );

  const blocks: ScheduledBlock[] = [...input.pinnedBlocks];
  const unscheduled: UnscheduledItem[] = [];

  for (const item of work) {
    const res =
      item.kind === 'task'
        ? scheduleTask(free, confineTask(item.task, taskBound), gapMs)
        : scheduleHabit(free, item.habit, gapMs);
    blocks.push(...res.blocks);
    unscheduled.push(...res.unscheduled);
    free = res.free;
  }

  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return { blocks, unscheduled };
}
