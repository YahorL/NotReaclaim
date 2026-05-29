import type {
  ScheduleInput,
  FixedEvent,
  FlexibleTask,
  Habit as EngineHabit,
  ScheduledBlock as EngineScheduledBlock,
} from '@notreclaim/scheduler';
import type {
  SettingsRepository,
  CalendarEventRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
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

  const events = await repos.calendarEvents.listByUserInRange(userId, horizonStart, horizonEnd);
  const fixedEvents: FixedEvent[] = events.map(toFixedEvent);

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
    tasks.push({ ...flexible, durationMs: remaining });
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

  return { workingWindows, fixedEvents, pinnedBlocks, tasks, habits };
}
