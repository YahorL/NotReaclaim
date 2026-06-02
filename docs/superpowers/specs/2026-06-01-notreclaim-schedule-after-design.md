# NotReclaim — "Schedule after" (not-before constraint) (Review 1, Milestone D) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` item #6 — *"Also the schedule after button doesn't work."*
**Builds on:** Milestone C (per-task `allowedWindows` in `assemble`; the engine already confines task
placement to a task's windows).

## Summary

Make the New Task modal's dead **"Schedule after → Now"** field functional as a per-task
**not-before** constraint: the scheduler will not place a task before that time (the lower-bound mirror
of `dueBy`'s upper bound). Implemented by adding a nullable **`Task.notBefore`** column and, in
`assemble`, **clipping the task's `allowedWindows` to `[notBefore, horizonEnd]`** — reusing the
Milestone-C windows pipeline, so **no scheduler-engine change is needed**. Wires the constraint into
the New Task modal and the edit drawer (a `datetime-local`; empty = "Now"/no constraint).

## Goals

- A nullable `Task.notBefore` (epoch/Date) persisted, default `null` (= schedule anytime from now).
- The engine never schedules a task chunk to start before `notBefore`; a task that cannot fit after
  `notBefore` and before its `dueBy` lands in the At-risk panel (hard constraint).
- New Task modal: the static "Now" span becomes a real `datetime-local` (empty = no constraint).
- Edit drawer: a "Schedule after" `datetime-local`.
- Deterministic tests at every layer; backward-compatible (null `notBefore` = today's behavior).

## Non-Goals

- **No scheduler-engine change** (`@notreclaim/scheduler` untouched): `notBefore` is applied as an
  `assemble`-time clip of `allowedWindows`, not a new `FlexibleTask` field.
- No recurring/relative "schedule after" (e.g. "3 days from now") — an absolute datetime only.
- No effect on habits (habits have their own preferred/allowed windows; `notBefore` is task-only).
- No change to categories, `dueBy`, or the re-plan flow beyond threading the new field through.

## Decisions (locked during brainstorming)

- **Approach A — window clip, no engine change.** In `assemble`, when `task.notBefore` is set,
  `allowedWindows = intersectIntervals(allowedWindows, [{ start: notBefore, end: horizonEnd }])`.
  Because `placeItem` places at the candidate interval's start, clipping the window start to
  `notBefore` makes placements begin at `notBefore` even mid-slot — no `placeItem` change required.
  (Rejected Approach B — a first-class `FlexibleTask.notBefore` + `placeItem` `earliestStart` arg —
  as strictly more engine code for the same result.)
- **Why `dueBy` stays an engine field but `notBefore` is a clip:** `dueBy` predates per-task windows
  and drives `placeItem`'s slot-fit deadline check (`slot.start + size <= deadline`); `notBefore` is
  naturally a window lower-bound and reuses the Milestone-C `allowedWindows` pipeline. Deliberate,
  documented asymmetry.
- **`notBefore` is a hard constraint** (no chunk starts before it). Past `notBefore` → harmless no-op
  (windows already start at `now`); `notBefore` beyond the horizon → no windows → At-risk.
- **UI:** a `datetime-local` mirroring the Due-date field; **empty string = `null` = "Now"** (no
  constraint). Present in both the New Task modal and the edit drawer.
- **`notBefore` need not be ≤ `dueBy` at the form level** — if a user sets it past the due date the
  task simply can't be placed and shows in At-risk (no special validation; consistent with how an
  impossible window already behaves).

## Architecture / Components

### Data model — `@notreclaim/db`
- `Task` gains `notBefore DateTime? @db.Timestamptz` (nullable). Prisma migration adds the column
  (additive; existing rows get `NULL`).
- `CreateTaskInput` / `UpdateTaskInput` (task-repository) gain `notBefore?: Date | null`. The repo's
  `create`/`update` already spread their input, so the field threads through unchanged.
- `toFlexibleTask` (mappers) is **unchanged** — `notBefore` is consumed in `assemble`, not the engine.

### Assembly — `@notreclaim/core`
- Import `intersectIntervals` from `@notreclaim/scheduler` (already exported).
- In the tasks loop, after resolving `allowedWindows` for the task, clip it when `notBefore` is set:
  ```ts
  let allowedWindows = resolvedId ? expandedByCategoryId.get(resolvedId)! : workingWindows;
  if (t.notBefore) {
    allowedWindows = intersectIntervals(allowedWindows, [{ start: t.notBefore.getTime(), end: horizonEnd.getTime() }]);
  }
  ```
  (`horizonEnd` is the existing `new Date(now + horizonDays * MS_PER_DAY)`; use `.getTime()`.)

### Engine — `@notreclaim/scheduler`
- **No change.** Placement already confines to `allowedWindows`.

### Server — `@notreclaim/server`
- `createTaskSchema` gains `notBefore: z.string().datetime().nullable().optional()`
  (`updateTaskSchema` inherits it via `.partial()`).
- The task `POST`/`PATCH` handlers convert `notBefore` to a `Date` the same way `dueBy` is handled
  (a string → `new Date(...)`; `null`/absent passes through). No new routes.

### Web — `@notreclaim/web`
- `api/types.ts`: `Task.notBefore: string | null`; `CreateTaskInput.notBefore?: string | null` (ISO).
  No new ApiClient methods or query hooks (task create/update already carry the field).
- **New Task modal** (`shell/newTaskForm.ts` + `NewTaskModal.tsx`): `NewTaskFormState` gains
  `notBeforeLocal: string` (default `''`). `defaultNewTaskForm` sets `notBeforeLocal: ''`.
  `toCreateTaskInput` emits `notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null`.
  Replace the static `<span>Now</span>` with `<input type="datetime-local" value={form.notBeforeLocal}
  onChange={(e) => set('notBeforeLocal', e.target.value)} … />` (empty renders as the picker's blank
  state = "Now").
- **Edit drawer** (`tasks/taskForm.ts` + `TaskDrawer.tsx`): `TaskFormState` gains
  `notBeforeLocal: string`. `toFormState` sets `notBeforeLocal: t.notBefore ? isoToLocalInput(t.notBefore) : ''`;
  `toUpdateInput` emits `notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null`.
  Add a "Schedule after" `datetime-local` field (`data-testid` consistent with the existing fields).
  `defaultQuickAddInput` sets `notBefore: null` (quick-add has no constraint).

## Data flow

Modal/drawer `datetime-local` → `notBefore` (ISO or null) on the task → server create/update converts
to `Date` → `afterMutation` re-plan → `assemble` clips the task's `allowedWindows` to
`[notBefore, horizonEnd]` → engine places only within the clipped windows → committed blocks start at
or after `notBefore`. Null `notBefore` = no clip = unchanged behavior.

## Error handling

- Server: a malformed `notBefore` → `400` (zod `.datetime()` via the existing mapper). `null`/absent is
  valid.
- A `notBefore` that leaves no room before `dueBy` → the task is simply unplaced (At-risk panel), the
  same mechanism as an over-constrained category window. No special-case validation.

## Testing (vitest; `TZ=UTC`; no real Google; Postgres for `@notreclaim/db`)

- **`core/assemble`:** a task with `notBefore` mid-horizon gets `allowedWindows` clipped so none start
  before it (e.g. working hours Mon 09:00–17:00, `notBefore` = Mon 13:00 → resulting windows start
  ≥ 13:00); `notBefore` in the past → no-op (windows unchanged); `notBefore` after `horizonEnd` →
  empty windows (task unschedulable). `notBefore` composes with a non-default category's windows
  (intersection of both). (`TZ=UTC`, fixed `now`/horizon.)
- **`db` task-repository** (real Postgres): `create`/`update` round-trip `notBefore` (set + clear to
  null).
- **Server:** `POST`/`PATCH /tasks` accept `notBefore` (ISO → persisted), reject a non-datetime with
  `400`, and `null` clears it.
- **Web:** `newTaskForm`/`taskForm` round-trip `notBeforeLocal ⇄ notBefore` (incl. `'' ⇄ null`); the
  modal renders the `datetime-local` (no more static "Now") and submits `notBefore`; the drawer renders
  + saves it. (`fakeApiClient` + `renderWithProviders`.)
- Full monorepo suite (Postgres up) + `npm run build -w @notreclaim/web` green.

## Scope / decomposition (for the plan)

~5 sequential TDD tasks, backend → web:
1. **DB:** `Task.notBefore` migration + `CreateTaskInput`/`UpdateTaskInput` (repo) + db repo test.
2. **Core:** `assemble` clips `allowedWindows` to `notBefore` (+ `intersectIntervals` import) + tests.
3. **Server:** `createTaskSchema` `notBefore` + handler `Date` conversion + tests.
4. **Web — New Task modal:** DTOs (`Task.notBefore`/`CreateTaskInput.notBefore`) + `newTaskForm`
   `notBeforeLocal` + modal `datetime-local` (replace the dead "Now") + tests.
5. **Web — edit drawer:** `taskForm` `notBeforeLocal` + `TaskDrawer` "Schedule after" field + tests;
   then full verification (web suite + build, then the whole monorepo).
