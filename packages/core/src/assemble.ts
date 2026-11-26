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
  Settings,
  SettingsRepository,
  CalendarEventRepository,
  HabitRepository,
  ScheduledBlockRepository,
  CategoryRepository,
  Task,
  TaskStatus,
} from '@notreclaim/db';
import { toFixedEvent, toFlexibleTask, toScheduledBlock } from '@notreclaim/db/mappers';
import { expandWorkingWindows, horizonEndMs, isValidTimezone, type WorkingHourEntry } from './time-windows.js';
import { expandHabit } from './habit-expansion.js';
import { SettingsRequiredError } from './errors.js';
import { computeSpentMs, isFrozenTaskRow } from './spent.js';

/** The repository surface the scheduling layer reads from (DI seam). */
export interface SchedulingRepositories {
  settings: Pick<SettingsRepository, 'getByUserId'>;
  calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>;
  // Not Pick<TaskRepository, 'listByUser'>: the real method returns TaskWithSubtasks[], and
  // scheduling needs only the Task columns — so fakes can supply plain Task rows.
  tasks: { listByUser(userId: string): Promise<Task[]> };
  habits: Pick<HabitRepository, 'listByUser'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
  categories: Pick<CategoryRepository, 'listByUser'>;
}

const SCHEDULABLE_TASK_STATUSES: TaskStatus[] = ['pending', 'scheduled'];

/**
 * The engine input plus the ids of tasks that have NO due date. The engine is
 * deliberately unaware of undated tasks (they reach it with `dueBy` = horizon end);
 * core carries the distinction so `computeDesiredSchedule` can keep them out of the
 * unscheduled warning. `schedule()` ignores the extra field.
 */
export type AssembledScheduleInput = ScheduleInput & {
  undatedTaskIds: string[];
  /**
   * The stored `settings.timezone` when it is not a valid IANA zone (only possible for rows
   * saved before PUT /settings validated it), in which case everything was planned in UTC;
   * null when the stored zone was used. Core does not log: a caller with a logger can.
   */
  timezoneFallbackFrom: string | null;
};

/** The piece index of a `task:<taskId>:<index>` engine key of that task; null for any other key. */
function taskChunkIndex(engineKey: string | null, taskId: string): number | null {
  const prefix = `task:${taskId}:`;
  if (!engineKey?.startsWith(prefix)) return null;
  const rest = engineKey.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

/**
 * Assemble a complete engine ScheduleInput from persisted user data. A replan passes the
 * `settings` it read inside its locked section, so assemble and apply see the same tracking
 * mode; without them they are read here.
 */
export async function assembleScheduleInput(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
  settingsRead?: Settings,
): Promise<AssembledScheduleInput> {
  const settings = settingsRead ?? await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);

  // An invalid stored zone would make every schedule read throw; plan in UTC until the user
  // picks a valid zone (settings writes are validated, so this only affects legacy rows).
  const zoneValid = isValidTimezone(settings.timezone);
  const timezone = zoneValid ? settings.timezone : 'UTC';

  const horizonDays = settings.horizonDays;
  const horizonStart = new Date(now);
  const horizonEnd = new Date(horizonEndMs(now, horizonDays));

  const workingWindows = expandWorkingWindows(
    settings.workingHours as unknown as WorkingHourEntry[],
    timezone,
    now,
    horizonDays,
  );

  const categories = await repos.categories.listByUser(userId);
  const expandedByCategoryId = new Map<string, Interval[]>();
  for (const c of categories) {
    const expanded =
      c.windows === null
        ? workingWindows
        : expandWorkingWindows(c.windows as unknown as WorkingHourEntry[], timezone, now, horizonDays);
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
  // A frozen task piece (automatic tracking, start passed: isFrozenTaskRow) that is still
  // running goes to the engine exactly like a pinned block: busy with the task buffer on both
  // sides, its full length counted toward the task below (so that time is not planned again),
  // and echoed in the result (apply skips the echo by row id, as for pinned rows).
  const pinnedBlocks: EngineScheduledBlock[] = blocks
    .filter((b) => (b.pinned || isFrozenTaskRow(b, now, settings.requireStartToTrack)) && b.endsAt.getTime() > now)
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

  // Automatic tracking: a task piece that has just ended keeps its trailing task buffer busy
  // until `end + buffer`. While it ran it was busy with ±buffer (pinned or frozen), and the
  // pieces behind it were placed after that buffer; without this, a replan in the buffer window
  // would see the time as free and re-plan the next piece from `now`, so back-to-back pieces
  // crept forward by up to the buffer after every hand-over (and pushed each move to Google).
  // Stopped, completed or dragged (pinned) pieces too: the same hand-over, the same creep.
  // Manual tracking is left exactly as it was (there un-started pieces slide anyway).
  const tailMs = settings.taskBufferMs ?? 0;
  if (!settings.requireStartToTrack && tailMs > 0) {
    for (const b of blocks) {
      if (b.taskId == null || !(b.pinned || isFrozenTaskRow(b, now, settings.requireStartToTrack))) continue;
      const end = b.endsAt.getTime();
      if (end <= now && now < end + tailMs) fixedEvents.push({ id: `task-tail:${b.id}`, start: end, end: end + tailMs });
    }
  }

  // A task the user has Started becomes user-managed: stop auto-scheduling it (no surprise
  // "remainder" tiles when Start shrinks its block). Its pinned/started blocks stay; apply
  // clears its stale auto blocks since it drops out of the desired schedule.
  const startedTaskIds = new Set(
    blocks.filter((b) => b.startedAt != null && b.taskId != null).map((b) => b.taskId as string),
  );

  // Pinned-block coverage (running frozen pieces included) reduces the work the engine must
  // (re)place. A frozen piece's full length counts while it runs and its finished length counts
  // as spent once it ends (`end > now` vs `end <= now`), so it is never counted twice.
  const taskCoverageMs = new Map<string, number>();
  for (const b of pinnedBlocks) {
    if (b.sourceType === 'task') {
      taskCoverageMs.set(b.sourceId, (taskCoverageMs.get(b.sourceId) ?? 0) + (b.end - b.start));
    }
  }

  // Stable keys: number a task's remaining pieces after the highest `task:<id>:<i>` key that a
  // frozen piece of it still holds. Without this the engine numbers the remainder from 0 again,
  // so as soon as a piece begins, the frozen piece gives its key up, the remainder is created
  // as a NEW row under it and the next piece's old row is swept: one Google insert and one
  // delete per piece. With it the next piece keeps matching its own row.
  const firstChunkIndex = new Map<string, number>();
  for (const b of blocks) {
    if (!isFrozenTaskRow(b, now, settings.requireStartToTrack)) continue;
    const index = taskChunkIndex(b.engineKey, b.taskId!);
    if (index != null) firstChunkIndex.set(b.taskId!, Math.max(firstChunkIndex.get(b.taskId!) ?? 0, index + 1));
  }

  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = [];
  const undatedTaskIds: string[] = [];
  for (const t of allTasks) {
    if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
    if (startedTaskIds.has(t.id)) continue; // started → user-managed
    const flexible = toFlexibleTask(t, horizonEnd.getTime());
    const spent = computeSpentMs(t.id, blocks, settings.requireStartToTrack, now);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0) - spent;
    if (remaining <= 0) continue;
    // Listed only once the task is known to reach the engine: one fully covered by pinned
    // blocks never gets there, so it has nothing to be filtered out of downstream.
    if (t.dueBy == null) undatedTaskIds.push(t.id);
    const resolvedId =
      t.categoryId && expandedByCategoryId.has(t.categoryId) ? t.categoryId : defaultCategoryId;
    let allowedWindows = resolvedId ? expandedByCategoryId.get(resolvedId)! : workingWindows;
    // Clip windows to [notBefore, horizonEnd]: the engine has no notBefore field;
    // window confinement in assemble is the sole enforcement of "schedule after".
    if (t.notBefore) {
      allowedWindows = intersectIntervals(allowedWindows, [{ start: t.notBefore.getTime(), end: horizonEnd.getTime() }]);
    }
    const first = firstChunkIndex.get(t.id);
    tasks.push({ ...flexible, durationMs: remaining, allowedWindows, ...(first ? { firstChunkIndex: first } : {}) });
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
    const engineHabit = expandHabit(h, timezone, now, horizonDays, existingSlots);

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
    // Proration must only silence what CLIPPING removed. A `perPeriod` larger than the
    // habit's own weekly eligible-day count is a misconfiguration the user CAN fix (add
    // eligible days, or ask for fewer), so that shortfall is added back to the capacity
    // and keeps warning — including the `eligibleDays: []` case, where capacity is 0 and
    // the shortfall alone carries the full target.
    const dayWindows = engineHabit.allowedWindows;
    const ineligibilityShortfall = Math.max(0, h.perPeriod - new Set(h.eligibleDays).size);
    engineHabit.periodTargets = engineHabit.periods.map((p, i) => {
      const capacity = dayWindows.filter(
        (w) =>
          w.start < p.end &&
          w.end > p.start &&
          !consumed.some((t) => t >= w.start && t < w.end),
      ).length;
      return Math.max(0, Math.min(h.perPeriod - occurrences[i]!, capacity + ineligibilityShortfall));
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
    undatedTaskIds,
    timezoneFallbackFrom: zoneValid ? null : settings.timezone,
  };
}
