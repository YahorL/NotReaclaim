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
  Task,
  TaskStatus,
} from '@notreclaim/db';
import { toFixedEvent, toFlexibleTask, toScheduledBlock } from '@notreclaim/db/mappers';
import { expandWorkingWindows, type WorkingHourEntry } from './time-windows.js';
import { expandHabit } from './habit-expansion.js';
import { SettingsRequiredError } from './errors.js';
import { computeSpentMs } from './spent.js';

/** The repository surface the scheduling layer reads from (DI seam). */
export interface SchedulingRepositories {
  settings: Pick<SettingsRepository, 'getByUserId'>;
  calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>;
  tasks: { listByUser(userId: string, opts?: { status?: TaskStatus }): Promise<Task[]> };
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
    // The meeting buffer is prep/decompress time around meetings — a `blocked` entry is
    // the user's own relax/personal time and is subtracted raw, exactly as drawn.
    const pad = meetingBufferMs > 0 && e.kind !== 'blocked';
    return pad ? { id: fe.id, start: fe.start - meetingBufferMs, end: fe.end + meetingBufferMs } : fe;
  });

  const blocks = await repos.scheduledBlocks.listByUserInRange(userId, new Date(0), horizonEnd);
  const pinnedBlocks: EngineScheduledBlock[] = blocks
    .filter((b) => b.pinned && b.endsAt.getTime() > now)
    .map(toScheduledBlock);

  // A habit occurrence that is running right now is frozen in place (see the begun-habit
  // handling below), so its remaining minutes are NOT free: without this, every replan
  // during the occurrence could drop a task straight on top of it. Pinned ones are
  // already busy via `pinnedBlocks`; these go in raw, like `blocked` entries — the
  // meeting buffer is prep time around meetings, not padding for our own work blocks.
  // `fixedEvents` are busy-only and never emitted as engine blocks, so nothing about the
  // apply/diff path changes: the row itself survives via the begun-habit sweep guard.
  for (const b of blocks) {
    if (b.habitId == null || b.pinned) continue;
    if (b.startsAt.getTime() <= now && b.endsAt.getTime() > now) {
      fixedEvents.push({ id: `habit-running:${b.id}`, start: b.startsAt.getTime(), end: b.endsAt.getTime() });
    }
  }

  // A task the user has Started becomes user-managed: stop auto-scheduling it (no surprise
  // "remainder" tiles when Start shrinks its block). Its pinned/started blocks stay; apply
  // clears its stale auto blocks since it drops out of the desired schedule.
  const startedTaskIds = new Set(
    blocks.filter((b) => b.startedAt != null && b.taskId != null).map((b) => b.taskId as string),
  );

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
    if (startedTaskIds.has(t.id)) continue; // started → user-managed
    const flexible = toFlexibleTask(t);
    const spent = computeSpentMs(t.id, blocks, settings.requireStartToTrack, now);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0) - spent;
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
    // Feed the habit's current auto placements back in so a replan keeps the ones the
    // user has already seen (sorted: the engine's slot selection is array-order dependent).
    const existingSlots: Interval[] = blocks
      .filter((b) => b.habitId === h.id && !b.pinned && b.startedAt == null && b.startsAt.getTime() >= now)
      .map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() }))
      .sort((a, b) => a.start - b.start);
    const engineHabit = expandHabit(h, settings.timezone, now, horizonDays, existingSlots);

    // An occurrence whose start has passed is history — missed or done, the app has no
    // habit-completion concept — so its day is retired instead of being re-planned at
    // `now` over and over (the block itself stays put; apply's sweep never deletes it).
    // No timezone reasoning is needed here: `expandHabit` only emits allowed windows for
    // days from today onward, so a start from a fully-past day matches no window and the
    // engine's day consumption is a silent no-op. Passing all of them is therefore safe.
    // Pinned rows are included: `pinnedBlocks` (and with it `pinnedForHabit` below) drops
    // anything that ended before `now`, so a pinned occurrence that has finished would
    // otherwise free its day up again and let a second one be booked on top of it.
    // Overlap with `pinnedForHabit` is fine — consuming a day twice is idempotent.
    const begunForHabit = blocks
      .filter((b) => b.habitId === h.id && b.startsAt.getTime() <= now)
      .map((b) => b.startsAt.getTime());

    const pinnedForHabit = pinnedBlocks.filter((b) => b.sourceType === 'habit' && b.sourceId === h.id);
    const occurrences = engineHabit.periods.map(
      (p) => pinnedForHabit.filter((b) => b.start >= p.start && b.start < p.end).length,
    );
    // Pinned and begun occupy their day, so an auto occurrence never doubles up on it.
    const consumed = [...pinnedForHabit.map((b) => b.start), ...begunForHabit];
    if (consumed.length > 0) {
      engineHabit.consumedSlotTimes = consumed.sort((a, b) => a - b);
    }

    // Ask each period only for as many occurrences as it can actually hold. `expandHabit`
    // clips the first and last week to the horizon, so a full `perPeriod` there would count
    // occurrences for days that already elapsed (or lie past the horizon) as missed and warn
    // the user about something they cannot act on. The engine caps a habit at one occurrence
    // per allowed-window day, so this only drops attempts that were bound to fail: the blocks
    // it places are unchanged. Windows are day-granular and emitted only for eligible days
    // from today onward, so counting the ones this period overlaps — minus the days a pinned
    // or begun occurrence already took — is exactly the period's capacity.
    // Only PINNED occurrences are subtracted from `perPeriod`: a missed one may still be
    // re-placed on another eligible day of the same period if the target has room.
    // A habit with no eligible day at all is a misconfiguration the user CAN fix, so it
    // keeps its full target and still reports as unscheduled — proration is only meant to
    // silence days the horizon put out of reach.
    const dayWindows = h.eligibleDays.length > 0 ? (engineHabit.allowedWindows ?? []) : undefined;
    engineHabit.periodTargets = engineHabit.periods.map((p, i) => {
      if (!dayWindows) return Math.max(0, h.perPeriod - occurrences[i]!);
      const capacity = dayWindows.filter(
        (w) =>
          w.start < p.end &&
          w.end > p.start &&
          !consumed.some((t) => t >= w.start && t < w.end),
      ).length;
      return Math.max(0, Math.min(h.perPeriod - occurrences[i]!, capacity));
    });
    habits.push(engineHabit);
  }

  return {
    workingWindows: envelope,
    // Full planning envelope: habits may roam the whole day (they carry eligible-day
    // allowedWindows), while tasks stay clipped to `envelope` inside the engine.
    horizon: { start: now, end: horizonEnd.getTime() },
    fixedEvents,
    pinnedBlocks,
    tasks,
    habits,
    blockBufferMs: settings.taskBufferMs ?? 0,
  };
}
