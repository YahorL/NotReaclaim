# Review 6: Lifecycle + Sidebar Config + Subtask Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. CONTRACT-level plan: READ every file you touch first and follow its idioms. TDD throughout. Spec: `docs/superpowers/specs/2026-06-10-notreclaim-review-6-design.md`.

**Branch:** `feat/review6-lifecycle` off `main`. Baseline suite **534** (core 47, db 52, google 33, scheduler 40, server 91, web 271).

---

### Task 1: Backend lifecycle (db + server, TDD per package)

**Migrations** (three, separate dirs, timestamps 20260610030000/030001/030002):
1. `task_status_backlog`: `ALTER TYPE "TaskStatus" ADD VALUE 'backlog';` (enum-only; Prisma schema enum gains `backlog`).
2. `task_completed_at`: `ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMPTZ;` (schema `completedAt DateTime? @db.Timestamptz`).
3. `subtask_sort_order`: `ALTER TABLE "Subtask" ADD COLUMN "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;` (schema `sortOrder Float @default(0)`).

**db package contracts (+ repo tests for each):**
- Task repo: `UpdateTaskInput` gains `status` already? (check; it's spread-based — ensure `completedAt?: Date | null` is accepted in UpdateTaskInput). New `purgeCompletedBefore(userId: string, cutoff: Date): Promise<number>` (deleteMany where status completed AND completedAt not null AND completedAt < cutoff; returns count).
- Subtask repo: `create` defaults `sortOrder` to `max(within task)+1` (aggregate where taskId); `UpdateSubtaskInput` gains `sortOrder?: number`.
- Task `include: { subtasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }` in BOTH listByUser and findById.
- Tests: backlog status round-trips on create/update; purge deletes only old-completed (completed-recent, pending-old survive) and cascades subtasks; subtask default ordering max+1 + reorder via update.

**server contracts (+ route tests):**
- `schemas.ts`: both task status enums (update + list query) gain `'backlog'`; `updateSubtaskSchema` gains `sortOrder: z.number().optional()` (refine: title/done/sortOrder).
- `task-routes.ts` PATCH: when `body.status` present → `completedAt: body.status === 'completed' ? new Date(deps.now()) : null` merged into the update data. (Idempotent re-complete refreshes the stamp — acceptable.)
- `task-routes.ts` GET /tasks: first line `await deps.repos.tasks.purgeCompletedBefore(request.userId, new Date(deps.now() - 30 * 24 * 60 * 60 * 1000));` — widen the AppDeps tasks type if it's a Pick (check app.ts; it uses full TaskRepository — fine).
- `subtask-routes.ts` PATCH passes sortOrder through (spread-based — verify).
- fakes: fakeTaskRepo gains `completedAt: null` default + `purgeCompletedBefore` (filter rows); fakeSubtaskRepo make gains `sortOrder: 0` and create computes max+1 (server tests for popover ordering don't exist — keep the fake faithful anyway).
- Tests: PATCH status completed sets completedAt (response field), un-complete clears it; GET /tasks purges (seed an old completed task via opts, expect it absent and a recent one present); backlog accepted by PATCH + list query filter; subtask sortOrder PATCH.
- CORE: no changes (`SCHEDULABLE_TASK_STATUSES = ['pending','scheduled']` already excludes backlog — verify by reading, note in report). google: fixture compile check only.

Gates: db/server/core/google `npm test` + builds. Commit: `feat: backlog status, completed-at + 30-day purge, subtask ordering (db/server)`

---

### Task 2: Board lifecycle columns (web, TDD)

**Contracts:**
- `api/types.ts`: TaskStatus union gains `'backlog'`; `Task.completedAt: string | null`; `Subtask.sortOrder: number`; `UpdateSubtaskInput.sortOrder?: number`. Fixture sweep (`completedAt: null`, subtask `sortOrder: 0`).
- `priorityBucket.ts`: new `BoardColumnKey = BucketKey | 'backlog' | 'completed'`; helpers for labels. Board columns become: 4 buckets (tasks with status pending/scheduled), `backlog` (status backlog, sortBucket order), `completed` (status completed, ordered by completedAt desc).
- `Priorities.tsx`: columns memo per the above (search applies everywhere; Hide-completed hides the Completed column; colsVisible map extends with backlog/completed default true — read Toolbar to extend its Columns dropdown accordingly).
- DnD: buckets + backlog are drop targets; completed is NOT (no drop, its rows not draggable). Drop semantics in `onMove`: target bucket → patch `{priority (if changed), sortOrder, ...(status was backlog/completed? → status:'pending')}` — i.e. dragging from backlog into a bucket reactivates; target backlog → `{status:'backlog', sortOrder}` (keep priority).
- TaskRow: rows in completed column: not draggable, ✓ un-complete (existing onComplete toggles status → 'pending'); backlog rows: muted (e.g. opacity-70), draggable.
- Column headers: Backlog (label "Backlog", neutral dot/border classes — add literal classes to BUCKET-like meta for the two new columns), Completed.
- Tests (Priorities.test): completed task renders in the completed column not its bucket; backlog drag in (patch status backlog) and out (status pending + priority + sortOrder); completed column rejects drop (no updateTask call); hide-completed hides the column; un-complete from completed column returns task to bucket.

Gates: web suite + typecheck. Commit: `feat(web): Backlog and Completed board columns with lifecycle drag semantics`

---

### Task 3: Sidebar pages + popover due default + subtask drag (web, TDD)

**Contracts:**
1. **Popover due default** (`CreatePopover.tsx` + test): initial `dueLocal = isoToLocalInput(iso(max(dayStartMs, startOfToday(now)+7d… )))` — concretely: `const weekOut = new Date(); // NO — component has no now prop;` use `dayStartMs` and `Date.now()`?? The component avoids Date.now (DI convention). CHECK: CreatePopover currently derives everything from dayStartMs. Add an optional `now?: () => number` prop defaulting to `() => Date.now()` (the codebase's standard), compute `defaultDueMs = Math.max(dayStartMs, startOfDayLocal(now()) + 7*MS_PER_DAY) + (23*60+59)*60_000` where startOfDayLocal mirrors weekModel's local-midnight idiom (reuse `startOfWeek`-style setHours(0,0,0,0) inline or a small helper in weekModel with test). Planner/WeekGrid thread nothing (default prop). Tests: clicking today's column → due = today+7d 23:59; clicking a column 10 days out (fixture day) → due = that day 23:59 (the max guard).
2. **Sidebar routes** (`Sidebar` lives where NavItems are rendered — find it via `grep -rn "Buffers" app/shell/`): "Buffers" disabled item → routing NavItem to `/buffers`; ADD "Hours" routing item in the same Time-blocking group (reuse an existing icon, e.g. clock/calendar). `routeTitle.ts` gains `/buffers` → 'Buffers', `/hours` → 'Hours'. New `app/pages/Buffers.tsx`: loads settings via the settingsForm helpers (mirror pages/Settings first-time-setup fallback), renders ONLY the two buffer FieldBox inputs + Save (PUT full settings payload from loaded form state). New `app/pages/Hours.tsx`: heading + `<CategoriesSection …/>` (check its props — pass what pages/Settings passes). Routes registered where the app's routes live (read `main.tsx`/`AppShell` routing). Tests: pages render and save/PATCH correctly (buffers PUT carries the loaded settings with changed buffer values); nav items route (existing NavItem tests pattern).
3. **Subtask drag-reorder** (TaskDrawer + test): each checklist `<li>` draggable; same insertion-index pattern as the board (top/bottom half, jsdom degenerate rule "insert above"); on drop → `useUpdateSubtaskMutation` with `{sortOrder}` midpoint via `insertionSortOrder` (import from priorityBucket — it's generic over `{sortOrder}`); subtasks rendered already sorted by the server; visual insert-line. Tests: drag subtask to top → PATCH `{sortOrder: first-1}`; drag down past removal point (off-by-one guard like the board — decrement when source above target).

Gates: web suite + typecheck. Commit: `feat(web): buffers/hours sidebar pages, week-out popover due default, drag-sortable subtasks`

---

### Task 4: Full suite + live verification + merge

- Root `npm test`; `npm run build`; `cd packages/db && npx prisma migrate deploy`; restart API (`.env.run`).
- Live (geckodriver; client-side nav for /settings-like routes!): backlog column drag in/out; complete a task → lands in Completed; GET /tasks purge (manually set a completedAt 31d ago via psql, reload board, expect gone); /buffers and /hours pages from the sidebar; popover due = +7d; drag a subtask and see the order persist (and planner labels follow).
- Merge → main; suite green; delete branch; update memory.
