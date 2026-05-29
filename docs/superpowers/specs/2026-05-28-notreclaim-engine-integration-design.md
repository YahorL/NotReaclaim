# NotReclaim Engine Integration — Design Spec (Milestone 3a)

**Date:** 2026-05-28
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestone 1 (`@notreclaim/scheduler`) and Milestone 2 (`@notreclaim/db`), both merged.

## Summary

Milestone 3a is the pure engine-integration layer: it turns persisted user data
(settings, calendar events, tasks, habits, pinned blocks) into a complete engine
`ScheduleInput`, runs the scheduler, and returns the desired schedule. It also
makes one small, backward-compatible extension to the milestone-1 engine so a
habit's eligible days are a **hard** constraint.

Everything here is deterministic and testable with **no database and no Google**:
the database is reached only through injected repository interfaces (real in
production, in-memory fakes in tests), and every entry point takes an explicit
`now` (epoch ms) instead of reading the clock. Timezone math uses **luxon**.

Milestone 3b (separate spec) adds OAuth, the Google Calendar client, inbound and
outbound sync, the conflict/pin write path, and the persist-and-diff half of the
re-plan loop.

## Goals

- Extend the engine `Habit` with a hard `allowedWindows` restriction.
- Timezone-aware `workingHours → workingWindows` expansion (DST-correct).
- `Habit` (DB recurrence rule) → engine `Habit` expansion over a horizon
  (`periods`, hard `allowedWindows`, soft `preferredWindows`).
- `ScheduleInput` assembly from injected repositories.
- `computeDesiredSchedule` — assemble + run the engine → desired blocks +
  unscheduled.
- A pure bridge mapper from engine blocks back to DB-writable inputs.

## Non-Goals (3a)

OAuth, the Google Calendar API client, inbound/outbound sync, the conflict/pin
write path, watch/poll, and the diff/persist half of the re-plan loop — all 3b.

## Package

New pure package **`packages/core`** (`@notreclaim/core`), depending on
`@notreclaim/scheduler` and `@notreclaim/db`, using **luxon** for timezone math.
Also reopens **`packages/scheduler`** for the additive `allowedWindows` change.

```
packages/core/
  package.json                # @notreclaim/core (deps: @notreclaim/scheduler, @notreclaim/db, luxon)
  tsconfig.json
  vitest.config.ts
  src/
    errors.ts                 # SettingsRequiredError, InvalidTimezoneError, InvalidHorizonError
    time-windows.ts           # expandWorkingWindows
    habit-expansion.ts        # expandHabit
    assemble.ts               # SchedulingRepositories, assembleScheduleInput
    compute.ts                # computeDesiredSchedule
    bridge.ts                 # toScheduledBlockInput
    index.ts
  test/
    time-windows.test.ts
    habit-expansion.test.ts
    assemble.test.ts          # uses in-memory fake repositories
    compute.test.ts           # uses in-memory fake repositories
    bridge.test.ts
    fakes.ts                  # in-memory repository fakes implementing the db interfaces
```

Determinism: every public entry point takes `now: number` (epoch ms). No
`Date.now`, no `Math.random`, no I/O beyond the injected repositories.

## Engine extension (in `@notreclaim/scheduler`)

Add one optional field to the engine `Habit`:

```ts
/** HARD restriction: placement is confined to these windows (intersected with
 *  each period). Unlike preferredWindows, the engine never places outside
 *  allowedWindows — an occurrence that cannot fit there is left unscheduled.
 *  Omit for unrestricted placement (previous behavior). */
allowedWindows?: Interval[];
```

`scheduleHabit` placement, per occurrence, becomes:

- `bound = allowedWindows ? intersect(allowedWindows, period) : period`
- `primary = preferredWindows ? intersect(preferredWindows, bound) : bound`
- try `primary`; if nothing fits and `primary` differs from `bound`, fall back to
  `bound`; **never place beyond `bound`**. Deadline remains `period.end`.

When `allowedWindows` is omitted this is identical to the current behavior, so all
existing engine tests stay green. New tests cover the hard restriction.

## Timezone-aware working windows (pure)

`expandWorkingWindows(workingHours, timezone, now, horizonDays) → Interval[]`:

- `workingHours`: `[{ weekday: 0–6, startMinute, endMinute }]` (Sunday = 0).
- For each calendar day in `[now, now + horizonDays]` evaluated in `timezone`,
  for each `workingHours` entry whose `weekday` matches, emit
  `[dayStart + startMinute, dayStart + endMinute]` as an epoch-ms `Interval`,
  computed with luxon so DST transitions are handled correctly.
- Intervals are clipped to the horizon `[now, now + horizonDays]`.
- `workingHours` is the schedulable window for **both** tasks and habits.

## Habit expansion (pure)

`expandHabit(dbHabit, timezone, now, horizonDays) → engine Habit`:

- **`periods`**: ISO calendar weeks (Monday start) in `timezone`, clipped to the
  horizon. "Per period" means per ISO week.
- **`allowedWindows`** (hard): for each horizon day whose weekday ∈
  `eligibleDays`, the full-day interval in `timezone`. Because the engine only
  places within free time (⊆ `workingWindows`), this confines occurrences to
  eligible days and working hours.
- **`preferredWindows`** (soft): if `preferredStartMinute`/`preferredEndMinute`
  are set, the time-of-day window on each eligible day; otherwise omitted.
- `id`, `title`, `priority`, `chunkMs`, `perPeriod` copied through.

`eligibleDays` weekday convention matches `workingHours`: Sunday = 0.

## ScheduleInput assembly (injected repositories)

```ts
interface SchedulingRepositories {
  settings: SettingsRepository;
  calendarEvents: CalendarEventRepository;
  tasks: TaskRepository;
  habits: HabitRepository;
  scheduledBlocks: ScheduledBlockRepository;
}
```

`assembleScheduleInput(repos, userId, now) → ScheduleInput`:

1. Load `Settings`; missing → `SettingsRequiredError`.
2. `horizon = [now, now + horizonDays days]`.
3. `workingWindows = expandWorkingWindows(...)`.
4. `fixedEvents = calendarEvents.listByUserInRange(userId, horizon).map(toFixedEvent)`.
5. `pinnedBlocks = scheduledBlocks.listByUserInRange(userId, horizon)` filtered to
   `pinned === true`, mapped with `toScheduledBlock`.
6. `tasks = tasks.listByUser(userId)` filtered to statuses `pending` and
   `scheduled`, mapped with `toFlexibleTask`.
7. `habits = habits.listByUser(userId)` filtered to `status === 'active'`, mapped
   with `expandHabit`.
8. Return the assembled `ScheduleInput`.

## computeDesiredSchedule

`computeDesiredSchedule(repos, userId, now) → ScheduleResult` —
`schedule(assembleScheduleInput(repos, userId, now))`. Returns the engine's
desired `blocks` plus `unscheduled`. This is the compute half of the re-plan loop;
the diff-against-DB and Google write-back are 3b.

## Bridge mapper (pure)

`toScheduledBlockInput(engineBlock) → CreateScheduledBlockInput` — inverse of
M2's `toScheduledBlock`: `sourceType` → `taskId`/`habitId`, epoch ms → `Date`
`startsAt`/`endsAt`, `title` carried through. Gives 3b a ready bridge to persist
desired blocks.

## Error handling

- Missing `Settings` → `SettingsRequiredError`.
- Invalid IANA timezone (detected via luxon) → `InvalidTimezoneError`.
- `horizonDays <= 0` → `InvalidHorizonError`.
- A habit with empty `eligibleDays` schedules nothing; all its occurrences are
  reported `unscheduled` (correct behavior, not an error).

## Testing (all DB-free, deterministic, fixed `now`)

- **Engine extension** (`@notreclaim/scheduler`): hard `allowedWindows` drops an
  occurrence that cannot fit on an eligible day; preferred-within-allowed;
  backward-compat with `allowedWindows` omitted (existing tests unchanged).
- **`expandWorkingWindows`**: weekday matching, horizon clipping, and a
  DST-boundary case (a spring-forward week shifts the wall-clock window
  correctly).
- **`expandHabit`**: ISO-Monday `periods`, eligible-day `allowedWindows`,
  preferred window present and absent.
- **`assembleScheduleInput`**: with in-memory fake repositories — status
  filtering (only `active` habits; only `pending`/`scheduled` tasks; only pinned
  blocks become `pinnedBlocks`) and correct mapping.
- **`computeDesiredSchedule`**: end-to-end with fakes — expected placements; an
  over-deadline task surfaces as `unscheduled`.
- **`toScheduledBlockInput`**: task vs habit source; correct `Date` conversion.
