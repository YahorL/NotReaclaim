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

  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = allTasks
    .filter((t) => SCHEDULABLE_TASK_STATUSES.includes(t.status))
    .map(toFlexibleTask);

  const allHabits = await repos.habits.listByUser(userId);
  const habits: EngineHabit[] = allHabits
    .filter((h) => h.status === 'active')
    .map((h) => expandHabit(h, settings.timezone, now, horizonDays));

  return { workingWindows, fixedEvents, pinnedBlocks, tasks, habits };
}
