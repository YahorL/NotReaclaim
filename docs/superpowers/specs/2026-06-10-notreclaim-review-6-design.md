# NotReclaim Review 6 — design (backlog/completed lifecycle, sidebar config, subtask order, due default)

**Date:** 2026-06-10. **Source:** user feedback + AskUserQuestion answers. Branch `feat/review6-lifecycle`.

## User decisions (recorded)
- "Items on the left" = **sidebar nav entries**: make "Buffers" functional + add an "Hours" (categories) entry, each opening its configuration directly.
- Completed tasks are **permanently deleted** 30 days after completion (subtasks/blocks cascade).
- Subtask reordering = **drag** in the drawer checklist.

## 1. Popover default due date
Calendar create-popover default due = **later of (clicked day, today + 7 days) at 23:59 local** (the "later of" guard prevents a default due before the clicked slot when clicking >1 week out). The New Task modal already defaults +7d 23:59 (R3) — unchanged.

## 2. Sidebar Buffers + Hours
- Sidebar "Buffers" (Time blocking) becomes a real route `/buffers`; new "Hours" entry (same group, calendar-ish icon) → `/hours`. `routeTitle` entries added.
- `/buffers` page: loads settings, edits ONLY meeting-buffer + task-gap (minutes, FieldBox style, same helper texts), saves via `PUT /settings` with the full settings payload built from loaded state (settingsForm helpers reused). First-time-setup fallback mirrors the Settings page.
- `/hours` page: renders the existing `CategoriesSection` (self-contained) under a heading.
- Settings page keeps both sections (no removal).

## 3. Backlog column (not scheduled)
- New `TaskStatus` value **`backlog`** (Prisma enum migration; safe: value only added). `SCHEDULABLE_TASK_STATUSES` stays `['pending','scheduled']` → backlog tasks are automatically NOT scheduled; their un-pinned blocks are swept on the next replan (keyed diff deletes undesired keys).
- Server: task status zod enums gain `'backlog'`. Web: board gets a **Backlog column** (drop target, far LEFT before Critical? — no: far RIGHT after Low, before Completed). Dragging a task INTO Backlog → `{status:'backlog'}` (priority kept). Dragging OUT into a bucket → `{status:'pending', priority, sortOrder}`. Backlog rows render slightly muted; within-backlog ordering = sortOrder (same DnD).
- Hide-completed filter and search apply to all columns.

## 4. Completed column + 30-day purge
- `Task.completedAt DateTime?` (migration). The PATCH /tasks route sets `completedAt = now` when a patch transitions status TO `completed`, and clears it (null) when status changes to anything else (only when `status` is present in the patch).
- Board: completed tasks move to a **Completed column** (far right; not a drop target; rows not draggable; ✓ un-complete returns the task to `pending` in its priority bucket). They no longer render inside priority buckets. The Toolbar "Hide completed" filter now hides the Completed column.
- **Purge:** `TaskRepository.purgeCompletedBefore(userId, cutoff)` deletes tasks with `status='completed' AND completedAt < cutoff` (cascades to subtasks/blocks). Called lazily at the top of `GET /tasks` with `cutoff = now − 30 days`. (Lazy purge = no background job; runs whenever the board loads.)

## 5. Subtask drag-reorder
- `Subtask.sortOrder Float @default(0)` (migration); repo `create` defaults to `max(sortOrder within task)+1`; task `include` orders subtasks by `sortOrder asc` (replaces createdAt asc — existing rows all 0 → fall back stable by createdAt? Prisma needs a deterministic secondary: order `[sortOrder asc, createdAt asc]`).
- `PATCH /subtasks/:id` accepts `sortOrder`. Web `UpdateSubtaskInput.sortOrder?`.
- Drawer checklist rows become draggable (HTML5, same midpoint-insertion pattern as the board, reusing `insertionSortOrder`); order drives the card checklist and the planner `Task: Subtask` labels automatically (both consume array order).

**Out of scope:** purge background scheduler (lazy purge only); backlog on the planner (backlog tasks simply don't schedule); completed-column pagination.
