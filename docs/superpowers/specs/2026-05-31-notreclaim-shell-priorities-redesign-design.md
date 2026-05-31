# NotReclaim Web — Dark Shell + Priorities Board Redesign — Design Spec

**Date:** 2026-05-31
**Status:** Approved (ready for implementation planning)
**Parent design source:** `design_handoff_notreclaim/` (hi-fi HTML/React prototype + `README.md` tokens)
**Depends on:** Milestones 1–5d + post-completion increments (all merged).

## Summary

Re-skin the NotReclaim web client to the provided design handoff and add a new
**Priorities** Kanban board as the primary task-management surface. This is **Milestone 1**
of the redesign: the **dark app shell** (sidebar + top bar + design tokens) and the
**Priorities board** wired to real `Task` data. The Planner re-skin and the Stats dashboard
are explicitly **deferred to later milestones**.

The handoff prototype uses inline styles + CSS variables + static seed data. We recreate it
**pixel-accurately using the codebase's conventions**: Tailwind theme tokens (not inline
styles), TanStack Query against the real API (no mock data), React Router, extensionless
imports, no `import React`, dependency-injected `now` at the page boundary, and
vitest + jsdom + `fakeApiClient` tests.

## Goals

- Dark 280px sidebar + 70px top bar shell matching the handoff tokens, replacing the current
  light sidebar.
- A `/priorities` Kanban board: four priority-bucket columns of real tasks, drag-to-reprioritize,
  inline complete, search, status filter, column show/hide, column collapse, and full edit/delete
  by reusing the existing `TaskDrawer`.
- A New Task modal (from the top bar) wired to `createTask`.
- Retire the old `/tasks` list page (Priorities replaces it); keep Habits and Settings reachable.
- Deterministic tests (jsdom, fakes, `TZ=UTC`); build typechecks tests.

## Non-Goals

- **Planner re-skin** (kind palette/legend/header) — deferred to Milestone 2; Planner keeps its
  current styling and renders inside the new shell.
- **Stats dashboard** — deferred to Milestone 3; the `Stats` nav item and `/stats` route show a
  "Coming soon" placeholder.
- **No-backend prototype features** — Scheduling Links, Find-a-time, Smart Meetings, Calendar
  Sync directory, Buffers, Focus, Help articles, Invite teammates have no NotReclaim backend.
  They are **not** built with mock data: nav items render disabled with a small "Soon" pill (or
  route to the closest real page where noted). No Scheduling-Links cards on the board.
- No backend/API change. No new endpoints. No engine change.

## Decisions (locked during brainstorming)

- **Scope/order:** shell + Priorities now; Planner re-skin and Stats are separate milestones.
- **Data:** wire only views backed by real APIs; defer everything with no backend (no fake data).
- **Priorities replaces Tasks:** the board is the primary task UI; the old `/tasks` page is retired
  and `/tasks` redirects to `/priorities`.
- **Priority↔bucket mapping:** `priority` 1→Critical, 2→High, 3→Medium, **≥4→Low**. Dragging a
  task to a column sets `priority` to that column's canonical number (1/2/3/4).
- **New Task modal now**, and **reuse the existing `TaskDrawer`** for editing so retiring the Tasks
  page loses no capability.
- **Default home stays Planner** (`/`); Priorities is `/priorities`.
- **Styling via Tailwind theme tokens + Mulish font**, utility classes (arbitrary values where
  pixel-exact), not inline-style objects.

## Design Tokens

Add to `tailwind.config.js` `theme.extend`:

- **colors:** `indigo #5b62e3`, `indigo600 #4f55d6`, `indigoSoft #eef0ff`, `sidebar #1b1e2e`,
  `sidebarHover #272b3f`, `sidebarText #c5c8d6`, `sidebarMuted #8b8fa3`, `bg #f4f5f8`,
  `card #ffffff`, `line #e7e8ee`, `ink #2a2d3a`, `inkSoft #6b6f80`, priority
  `crit #e5484d`, `high #f2700f`, `med #f5b014`, `low #2fa45f`. Kind palettes (for Planner M2,
  defined now so they exist): `focus/meeting/habit/task` each `{bg, bar, text}` per the README.
- **fontFamily.sans:** `['Mulish', 'system-ui', 'sans-serif']`.
- **boxShadow:** `card '0 1px 2px rgba(20,22,40,.04)'`, `pop '0 14px 40px rgba(20,22,50,.16)'`,
  `modal '0 24px 60px rgba(20,22,50,.28)'`.
- **keyframes/animation:** `pop` (opacity + translateY(8px) + scale .98 → none, .14s ease-out)
  and `fade` (opacity 0→1, .12s) for popovers/modal/overlay.

Add **Mulish** via a Google-Fonts `<link>` in `index.html` (weights 400–800). Apply
`font-sans` on `<body>`/root and `antialiased`.

`index.css` keeps the three `@tailwind` directives; add a tiny base layer if needed for the dark
sidebar scrollbar (`.dark-scroll`) and `html,body{height:100%}` so the shell can lock to viewport
height with only page content scrolling.

## Architecture / Components

### App shell

- **`app/Sidebar.tsx`** (rewritten): dark `sidebar` background, `w-[280px]`, full-height, internal
  scroll. Contents:
  - **Logo** (`app/shell/Logo.tsx`): the 2×2 mark (pink circle `#f4b8c2`, teal rounded-square
    `#6ee0c8`, indigo rounded-square `#7c87ff`, yellow circle `#ffd166`) + wordmark
    "**notreclaim**" white 800 with "**.app**" in `#8b8fff`; muted pin icon at right (non-interactive).
  - **`NavItem`** (`app/shell/NavItem.tsx`): icon + label, hover `bg-white/5`, active
    `bg-sidebarHover text-white font-bold`; supports `indent` (muted child rows), `expandable`
    (chevron up/down), and `disabled` (muted + a small "Soon" pill, non-interactive). Routing
    items use React Router `NavLink` (`end` for `/`); disabled items are plain buttons.
  - **Nav map (M1 behavior):**

    | Item | Behavior |
    |---|---|
    | Planner | NavLink `/` (end) |
    | Priorities | NavLink `/priorities` |
    | Stats | NavLink `/stats` (placeholder page) |
    | Time blocking ▸ Habits | NavLink `/habits` |
    | Time blocking ▸ Focus / Buffers / Tasks | disabled "Soon" |
    | Meetings ▸ Smart Meetings / Scheduling Links | disabled "Soon" |
    | Calendar Sync | NavLink `/settings` |
    | Help ▸ Documentation / Contact support / What's new | disabled "Soon" |
    | Invite teammates | disabled "Soon" |

    "Time blocking" and "Meetings" default expanded; "Help" default collapsed (expansion is local
    `useState`).

- **`app/shell/TopBar.tsx`**: 70px, `bg`. Left: `<h1>` page title (27px/800, letter-spacing
  -0.5px) derived from the current route (a small `routeTitle(pathname)` pure helper).
  Right actions: **Find a time** (disabled "Soon"), **New Task** (calls `onNewTask`), a search
  icon button (disabled "Soon"), and an **account** button (`app/shell/AccountMenu.tsx`):
  conic-gradient avatar + chevron → popover with **Settings** (NavLink `/settings`) and
  **Sign out** (`useAuth().signOut`); closes on outside mousedown.

- **`app/AppShell.tsx`** (restructured): `flex h-screen overflow-hidden`. `Sidebar` + a
  `flex-1 flex-col min-w-0` main column containing `TopBar` → `<Outlet/>` (the page-content region
  scrolls; root is locked to viewport height). Owns **New Task modal open state**
  (`useState(false)`); `TopBar onNewTask` opens it; renders `<NewTaskModal/>` when open so it is
  reachable from every page. Keeps the existing `useWebSocket({ token })` mount.

### New Task modal

- **`app/shell/NewTaskModal.tsx`**: fixed overlay `rgba(24,26,42,.35)` (`animate-fade`), top-aligned
  card (`w-[500px]`, `rounded-[18px]`, `shadow-modal`, `animate-pop`), close on overlay click / X /
  successful create. Fields:
  - **Task name** (focused-looking indigo-ringed input, leading emoji icon) → `title`.
  - **Duration** stepper (±15 min, min 15; label "X mins" / "X hr(s)") → `durationMs`.
  - **Split up** toggle (checkbox): on → keep `minChunkMs`/`maxChunkMs`; off → `minChunkMs =
    maxChunkMs = durationMs` (single block).
  - **Min duration** / **Max duration** steppers (±15 min, min 15; min ≤ max enforced) →
    `minChunkMs` / `maxChunkMs`. Disabled/dimmed when **Split up** is off.
  - **Due date** `<input type="datetime-local">` → `dueBy` (via `localInputToIso`).
  - Read-only rows preserved for fidelity: **Hours = "Working Hours"** (from `useSettingsQuery`,
    best-effort) and **Schedule after = "Now"** (static) — the `Task` model has no `notBefore`
    field, so these are display-only. Footer left icons (pencil/eye-off/arrow) are decorative,
    non-interactive.
  - **Create** button → `createTask({ title, priority: 4, durationMs, dueBy, minChunkMs,
    maxChunkMs, category: null })` (new tasks land in **Low**, matching the prototype). On success,
    close (TanStack Query invalidates `tasks` + `schedule`).
- **`app/shell/newTaskForm.ts`** (pure): `NewTaskFormState`, `defaultNewTaskForm(now, settings?)`
  (duration 1h; min 30m / max 120m or settings defaults; `dueBy` = now + 7 days; split = true),
  `validateNewTaskForm(state)` (title required; duration > 0; 15 ≤ min ≤ max), and
  `toCreateTaskInput(state)`. Reuses `app/lib/duration.ts` helpers (`msToHM`, `localInputToIso`,
  `isoToLocalInput`).

### Priorities board

- **`app/priorities/priorityBucket.ts`** (pure):
  - `BUCKETS = ['critical','high','medium','low'] as const`; `BucketKey` type.
  - `priorityToBucket(priority: number): BucketKey` — `<=1` critical, `2` high, `3` medium, else low.
  - `bucketToPriority(bucket: BucketKey): 1|2|3|4`.
  - `BUCKET_META: Record<BucketKey, { label: string; colorVar: string }>` (Critical/High
    priority/Medium priority/Low priority; colors `crit/high/med/low`).
  - `relativeDayTimeLabel(ms: number, now: number): string` — "Today h:mma" / "Tomorrow h:mma" /
    "Ddd h:mma" for the "Next:" hint.
  - `nextBlockMsForTask(taskId, preview): number | null` — soonest `preview.blocks` start where
    `sourceType==='task' && sourceId===taskId`.
- **`app/priorities/TaskRow.tsx`** (new; distinct from the retired `app/tasks/TaskRow.tsx`):
  HTML5 `draggable` row, 4px left border = bucket color, check button (toggles
  completed↔pending via `updateTask({ status })`), title (strike + dim when completed), meta line
  `[Due {dueBy} · ]Next: {relativeDayTimeLabel}` (calendar icon; "Next" omitted if no upcoming
  block), hover reveals an overflow **⋯** button → Edit (open drawer) / Delete (`deleteTask`).
  Clicking the row body opens the edit drawer. `data-testid="task-row"`, `data-task-id`,
  `data-bucket`.
- **`app/priorities/TasksCard.tsx`**: white card (`rounded-xl border border-line shadow-card`),
  header "Tasks" + count chip + collapse chevron, then the column's `TaskRow`s.
- **`app/priorities/Column.tsx`**: `w-[372px]` (collapsed `w-[250px]`, `transition-[width]`),
  header label (`inkSoft` 700) + Collapse/Expand button; drop zone — on drag-over of a *different*
  bucket, outline `2px dashed indigo`; on drop, `onMove(taskId, bucketKey)`. Empty column shows
  centered muted "Nothing here yet" / "Drop to move here" while a drag targets it.
- **`app/priorities/Toolbar.tsx`**: search pill (430px) bound to page `query`; **Filter** dropdown
  (single row **Hide completed**; the prototype's "Only with a due date" is **dropped** because
  every `Task` has a required `dueBy`); **Columns** dropdown (4 rows with colored dots toggling
  per-bucket visibility); **Help** dropdown (decorative radio rows, "Soon"). Reusable
  `Dropdown`/`MenuRow` primitives in `app/priorities/Dropdown.tsx` (popover: `shadow-pop`,
  `animate-pop`, close on outside mousedown).
- **`app/pages/Priorities.tsx`**: `useTasksQuery()` + `useSchedulePreviewQuery()` (for "Next:"),
  `useUpdateTaskMutation()`, `useDeleteTaskMutation()`. Page-local state: `query`,
  `colsVisible` (4 booleans, all true), `hideCompleted`. Derives columns: tasks with
  `status !== 'archived'`, optionally hide completed, title-search filter, grouped by
  `priorityToBucket`, only visible buckets rendered. Renders `Toolbar` then the horizontal
  `Column` row. Manages `editingTask` state → renders the reused `TaskDrawer`. Loading/error/empty
  states mirror the existing pages' patterns.
  - **Complete:** check → `updateTask({ id, patch: { status: completed?'pending':'completed' } })`.
  - **Reprioritize (drag/drop):** `onMove(taskId, toBucket)` →
    `updateTask({ id, patch: { priority: bucketToPriority(toBucket) } })` (no-op if already in that
    bucket). Invalidation refetches `tasks` (+ `schedule`), re-deriving columns.

### Routing (`app/App.tsx`)

- Inside `AppShell`: `/` → `Planner`, `/priorities` → `Priorities`, `/habits` → `Habits`,
  `/settings` → `Settings`, `/stats` → `StatsPlaceholder` (a simple "Coming soon" panel,
  `app/pages/StatsPlaceholder.tsx`), and `/tasks` → `<Navigate to="/priorities" replace />`.
- **Retire** `app/pages/Tasks.tsx` + `Tasks.test.tsx` and the now-unused `app/tasks/TaskRow.tsx`
  + `TaskRow.test.tsx`. **Keep** `app/tasks/TaskDrawer.tsx`, `taskForm.ts`, `app/lib/duration.ts`,
  and `app/components/QuickAdd.tsx`/`DurationField.tsx` (QuickAdd still used by Habits). Update
  `app/app/App.test.tsx` (nav assertions: Tasks link gone, Priorities present).

## Data flow

`useTasksQuery()` → tasks → filter (archived/completed/search) → `groupBy priorityToBucket` →
columns. `useSchedulePreviewQuery()` → `nextBlockMsForTask` → "Next:" hints. Mutations
(`updateTask` for complete + reprioritize, `deleteTask`, `createTask` from the modal) invalidate
`tasksRoot` + `scheduleRoot`, so the board and the Planner stay fresh. No new query keys.

## Error handling

No new error surfaces. Mutations surface failures via the existing pattern (disabled control +
inline message); the board falls back to no "Next:" hint if the preview query errors. The New Task
modal disables **Create** while the mutation is pending and shows an inline error on failure.

## Testing (jsdom; fakes; `TZ=UTC`)

- **Pure modules:** `priorityBucket` (mapping both directions; bucketing of priority 0/1/2/3/4/9;
  `relativeDayTimeLabel` Today/Tomorrow/weekday under `TZ=UTC` with injected `now`;
  `nextBlockMsForTask` picks the soonest matching block, null when none). `newTaskForm`
  (defaults, validation incl. min≤max + title-required, `toCreateTaskInput` incl. split-off
  collapsing min=max=duration). `routeTitle`.
- **Components (`renderWithProviders` + `fakeApiClient(overrides as never)`):**
  - `Sidebar`/`NavItem`: routing items render as links with correct active state; disabled items
    show "Soon" and are non-interactive; expandable sections toggle children.
  - `TopBar`/`AccountMenu`: New Task triggers callback; account menu opens, Settings links, Sign
    out calls `signOut`.
  - `NewTaskModal`: opens/closes; duration/min/max steppers; split toggle disables min/max and
    collapses to single block; Create calls `createTask` with mapped fields (priority 4); closes
    on success.
  - Priorities `TaskRow`/`Column`/board: tasks render in the right bucket columns; check toggles
    status via `updateTask`; search filters; Hide-completed filters; Columns toggle hides a column;
    collapse hides a column body; drag-drop (`fireEvent.dragStart` on a row + `dragOver`/`drop` on a
    column, with a mock `dataTransfer`) calls `updateTask({ priority })`; row click / ⋯→Edit opens
    the `TaskDrawer`; ⋯→Delete calls `deleteTask`.
  - `App`: `/priorities` renders the board within the shell; `/tasks` redirects to `/priorities`;
    `/stats` shows the placeholder.
- Build/typecheck clean (`tsc -p tsconfig.json && vite build`), full monorepo suite green.

## Scope / decomposition (for the implementation plan)

Roughly 7 TDD tasks, sequential:
1. **Design tokens** — `tailwind.config.js` theme + `index.html` Mulish link + `index.css` base.
2. **Sidebar + Logo + NavItem** (dark nav, routing/disabled/expandable) + update `App.test` nav.
3. **TopBar + AccountMenu + AppShell** restructure (modal open state, route title).
4. **`newTaskForm` + `NewTaskModal`** wired to `createTask`.
5. **`priorityBucket` pure module** (+ `routeTitle` if not done in 3).
6. **Priorities components + page** (`TaskRow`, `TasksCard`, `Column`, `Dropdown`, `Toolbar`,
   `Priorities.tsx`); reuse `TaskDrawer`; complete/drag/search/filter/columns/collapse/edit/delete.
7. **Routing** (`/priorities`, `/stats` placeholder, `/tasks` redirect) + retire Tasks page/row +
   final verification (all packages + web build).
