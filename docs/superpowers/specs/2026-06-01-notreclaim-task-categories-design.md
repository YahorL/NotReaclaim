# NotReclaim — Task Categories as Scheduling "Hours" (Review 1, Milestone C) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Source:** `review/Review 1.md` item #4 — *"When I create a new task, I cannot choose what
category to assign it to (e.g. 'Working Hours'). I also need to be able to create a category."*
**Builds on:** the dark-shell New Task modal (which already shows a dead "Hours → Working Hours"
placeholder), Settings working-hours (5d), and the scheduler's existing habit `allowedWindows`.

## Summary

Make a task's **category** a first-class, schedule-affecting **"Hours" policy**. Each category owns
a weekly set of time windows; the engine schedules a task **only inside its category's windows**. A
seeded default **"Working Hours"** category inherits the user's `Settings.workingHours`, so existing
behavior is preserved and the modal's current "Working Hours" label becomes real. Users can **pick** a
category in the New Task modal and the edit drawer, and **create / rename / delete / edit the windows
of** categories in a new "Categories" section on the Settings page. Adds a `Category` entity +
repository + CRUD routes, swaps `Task.category` (free text) for `Task.categoryId` (FK), generalizes
the engine envelope to the **union of all categories' windows**, and adds `FlexibleTask.allowedWindows`
mirroring the habit restriction that already exists.

## Goals

- A `Category` per user with a name and weekly windows (`{weekday, startMinute, endMinute}[]`).
- A seeded default **"Working Hours"** category whose windows **inherit `Settings.workingHours`**
  (`windows = null`), un-deletable; the Settings working-hours editor still edits it implicitly.
- New Task modal: a real **category dropdown** (default pre-selected) + **"+ New category"** quick
  create. Edit drawer: the same dropdown (replacing the free-text input).
- A **"Categories" section on the Settings page**: list + create + rename + delete + per-category
  weekly-window editor (reusing the existing working-hours editor).
- Engine: a task is scheduled **only within its category's windows**; the schedulable envelope is the
  **union** of all categories' windows (so e.g. "Personal = evenings" is reachable even when Working
  Hours are 9–5). Category/window changes trigger the existing re-plan hook.
- Deterministic tests at every layer; conventions held.

## Non-Goals

- **No `color` field / no category-based block tinting** this milestone (the Planner already colors by
  state per Milestone A; color is an easy later addition — deliberately omitted now).
- **No rework of the Settings page's working-hours editor or the `Settings.workingHours` column**
  (Approach 1: the default category *inherits* it; the Settings model is untouched).
- No per-category priority, no nested/sub-categories, no sharing categories across users.
- No change to habits (they keep their own `allowedWindows`/preferred-windows behavior).
- "Schedule after" (item #6 / Milestone D) and buffers (item #1 / Milestone E) are separate milestones.

## Decisions (locked during brainstorming)

- **Categories define the hours (not mere narrowing).** Each category fully defines when its tasks may
  schedule, independent of the global window; the engine envelope = union of all categories' windows.
- **Approach 1 — default category inherits Settings working hours.** `Category.windows` is nullable;
  `null` (only on the default category) means "use `Settings.workingHours`". Only additional categories
  store their own windows. No `Settings` migration; backward compatible.
- **Categories are a first-class entity** (a label/free-text scheme cannot hold windows).
- **Engine mirrors habits:** add `FlexibleTask.allowedWindows?: Interval[]`; `scheduleTask` confines to
  `free ∩ allowedWindows` using the same intersection habits already use. Absent → unchanged behavior.
- **Manage categories in a Settings section** (not a separate tab, not a heavy inline editor).
- **"+ New category" copies the default category's current windows** so the new category is immediately
  schedulable; the user refines its windows later in the Settings section.
- **`Task.categoryId` is nullable; `null` resolves to the user's default category** (so legacy/
  uncategorized tasks schedule in working hours exactly as today). FK `onDelete: SetNull`.

## Architecture / Components

### Data model — `@notreclaim/db` (Prisma + Postgres)

New model:

```prisma
model Category {
  id        String   @id @default(uuid())
  userId    String
  name      String
  windows   Json?    // WorkingHourEntry[]; null only on the default category (inherits Settings)
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@unique([userId, name])
}
```

`Task` changes: remove `category String?`; add `categoryId String?` + relation
`category Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)`.

**Migration:** create `Category`; add `Task.categoryId`; **backfill** one default category per existing
user (`name: "Working Hours"`, `windows: null`, `isDefault: true`); set every existing task's
`categoryId = null` (resolves to default); drop the old `Task.category` column. (Dev DB — distinct
legacy free-text `category` values are not preserved; they collapse to the default. This is acceptable
for the personal dev database.)

**`CategoryRepository`** (new, `repositories/category-repository.ts`):
- `listByUser(userId): Promise<Category[]>` (ordered: default first, then name).
- `getDefault(userId): Promise<Category | null>`.
- `ensureDefault(userId): Promise<Category>` — create the default if missing (idempotent; used at
  signup/first-settings so every user always has one).
- `create(userId, { name, windows }): Promise<Category>` (non-default; `windows` required).
- `update(userId, id, { name?, windows? }): Promise<Category>` — `NotFoundError` if not owned.
- `delete(userId, id): Promise<void>` — throws a domain error if the target `isDefault`; FK SetNull
  re-points its tasks to `null` (→ default).

**Mappers / helper:** `toFlexibleTask` is unchanged; `assemble` attaches `allowedWindows` to each
`FlexibleTask` *after* mapping (the same way it already overrides `durationMs` for pinned coverage). A
small helper `categoryWindows(category, settings) → WorkingHourEntry[]` returns
`category.windows ?? settings.workingHours`.

### Engine — `@notreclaim/scheduler` (pure)

- `types.ts`: add `allowedWindows?: Interval[]` to `FlexibleTask` (doc-comment identical in spirit to
  the habit field: a HARD restriction; an unplaceable task chunk is left unscheduled).
- `items.ts` `scheduleTask(free, task)`: when `task.allowedWindows` is present, restrict candidate free
  time to `free ∩ allowedWindows` (use the existing `intersectIntervals` helper that `scheduleHabit`
  uses; if none exists as a shared export, factor the habit's intersection into `intervals.ts` and call
  it from both — no behavior change to habits). Placement, chunking, and the returned `free` (full,
  un-intersected, minus what was consumed) follow the existing task algorithm. Absent `allowedWindows`
  → today's behavior verbatim.
- `schedule.ts` is unchanged structurally (it already passes `free` per item); the per-task envelope
  union is built by the caller (`assemble`) and arrives as `input.workingWindows`.

### Assembly — `@notreclaim/core`

- `SchedulingRepositories` gains `categories: Pick<CategoryRepository, 'listByUser'>`.
- Load `categories = await repos.categories.listByUser(userId)`.
- Build `expandedByCategoryId: Map<string, Interval[]>`: for each category, expand
  `category.windows ?? settings.workingHours` via `expandWorkingWindows(…, timezone, now, horizonDays)`.
- **Envelope:** `workingWindows = mergeIntervals([...expand(settings.workingHours), ...all category
  expansions])`. (Default category contributes `settings.workingHours`; including it explicitly keeps
  the envelope correct even if a user has zero non-default categories.)
- **Per task:** resolve the task's category — `task.categoryId` if set and present in the map, else the
  user's default category id. Set `allowedWindows = expandedByCategoryId.get(resolvedId)`. A task in the
  default category therefore gets `settings.workingHours` as `allowedWindows`, and since the envelope
  ⊇ those windows, its placement is identical to today's global behavior.
- Pinned-coverage reduction and status filtering are unchanged.

### Server — `@notreclaim/server`

- `schemas.ts`: `workingHourEntrySchema` (`{ weekday: 0..6, startMinute: 0..1440, endMinute >
  startMinute }`); `createCategorySchema` (`name` non-empty, `windows: workingHourEntrySchema[]`
  non-empty); `updateCategorySchema` (`name?`, `windows?` — at least one present). Task create/update
  schemas: replace `category` with `categoryId: z.string().uuid().nullable().optional()`.
- New `category-routes.ts`: `registerCategoryRoutes(app, deps, afterMutation)` with guarded
  `GET /categories`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id`. Each
  mutation calls `afterMutation(request.userId)` (windows/assignment affect scheduling → reflow +
  `schedule.updated`). Delete of the default → domain error mapped to **409**; not-owned id → **404**;
  zod failure → **400**.
- `app.ts`: widen `AppDeps.repos` with `categories: CategoryRepository`; register the new routes; pass
  the existing `afterMutation`. `server.ts` wires the real repo. Task create/update handlers pass
  `categoryId` through.
- **Default-category guarantee:** call `repos.categories.ensureDefault(userId)` where a user is first
  provisioned (alongside settings creation / first `GET /categories`) so the picker is never empty.

### Web — `@notreclaim/web`

- `api/types.ts`: `Category { id; userId; name; windows: WorkingHourEntry[] | null; isDefault: boolean }`;
  `CreateCategoryInput { name; windows }`; `UpdateCategoryInput { name?; windows? }`; `Task.categoryId:
  string | null`; `CreateTaskInput.categoryId?: string | null` (drop `category`).
- `api/client.ts`: `listCategories`, `createCategory`, `updateCategory`, `deleteCategory` (+ fake base
  entries).
- `api/queries.ts`: `categoriesRoot` key + `useCategoriesQuery`; `useCreateCategoryMutation` /
  `useUpdateCategoryMutation` / `useDeleteCategoryMutation` (each invalidates `categoriesRoot` **and**
  `scheduleRoot`). Task mutations now send `categoryId`.
- **New Task modal (`shell/NewTaskModal.tsx` + `shell/newTaskForm.ts`):** `NewTaskFormState` gains
  `categoryId: string | null`; `defaultNewTaskForm` leaves it `null` and the modal initializes it to the
  default category id once `useCategoriesQuery` resolves. The dead "Hours" block becomes a real
  dropdown listing categories (default first), plus a **"+ New category"** action: a small inline name
  prompt → `createCategory({ name, windows: <copy of the default category's resolved windows, i.e.
  `settings.workingHours`> })` → select the new id. `toCreateTaskInput` emits `categoryId`.
- **Edit drawer (`tasks/TaskDrawer.tsx` + `tasks/taskForm.ts`):** replace the free-text `category`
  input with the same category dropdown; `taskForm` state uses `categoryId: string | null`.
- **Categories section (Settings page):** a new component (e.g. `app/settings/CategoriesSection.tsx`)
  listing categories with rename + delete (default row: rename allowed? — **no**; default is fixed
  "Working Hours", delete disabled, windows shown as "from your working hours" / read-only here since
  they live in the working-hours editor above) and, for non-default categories, the **weekly-window
  editor reused from the Settings working-hours UI** (extract the existing per-weekday editor into a
  shared `WeeklyHoursEditor` if it isn't already reusable). Create-category control here too.
- A shared pure `app/categories/categoryForm.ts` (validation: non-empty name, ≥1 enabled window,
  `start < end`; conversions to `CreateCategoryInput`/`UpdateCategoryInput`), mirroring `settingsForm`.

## Data flow

Create/select category in modal/drawer → `categoryId` saved on the task → on any task or category
mutation the server runs `afterMutation` → re-plan (`reconcile` or `planLocally`) calls
`assembleScheduleInput`, which builds the **union envelope** and per-task `allowedWindows` from
categories → `schedule()` places each task only within its category's windows → `applyDesiredSchedule`
commits → `schedule.updated` → web invalidates `scheduleRoot` (+ `categoriesRoot`) → Planner/board
refresh. Settings working-hours edits flow through as the default category's windows (inherited).

## Error handling

- Server: zod → 400; not-owned category → 404; deleting the default category → 409 (domain error via
  the existing error mapper). The reflow hook's failures are swallowed/logged exactly as the existing
  `replanAfterMutation` does (the mutation itself already succeeded).
- Web: category-query failure surfaces via the existing page error affordances; the modal disables
  submit until categories load (falls back to `null` → default if the query errors, so task creation is
  never blocked by categories being unavailable).
- A category whose windows are empty/never overlap free time → its tasks land in `unscheduled`
  (At-risk panel), same mechanism as an over-constrained habit.

## Testing (vitest; `TZ=UTC`; no real Google; Postgres for `@notreclaim/db`)

- **Engine (`scheduler`):** `scheduleTask` with `allowedWindows` confines placement to the intersection;
  a chunk that can't fit the windows is left unscheduled; absent `allowedWindows` is byte-for-byte the
  old behavior (regression). Reuse/refactor the habit intersection without changing habit tests.
- **`core/assemble`:** envelope = union of `settings.workingHours` + category windows (e.g. a "Personal
  = evenings" category makes evening free time appear); a task with a non-default `categoryId` gets that
  category's `allowedWindows`; a task with `categoryId = null` resolves to the default
  (`settings.workingHours`) and schedules identically to today; default category with `windows = null`
  inherits settings. (`TZ=UTC`, fixed `now`, fixed horizon.)
- **`db` `CategoryRepository`** (real Postgres): create/list (default-first ordering)/update/delete;
  `ensureDefault` idempotent; delete-default rejected; deleting a category SetNulls its tasks'
  `categoryId`; `@@unique(userId, name)` enforced.
- **Server routes:** category CRUD happy paths; 400 (bad windows), 404 (other user's id), 409 (delete
  default); each mutation fires the after-mutation reflow (assert via the harness hook/`schedule.updated`
  spy); task create/update round-trips `categoryId`.
- **Web:** pure `categoryForm` (validation + conversions); `newTaskForm`/`taskForm` carry `categoryId`;
  `NewTaskModal` renders the dropdown from `useCategoriesQuery`, defaults to the default category, "+ New
  category" calls `createCategory` and selects it, submit sends `categoryId`; `TaskDrawer` dropdown
  edits `categoryId`; `CategoriesSection` lists/creates/renames/deletes and edits non-default windows;
  delete disabled for the default. (`fakeApiClient(overrides as never)` + `renderWithProviders`.)
- Full monorepo suite (all packages, Postgres up) + `npm run build -w @notreclaim/web` green.

## Scope / decomposition (for the plan)

Sizable but one coherent feature. ~9 sequential TDD tasks, **backend/engine first so the UI builds on a
real API**:

1. **DB:** `Category` model + `Task.categoryId` migration + backfill default-per-user + drop
   `Task.category`; `CategoryRepository` (+ `ensureDefault`, delete-default guard) + tests.
2. **Engine:** `FlexibleTask.allowedWindows` + `scheduleTask` intersection (shared interval helper) +
   tests (regression for the no-windows path).
3. **Core:** `assemble` categories dep + union envelope + per-task `allowedWindows` + tests.
4. **Server:** category schemas + `category-routes` CRUD + `afterMutation` wiring + `AppDeps`/`app.ts`/
   `server.ts` + `ensureDefault` provisioning + task-schema `category → categoryId` + tests.
5. **Web API layer:** `Category` DTOs + client methods + query/mutation hooks + fakes + tests.
6. **New Task modal:** functional category dropdown + "+ New category" + `newTaskForm` `categoryId` +
   tests.
7. **Edit drawer:** category dropdown replacing free-text + `taskForm` `categoryId` + tests.
8. **Settings "Categories" section:** shared `WeeklyHoursEditor` extraction + list/create/rename/delete
   + per-category window editing + `categoryForm` + tests.
9. **Verification:** full monorepo suite (Postgres up) + web build; whole-branch review.
