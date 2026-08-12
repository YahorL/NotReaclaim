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
  | { kind: 'task'; priority: number; order: number; claim: number; tie: number; id: string; task: FlexibleTask }
  | { kind: 'habit'; priority: number; order: number; claim: number; tie: number; id: string; habit: Habit };

/**
 * "Claim rank": how strong an item's demand on a specific slot is. Compared at EQUAL
 * priority and `order`, ahead of `tie`.
 *
 * A habit that states a preferred window wants THAT window and nothing else, so it must
 * claim it before a preference-less habit — which is happy anywhere — can squat it
 * (a 15-minute chore falling to the start of working hours used to evict an exact
 * 10:00-11:00 routine purely by winning the id tiebreak).
 *
 * Tasks all share the LAST rank, which preserves both existing orderings:
 *   - task vs task is untouched (same rank for every task, so priority → sortOrder →
 *     dueBy → id still decides);
 *   - habit vs same-priority task keeps the order it already had — a habit's `tie` is
 *     its period start (`now`) and a task's is its due date, so habits already went
 *     first for every task that can still be placed (a task due before `now` misses
 *     its deadline regardless of where it sits in this list).
 */
const CLAIM_HABIT_PREFERRED = 0;
const CLAIM_HABIT_ANYTIME = 1;
const CLAIM_TASK = 2;

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
  const workingWindows = mergeIntervals(input.workingWindows);
  // Only meaningful with a horizon; without one, free ⊆ workingWindows already.
  const taskBound = input.horizon ? workingWindows : undefined;

  const work: WorkItem[] = [
    ...input.tasks.map(
      (t): WorkItem => ({
        kind: 'task',
        priority: t.priority,
        order: t.sortOrder ?? 0,
        claim: CLAIM_TASK,
        tie: t.dueBy,
        id: t.id,
        task: t,
      }),
    ),
    ...input.habits.map(
      (h): WorkItem => ({
        kind: 'habit',
        priority: h.priority,
        order: 0,
        claim:
          h.preferredWindows && h.preferredWindows.length > 0
            ? CLAIM_HABIT_PREFERRED
            : CLAIM_HABIT_ANYTIME,
        tie: earliestPeriodStart(h.periods),
        id: h.id,
        habit: h,
      }),
    ),
  ];
  work.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.order - b.order ||
      a.claim - b.claim ||
      a.tie - b.tie ||
      a.id.localeCompare(b.id),
  );

  const blocks: ScheduledBlock[] = [...input.pinnedBlocks];
  const unscheduled: UnscheduledItem[] = [];

  for (const item of work) {
    const res =
      item.kind === 'task'
        ? scheduleTask(free, confineTask(item.task, taskBound), gapMs)
        // Habits may leave the working windows, but only as a fallback: they are
        // offered as the middle tier so a habit whose preference is booked out
        // lands in the user's day rather than at midnight.
        : scheduleHabit(free, item.habit, gapMs, workingWindows);
    blocks.push(...res.blocks);
    unscheduled.push(...res.unscheduled);
    free = res.free;
  }

  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return { blocks, unscheduled };
}
