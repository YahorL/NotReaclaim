# NotReclaim Web Client — Tasks & Habits Panels — Design Spec (Milestone 5c)

**Date:** 2026-05-30
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Foundation:** 5a (`...-web-foundation-design.md`) + 5b (`...-planner-weekview-design.md`), both merged.
**Depends on:** Milestones 1–5b (all merged).

## Summary

Milestone 5c implements the two CRUD pages behind the sidebar's **Tasks** and **Habits**
links (currently placeholders). Each page shares one pattern: a **quick-add bar**, a
**filterable list** with inline actions, and a **right-side edit drawer** with the full
field set. They consume the existing typed `ApiClient` task/habit methods; no server work is
required. Mutations refresh the affected lists and the schedule, and the 5b Planner reflects
changes automatically via the already-wired `task.changed`/`schedule.updated` WebSocket
invalidation.

## Goals

- `/tasks` and `/habits` pages: list, quick-add (title → smart defaults), create/edit via a
  drawer, delete (with confirm), and inline status actions (complete; pause/resume).
- Reuse 5b plumbing: extend `api/queries.ts` (shared query keys + hooks + mutations); rely on
  the existing realtime invalidation.
- A shared, pure duration/format library (ms ↔ h/m, minutes-of-day ↔ "HH:MM", ISO ↔
  datetime-local) since the API speaks **milliseconds** and users think in h/m and clock times.
- Client-side validation mirroring the server's key Zod rules for fast feedback; the server
  remains the source of truth (`ApiError` surfaced on the missed cases).
- Everything testable deterministically (jsdom, mocked `ApiClient`, injected `now`, `TZ=UTC`).

## Non-Goals (5c)

Reading `Settings.defaultMinChunkMs/MaxChunkMs` to seed quick-add defaults (5c uses hard-coded
client defaults; wiring Settings is a later enhancement once 5d lands). Drag/reorder,
bulk actions, optimistic updates, undo. Time-logging UI (`timeLoggedMs` is shown read-only at
most). The Settings page itself (5d). Any new server endpoint.

## Decisions (locked during brainstorming)

- **Create flow:** a **title-only quick-add bar** (instant capture with smart defaults) **plus
  a full edit drawer** for the rest. Two paths: fast capture, detailed edit.
- **Form presentation:** a **right-side drawer** (not a modal), opened by "edit" on a row or
  after quick-add when the user wants details.
- **Tasks list filtering:** fetch **all** tasks once (`listTasks()` with no status) and filter
  **client-side** via tabs — **Active = pending + scheduled**, Completed, Archived, All. (The
  server's `status` query param filters a single status; client-side filtering avoids
  multiple round-trips and supports the combined "Active" view.)
- **Delete:** a **two-step inline confirm** on the row's `×` (click → "Delete? Yes / Cancel"),
  to prevent accidental loss; no native `confirm()`.
- **Priority:** an integer field; **lower number = scheduled first** (engine semantics,
  `scheduler/src/types.ts`), surfaced as helper text. Quick-add default `3`.
- **No `habit.changed` WS event exists** — habit-list freshness comes from the habit
  mutations' own `['habits']` invalidation.

## Data layer — `api/queries.ts` extensions

Add to the existing `queryKeys` (keep the established `*Root` prefix convention):

```ts
  habitsRoot: ['habits'] as const,
  habits: () => ['habits'] as const,
```

Query hooks (read the client via `useApi()`):
- `useTasksQuery()` → `useQuery({ queryKey: queryKeys.tasks(), queryFn: () => api.listTasks() })`
  (no status → all tasks; filtered client-side). Note: `queryKeys.tasks(status?)` already exists.
- `useHabitsQuery()` → `useQuery({ queryKey: queryKeys.habits(), queryFn: () => api.listHabits() })`.

Mutation hooks (each invalidates its list root **and** `scheduleRoot`, since task/habit edits
change the auto-schedule):
- `useCreateTaskMutation`, `useUpdateTaskMutation`, `useDeleteTaskMutation` → invalidate
  `tasksRoot` + `scheduleRoot`.
- `useCreateHabitMutation`, `useUpdateHabitMutation`, `useDeleteHabitMutation` → invalidate
  `habitsRoot` + `scheduleRoot`.

`useUpdateTaskMutation`/`useUpdateHabitMutation` take `{ id, patch }`; deletes take `id`.

## Shared format library — `app/lib/duration.ts` (pure, tested)

No React; deterministic; unit-tested under `TZ=UTC`:
- `msToHM(ms): { hours: number; minutes: number }` and `hmToMs(hours: number, minutes: number): number`.
- `minutesToHHMM(min: number): string` (e.g. `360 → "06:00"`) and
  `hhmmToMinutes(s: string): number` (e.g. `"06:00" → 360`) — habit preferred window
  (minutes-from-midnight).
- `isoToLocalInput(iso: string): string` (ISO → `"YYYY-MM-DDTHH:MM"` for `<input
  type="datetime-local">`) and `localInputToIso(local: string): string` (local input → ISO via
  `new Date(local).toISOString()`).
- `formatDurationShort(ms): string` for list rows (e.g. `"1h"`, `"90m"`/`"1h 30m"`) — may reuse
  the spirit of `weekModel.humanizeMs` but lives here to keep `app/lib` self-contained.

## Tasks — `app/tasks/` (page at `app/pages/Tasks.tsx`)

### `taskForm.ts` (pure, tested)
- `defaultQuickAddInput(title: string, now: number): CreateTaskInput` — `{ title, priority: 3,
  durationMs: 60*60_000, dueBy: new Date(now + 7*86_400_000).toISOString(), minChunkMs:
  30*60_000, maxChunkMs: 120*60_000, category: null }`.
- `TaskFormState` (string/number fields the drawer binds to) + `toFormState(task: Task):
  TaskFormState`.
- `validateTaskForm(s: TaskFormState): { ok: boolean; errors: Partial<Record<keyof
  TaskFormState, string>> }` — title non-empty; `durationMs`/`minChunkMs`/`maxChunkMs` > 0;
  `minChunkMs ≤ maxChunkMs`; `dueBy` a valid date.
- `toCreateInput(s)` / `toUpdateInput(s)` — convert form state to `CreateTaskInput` /
  `UpdateTaskInput` (h/m → ms; datetime-local → ISO; empty category → null).

### Components
- `TaskQuickAdd.tsx` — controlled title input; Enter or "Add" → `onAdd(title)`.
- `TaskRow.tsx` — `title` · optional category badge · `formatDurationShort(durationMs) · due
  <date> · P{priority}`; inline **edit / ✓ complete / ×**. `×` toggles an inline confirm
  ("Delete? Yes / Cancel"). Completed rows render struck-through and omit the ✓ action.
- `TaskDrawer.tsx` — controlled form over `TaskFormState`: title; duration (h + m); priority
  (number, helper "lower = scheduled first"); `dueBy` (`datetime-local`); min/max chunk (h +
  m); category (text, blank → null); status (`select`, edit-only). Shows per-field validation
  errors and any mutation `ApiError`. `onSave(input)` / `onCancel()`.
- `Tasks.tsx` (page) — `useTasksQuery` + the three task mutations; client-side status tabs
  (Active = pending+scheduled, Completed, Archived, All); quick-add (→ `createTask`); drawer
  open-state for create/edit; row ✓ → `updateTask(id,{status:'completed'})`; delete-confirm →
  `deleteTask(id)`; loading / error (retry) / empty states.

## Habits — `app/habits/` (page at `app/pages/Habits.tsx`)

### `habitForm.ts` (pure, tested)
- `defaultQuickAddInput(title: string): CreateHabitInput` — `{ title, priority: 3, chunkMs:
  30*60_000, perPeriod: 3, eligibleDays: [0,1,2,3,4,5,6], preferredStartMinute: null,
  preferredEndMinute: null }`.
- `HabitFormState` + `toFormState(habit: Habit)`.
- `validateHabitForm(s)` — title non-empty; `chunkMs` > 0; `perPeriod` > 0; **≥1 eligible
  day**; if both preferred times set, `preferredStartMinute < preferredEndMinute`.
- `toCreateInput(s)` / `toUpdateInput(s)` — h/m → `chunkMs`; "HH:MM" → minutes (or null when
  blank); day toggles → `eligibleDays`.

### Components
- `HabitQuickAdd.tsx` — same shape as `TaskQuickAdd`.
- `HabitRow.tsx` — `title` · `formatDurationShort(chunkMs) × {perPeriod}/week` · eligible-day
  labels; inline **edit / pause↔resume (`status` toggle) / ×** (inline confirm). Paused rows
  dimmed.
- `HabitDrawer.tsx` — title; chunk (h + m); per-week (number); eligible-day toggles
  (Sun–Sat, 0–6); optional preferred window (two `<input type="time">`); priority; status
  (`select`, edit-only). Validation + `ApiError`.
- `Habits.tsx` (page) — `useHabitsQuery` + habit mutations; quick-add; list; drawer;
  pause/resume → `updateHabit(id,{status})`; delete-confirm → `deleteHabit(id)`; loading /
  error / empty states.

## Error handling

- Query errors → inline error strip with a retry (mirrors the Planner page).
- Mutation errors (`ApiError`) → message shown in the drawer (create/edit) or near the row
  (inline actions); the form stays open so the user can correct and retry.
- `401` → handled globally by the 5b interceptor (sign out + redirect).
- Empty list → a friendly empty state ("No tasks yet — add one above.").

## Testing (deterministic; jsdom; no network or Google)

- **Pure units:** `duration.ts` (ms↔h/m, minutes↔"HH:MM", ISO↔datetime-local round-trips,
  `formatDurationShort`); `taskForm.ts` / `habitForm.ts` (defaults with injected `now`,
  `toCreateInput`/`toUpdateInput` conversions, every validation rule incl. minChunk≤maxChunk,
  ≥1 eligible day, preferred start<end). `TZ=UTC`.
- **Components/integration** via `renderWithProviders` + `fakeApiClient`:
  - Tasks: quick-add Enter → `createTask` called with the defaulted input (title carried,
    durations in ms, `dueBy` from injected `now`); status tabs filter the rendered rows;
    row ✓ → `updateTask(id,{status:'completed'})`; delete confirm flow → `deleteTask(id)`;
    edit drawer prefilled from the task, Save → `updateTask` with converted values; invalid
    form (e.g. min>max) blocks Save and shows the error.
  - Habits: quick-add → `createHabit` with defaults; pause/resume → `updateHabit(id,{status})`;
    eligible-day toggles + preferred window convert correctly on Save; ≥1-day validation blocks
    submit; delete confirm → `deleteHabit(id)`.
  - Mutation invalidation: a create/update/delete invalidates the right roots (`['tasks']` or
    `['habits']`) **and** `['schedule']` (spy on `queryClient.invalidateQueries`).
- **Build/typecheck:** `tsc -p tsconfig.json && vite build` clean (the build typechecks tests).

## Scope

5c is cohesive (two parallel pages sharing one pattern + a shared duration lib) and suits a
single implementation plan, sequenced so the shared lib + `api/queries.ts` land first, then
Tasks, then Habits. It completes milestone 5 alongside **5d — Settings** (the final
sub-milestone: working hours, timezone, horizon, default chunk sizes).
