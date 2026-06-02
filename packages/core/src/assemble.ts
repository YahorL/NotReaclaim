import type {
  ScheduleInput,
  FixedEvent,
  FlexibleTask,
  Habit as EngineHabit,
  ScheduledBlock as EngineScheduledBlock,
  Interval,
} from '@notreclaim/scheduler';
import { mergeIntervals, intersectIntervals } from '@notreclaim/scheduler';
import type {
  SettingsRepository,
  CalendarEventRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
  CategoryRepository,
  TaskStatus,
} from '@notreclaim/db';
import { toFixedEvent, toFlexibleTask, toScheduledBlock } from '@notreclaim/db/mappers';
import { expandWorkingWindows, type WorkingHourEntry } from './time-windows.js';
import { expandHabit } from './habit-expansion.js';
import { SettingsRequiredError } from './errors.js';

/** The repository surface the scheduling layer reads from (DI seam). */
export interface SchedulingRepositories {
  settings: Pick<SettingsRepository, 'getByUserId'>;
  calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>;
  tasks: Pick<TaskRepository, 'listByUser'>;
  habits: Pick<HabitRepository, 'listByUser'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
  categories: Pick<CategoryRepository, 'listByUser'>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCHEDULABLE_TASK_STATUSES: TaskStatus[] = ['pending', 'scheduled'];

/** Assemble a complete engine ScheduleInput from persisted user data. */
export async function assembleScheduleInput(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
): Promise<ScheduleInput> {
  const settings = await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);

  const horizonDays = settings.horizonDays;
  const horizonStart = new Date(now);
  const horizonEnd = new Date(now + horizonDays * MS_PER_DAY);

  const workingWindows = expandWorkingWindows(
    settings.workingHours as unknown as WorkingHourEntry[],
    settings.timezone,
    now,
    horizonDays,
  );

  const categories = await repos.categories.listByUser(userId);
  const expandedByCategoryId = new Map<string, Interval[]>();
  for (const c of categories) {
    const expanded =
      c.windows === null
        ? workingWindows
        : expandWorkingWindows(c.windows as unknown as WorkingHourEntry[], settings.timezone, now, horizonDays);
    expandedByCategoryId.set(c.id, expanded);
  }
  const defaultCategoryId = categories.find((c) => c.isDefault)?.id ?? null;

  // Schedulable envelope = union of working hours and every category's windows.
  const envelope = mergeIntervals([
    ...workingWindows,
    ...categories.flatMap((c) => expandedByCategoryId.get(c.id) ?? []),
  ]);

  const events = await repos.calendarEvents.listByUserInRange(userId, horizonStart, horizonEnd);
  const meetingBufferMs = settings.meetingBufferMs ?? 0;
  const fixedEvents: FixedEvent[] = events.map((e) => {
    const fe = toFixedEvent(e);
    return meetingBufferMs > 0 ? { id: fe.id, start: fe.start - meetingBufferMs, end: fe.end + meetingBufferMs } : fe;
  });

  const blocks = await repos.scheduledBlocks.listByUserInRange(userId, horizonStart, horizonEnd);
  const pinnedBlocks: EngineScheduledBlock[] = blocks
    .filter((b) => b.pinned)
    .map(toScheduledBlock);

  // Pinned-block coverage reduces the work the engine must (re)place.
  const taskCoverageMs = new Map<string, number>();
  for (const b of pinnedBlocks) {
    if (b.sourceType === 'task') {
      taskCoverageMs.set(b.sourceId, (taskCoverageMs.get(b.sourceId) ?? 0) + (b.end - b.start));
    }
  }

  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = [];
  for (const t of allTasks) {
    if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
    const flexible = toFlexibleTask(t);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0);
    if (remaining <= 0) continue;
    const resolvedId =
      t.categoryId && expandedByCategoryId.has(t.categoryId) ? t.categoryId : defaultCategoryId;
    let allowedWindows = resolvedId ? expandedByCategoryId.get(resolvedId)! : workingWindows;
    // Clip windows to [notBefore, horizonEnd]: the engine has no notBefore field;
    // window confinement in assemble is the sole enforcement of "schedule after".
    if (t.notBefore) {
      allowedWindows = intersectIntervals(allowedWindows, [{ start: t.notBefore.getTime(), end: horizonEnd.getTime() }]);
    }
    tasks.push({ ...flexible, durationMs: remaining, allowedWindows });
  }

  const allHabits = await repos.habits.listByUser(userId);
  const habits: EngineHabit[] = [];
  for (const h of allHabits) {
    if (h.status !== 'active') continue;
    const engineHabit = expandHabit(h, settings.timezone, now, horizonDays);
    const occurrences = engineHabit.periods.map(
      (p) =>
        pinnedBlocks.filter(
          (b) => b.sourceType === 'habit' && b.sourceId === h.id && b.start >= p.start && b.start < p.end,
        ).length,
    );
    if (occurrences.some((count) => count > 0)) {
      engineHabit.periodTargets = engineHabit.periods.map((_p, i) => Math.max(0, h.perPeriod - occurrences[i]!));
    }
    habits.push(engineHabit);
  }

  return { workingWindows: envelope, fixedEvents, pinnedBlocks, tasks, habits, blockBufferMs: settings.taskBufferMs ?? 0 };
}
