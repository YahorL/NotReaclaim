# NotReclaim — optional task deadlines (tasks without a due date)

**Date:** 2026-08-22 · **Status:** approved (user: "add an option for tasks so that they don't
have an end deadline")

## Current state

`dueBy` is mandatory at every layer:

- `packages/db` — `Task.dueBy DateTime @db.Timestamptz`, NOT NULL.
- `packages/db/src/mappers.ts` — `toFlexibleTask(row)` reads `row.dueBy.getTime()`.
- `packages/scheduler` — `FlexibleTask.dueBy: number`, used in exactly two places:
  `items.ts` passes it to `placeItem` as the `deadline`, and `schedule.ts` uses it as the
  comparator's `tie` term (`priority → order → claim → slack → tie → id`).
- `packages/server` — `createTaskSchema.dueBy: z.string().datetime()`; `PATCH` applies
  `...(dueByStr ? { dueBy: new Date(dueByStr) } : {})`.
- `packages/web` — `Task.dueBy: string`; both form modules reject an empty value with
  "A valid due date is required"; quick-add stamps `now + 7d` (23:59 in `newTaskForm`).

## Decisions (from brainstorming)

1. **Scheduling:** an undated task is scheduled normally, competing for free time by
   priority. The missing due date removes a constraint; it does not change the task's rank.
   At equal priority + sortOrder it yields to dated tasks, because all undated tasks share
   the same (largest) `tie` value.
2. **Warnings:** an undated task that does not fit in the horizon produces **no** warning —
   not in the amber banner, not as an at-risk ⚠. It is not late; there is no date it missed.
   Dated tasks keep warning exactly as today.
3. **Entry:** the due-date field simply becomes optional — an empty field *is* "no deadline",
   mirroring how `notBefore` already behaves. Quick-add and the planner popover keep their
   +7-day default, so undated is opt-in per task.
4. **Engine representation:** the scheduler package is NOT modified. Core maps a null due
   date to the horizon end (approach A of two considered).

### Why mapping to the horizon end is exact, not a hack

`placeItem` uses the deadline only as `start + size <= deadline`, and the free timeline it
searches is already clipped to the planning horizon (`schedule.ts` builds `free` from
`input.horizon`, and working windows are expanded over `horizonDays`). No placement can
land after the horizon end under any deadline, so "no deadline" and "due at the horizon
edge" are observationally identical to the engine. Ordering also falls out correctly:
undated tasks all receive the same `tie`, sorting after any earlier-dated task at equal
priority and order, which is decision 1.

The rejected alternative (`dueBy?: number` in `FlexibleTask`, optional deadline in
`placeItem`, `Infinity` tie) is more explicit but changes a zero-dependency package's public
type and its tests for no behavioral difference today. Revisit it only if the engine itself
must reason about undated tasks — e.g. a distinct placement tier.

## Change

### 1. `packages/db`

- Schema: `dueBy DateTime? @db.Timestamptz`. Migration drops NOT NULL only; existing rows
  keep their values (`ALTER TABLE "Task" ALTER COLUMN "dueBy" DROP NOT NULL;`).
- `toFlexibleTask(row, fallbackDueBy: number)` → `dueBy: row.dueBy?.getTime() ?? fallbackDueBy`.
  The parameter is required (not defaulted) so every call site states its horizon explicitly.
- Task repository create/update input types follow Prisma's generated types; verify no
  hand-written interface still requires `dueBy`.

### 2. `packages/core`

- `assembleScheduleInput` passes the `horizonEnd` it already computes to `toFlexibleTask`.
- Its return type widens to `AssembledScheduleInput = ScheduleInput & { undatedTaskIds: string[] }`.
  This is a core-owned superset: `schedule()` receives the same object and ignores the extra
  field, and existing callers/tests that treat the result as `ScheduleInput` keep compiling.
  Only tasks that reach the engine are listed (a task fully covered by pinned blocks is
  dropped before this point and cannot appear in `unscheduled` anyway).
- `computeDesiredSchedule` filters the engine's result:

  ```ts
  const result = schedule(input);
  if (input.undatedTaskIds.length === 0) return result;
  const undated = new Set(input.undatedTaskIds);
  return {
    ...result,
    unscheduled: result.unscheduled.filter(
      (u) => !(u.sourceType === 'task' && undated.has(u.sourceId)),
    ),
  };
  ```

  One filter covers both surfaces: the amber banner and `PlannerTaskPanel`'s at-risk ⚠ both
  read `preview.unscheduled`.

### 3. `packages/server`

- `createTaskSchema.dueBy: z.string().datetime().nullable().optional()`; the route stores
  `body.dueBy ? new Date(body.dueBy) : null`.
- `updateTaskSchema.dueBy: z.string().datetime().nullable().optional()`, and the route must
  distinguish absent from null:

  ```ts
  ...(dueByStr !== undefined ? { dueBy: dueByStr === null ? null : new Date(dueByStr) } : {})
  ```

  Absent ⇒ unchanged (today's behavior); explicit `null` ⇒ cleared. This is a real API
  contract change, not just a form tweak.
- Task responses may now carry `dueBy: null`.

### 4. `packages/web`

- `Task.dueBy: string | null`; `CreateTaskInput`/`UpdateTaskInput` accept `string | null`.
- `taskForm.ts` and `newTaskForm.ts`: drop the "A valid due date is required" rule; an empty
  field serializes to `null`; `toFormState` maps `null → ''`. A non-empty but unparseable
  value is still an error.
- `defaultQuickAddInput` and `CreatePopover` keep their +7-day defaults, unchanged.
- `TaskDrawer` and `NewTaskModal`: the `datetime-local` input stays, with a
  "Leave empty for no deadline" hint — an empty date field is otherwise not discoverable as
  a feature.
- `TaskRow`: `Due {dueShort}` becomes a muted "No deadline" when the date is null.
- `sortBucket`: `Date.parse(a.dueBy)` would be `NaN` for null, which sorts unpredictably;
  use `Infinity` for undated so those tasks land at the bottom of their priority group.

## Non-goals

- No "no deadline" option in the planner click-to-create popover: it creates a block at a
  specific time, where a deadline is close to meaningless.
- No filter, sort, or grouping for undated tasks on the Priorities board.
- No change to the scheduler package.
- No backfill or migration of existing tasks to undated.

## Tests

- **db mappers:** null `dueBy` → fallback; non-null → unchanged.
- **db repo (integration):** create with null, PATCH to null, round-trip. Requires real
  Postgres — this worktree has no `packages/db/.env.test`, so this file is written but will
  not run until `TEST_DATABASE_URL` points at the local cluster. Flag, do not skip silently.
- **core assemble:** `undatedTaskIds` lists exactly the undated tasks; an undated task's
  engine `dueBy` equals the horizon end.
- **core compute:** an undated task is placed normally when there is room; when there is not,
  it produces NO `unscheduled` row; a *dated* task that does not fit still produces one.
- **server routes:** create undated (absent and explicit null); PATCH with `null` clears;
  PATCH without the field leaves the existing date unchanged; PATCH with a date sets it.
- **web:** form validation accepts an empty due date and emits `null`; `toFormState` maps
  null → `''`; `TaskRow` renders "No deadline"; `sortBucket` puts undated last; quick-add
  still defaults to +7 days.
