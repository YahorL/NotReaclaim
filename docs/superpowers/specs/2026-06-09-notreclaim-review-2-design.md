# NotReclaim Review 2 — design

**Date:** 2026-06-09
**Source:** user feedback after testing the running app (7 items, given in chat).
**Status:** design approved in conversation; this doc is the written spec.

## Feedback items → milestones

| # | Item | Disposition |
|---|------|-------------|
| 1 | Cannot move tasks between days on the calendar | M-A (feature: cross-day drag) |
| 2 | Create test tasks scheduled after today | Ops only — seed fresh future-dated tasks after the milestones land (no code) |
| 3 | Blocks should snap to the 15-min grid fluidly while dragging, like Reclaim | M-A |
| 4 | Block jumps on resize release | M-A (bug: preview reset before refetch) |
| 5 | Subtask Add button does nothing; subtasks should show on the Priorities card | M-B (bug: missing Vite proxy entries; feature: on-card checklist) |
| 6 | New-task / edit windows use ugly default controls; restyle like Reclaim | M-C |
| 7 | Click an empty planner slot to create a task or an event there, like Reclaim | M-D |

**Sequence: M-B → M-A → M-C → M-D** (quick fix first, then drag feel, then styling, then the new feature). Each milestone: own branch, TDD, code review, merge to main — the established per-milestone workflow.

**User decisions (recorded):**
- Click-create offers a **Task | Event** choice.
- An **Event** is a real calendar event — not a task: stored in NotReclaim's DB, rendered exactly like a Google meeting (blue, blocks scheduling), and **written back to the user's primary Google Calendar when an account is connected** (same mirror philosophy as scheduled-block write-back). Local-only when not connected.
- Click-created **Task** is **pinned at the clicked slot** (locked block; schedule reflows around it).
- Subtasks render as a **checklist directly on the board card** (toggleable in place).
- Review-1 F2 (within-column ordering) stays out of scope — next in backlog after Review 2.

---

## M-B. Subtasks fix + on-card checklist (item 5)

**Root cause:** `packages/web/vite.config.ts` proxies only `/auth/google`, `/tasks`, `/habits`, `/settings`, `/schedule`, `/calendar`, `/ws`. The F1/C client calls `POST/PATCH/DELETE /subtasks*` and `GET/POST/PATCH/DELETE /categories*`, which never reach the API in dev — the Add button's mutation dies against the Vite server. (Production builds would not have had the bug; tests use a fake client, which is why the suite stayed green.)

**Changes:**
1. `vite.config.ts`: add `'/subtasks': API` and `'/categories': API` to the proxy map.
2. **Priorities board card checklist:** `app/priorities/TaskRow.tsx` renders the task's subtasks under the title as small checkbox rows (checkbox + title; done ⇒ struck-through grey), wired to `useUpdateSubtaskMutation` for in-place toggling. Keep the existing `✓ done/total` badge. No add/delete on the card (drawer remains the editing surface). Clicking a checkbox must not open the drawer (stopPropagation).

**Testing:** TaskRow tests — renders subtask rows, toggle calls the mutation with `{done}` flipped, click does not trigger row onEdit. Proxy config has no test (config file).

## M-A. Planner drag feel (items 1, 3, 4)

All in `packages/web` (`app/planner/InteractiveBlock.tsx`, `weekModel.ts`, `WeekGrid.tsx`, `api/queries.ts`). No server/engine change.

1. **Live 15-min snapping (item 3).** During a drag the preview currently applies the raw pixel offset (`translateY(movePx)`); snapping happens only on release. Change: on every pointer-move compute the snapped minute delta (`snapMinutes(pxToMinutes(dy))`) and convert it *back* to pixels for the preview (`minutesToPx`, new inverse helper in `weekModel`), so the block ticks along the 15-min grid while dragging — same for resize. While dragging, the block label shows the **live start–end times** (e.g. `09:15 – 10:45`) computed from the snapped preview delta.
2. **Cross-day move (item 1).** Track `clientX` as well: horizontal preview as `translateX(dayDelta * colWidthPx)` where `dayDelta = Math.round(dx / colWidthPx)`, with the day-column width **measured at pointer-down** (`currentTarget.parentElement.getBoundingClientRect().width` — columns are equal-width CSS grid tracks; a constant is wrong because the card is responsive). Clamp `dayDelta` so the target day stays within the rendered week (the block's day index + delta ∈ [0,6] — `InteractiveBlock` gains a `dayIndex` prop). On commit, shift `startsAt`/`endsAt` by `dayDelta` whole days **via local-date arithmetic** (`setDate(+delta)`, DST-safe, consistent with `weekModel`'s local-time convention) plus the snapped vertical minute delta; pinned=true as today. Resize stays vertical-only. Zero-delta (no day change, no minute change) remains a no-op.
3. **Jump fix (item 4).** `useUpdateScheduledBlockMutation` gets an optimistic update: `onMutate` cancels `scheduleRoot` queries, snapshots matching cached lists, patches the target block's `startsAt`/`endsAt`/`pinned` in place; `onError` restores snapshots; `onSettled` invalidates `scheduleRoot`. On release the block therefore renders at its committed position immediately — no revert-then-jump while the refetch is in flight.

**Testing:** weekModel — `minutesToPx` inverse round-trip, day-delta clamp helper. InteractiveBlock — preview transform uses snapped px (move by 7px ⇒ translateY 0; by 20px ⇒ one 15-min step), live time label appears while dragging, cross-day pointer sequence commits ±N-day ISO timestamps, day clamp at week edges. Queries — optimistic patch visible in cache before the request resolves, rollback on error. jsdom `getBoundingClientRect` returns 0 — tests stub it on the column element.

## M-C. Reclaim-style task forms (item 6)

Re-skin the **New Task modal** and the **task edit drawer** to the design handoff (`design_handoff_notreclaim/app/newtask.jsx`) using Tailwind + the existing design tokens (indigo, line, ink/inkSoft, card radii). Behavior, validation, mutations, and `data-testid`s are preserved — visual-only except where a control type itself changes (duration stepper).

Shared primitives (new `app/components/FieldBox.tsx` and `app/components/DurationStepper.tsx`):
- **`FieldBox`** — bordered rounded-[11px] box, small grey 600-weight label INSIDE the top, bold 18px value/content under it (the handoff `Field`).
- **`DurationStepper`** — bold human label (`1 hr`, `45 mins`) + circular indigo − / + buttons stepping ±15 min with a floor of 15; replaces `DurationField`'s h/m inputs in these two surfaces (DurationField stays for Habits/Settings).
- **Selects/inputs inside FieldBox** are borderless/transparent (`outline-none`, `appearance-none` + chevron for selects) so the box supplies all chrome; native pickers remain for datetime fields (styled box, borderless input inside).

**NewTaskModal:** white rounded-[18px] w-[500px] card, top-right ✕, autoFocus title input inside the indigo-ring box (2px indigo border + 3px indigoSoft halo), Duration stepper + "Split up" checkbox row (indigo square check), Min/Max duration FieldBoxes (visible when split), **Hours** = category select in a FieldBox, **Schedule after** / **Due date** FieldBoxes (datetime-local), footer = indigo pill **Create** button (rounded-[30px], shadow). The handoff's decorative foot icons / "schedules on you@gmail.com" line are dropped (no backing features).

**TaskDrawer:** stays a right-side drawer (placement unchanged) but rebuilt from the same primitives: FieldBoxes for Title/Duration(stepper)/Priority/Due/Schedule-after/Min/Max/Category/Status, restyled subtask checklist (indigo checkboxes, grey strike on done, borderless add-input in a FieldBox with an indigo pill Add), pill Save / ghost Cancel. Width grows to fit the boxes (~w-72/80).

**Testing:** existing modal/drawer tests updated for the stepper interaction (− / + clicks instead of typing h/m) and any changed accessible names; all validation/mutation assertions unchanged. Stepper unit tests (±15, floor 15, label formatting via existing `formatDurationShort`).

## M-D. Click-to-create on the planner (item 7)

### Server + DB
1. **Migration `local_calendar_events`:** `CalendarEvent.googleCalendarId`/`googleEventId` → nullable (`String?`). The `@@unique([userId, googleCalendarId, googleEventId])` stays — Postgres treats NULLs as distinct, and inbound sync always writes both ids. Locally created events have null ids until written back.
2. **`POST /calendar/events`** `{title: string≥1, startsAt: ISO, endsAt: ISO}` (zod-refined `startsAt < endsAt`) → creates a `CalendarEvent` with null google ids, fires the existing `afterMutation` reflow hook (new events must push flexible blocks aside), returns 201 with the event. **Google write-back, best-effort:** when the user is connected, insert into the primary calendar via the `GoogleClient` mirror methods and persist the returned ids; on failure (or not connected) the event stays local — the local row is the source of truth either way. Inbound sync later upserts by the same `(userId, calendarId, eventId)` key, so a written-back event dedupes naturally.
3. **`POST /schedule`** `{taskId: uuid, startsAt: ISO, endsAt: ISO}` (refined `startsAt < endsAt`) → verifies the task belongs to the user (404 otherwise), creates a **pinned** `ScheduledBlock` (`title` = task title, `engineKey` null — `@@unique(userId, engineKey)` permits multiple nulls), fires `afterMutation`, 201. Engine semantics already work: `assemble` counts pinned coverage against the task's duration and `applyDesiredSchedule`'s keyed diff never touches pinned blocks.
4. Both routes follow existing route-module conventions (`calendar-routes.ts`, `schedule-routes.ts`), widening `AppDeps.repos` Picks as needed.

### Web
5. **`CreatePopover`** (`app/planner/CreatePopover.tsx` + pure `createPopover.ts` helpers): opens when the user clicks empty space in a day column (`WeekGrid` listens on the column, ignores clicks bubbled from blocks); start = click offset-Y → minutes → snapped to 15 (clamped to the 06:00–22:00 window). Contents: **Task | Event** segmented toggle, autoFocus title input, duration stepper (default 30 min, ±15), live `HH:MM – HH:MM` slot preview, Create (indigo pill, disabled while pending/empty title) and ✕/Esc/outside-click to dismiss. Anchored absolutely inside the column at the click position (flips above when near the bottom).
6. **Create-Task path:** `createTask({title, durationMs: d, minChunkMs: d, maxChunkMs: d, priority: 4, dueBy: <clicked day 23:59 local>})` (no categoryId — the pinned block fully covers the task, so category windows are moot; user can set one later in the drawer) then `POST /schedule {taskId, startsAt, endsAt}` to pin it at the slot (min=max=duration ⇒ the pinned block fully covers the task; the engine schedules nothing extra). Two sequential mutations; if the second fails the task still exists unpinned — surface the API error in the popover.
7. **Create-Event path:** `POST /calendar/events {title, startsAt, endsAt}`; renders through the existing meetings pipeline (`useCalendarEventsQuery` → blue `EventBlock`, non-interactive). New mutation hooks invalidate `calendarEventsRoot` + `scheduleRoot` (event path) / `tasksRoot` + `scheduleRoot` (task path).

**Out of scope (explicit):** editing/deleting events from the planner (Google-sourced meetings stay read-only as today); recurring events; choosing a target calendar (primary only); Google write-back retry/backfill for events created while disconnected.

**Testing:** db — repo create with null google ids + migration applied. server — POST /calendar/events 201/validation-400/reflow-called/write-back-on-connected (FakeGoogleClient)/local-when-not-connected; POST /schedule 201-pinned/404-foreign-task/400-inverted-range/reflow-called. web — popover open-on-column-click with snapped start, segmented toggle, task path issues both mutations with pinned slot + min=max, event path posts and invalidates, Esc/outside dismiss, error surfacing. Engine/core: none (no changes).

---

## Cross-cutting

- **Conventions:** TypeScript ESM strict; backend imports explicit `.js`, web extensionless; DI with injected `now`; vitest; no real Google calls in tests (`FakeGoogleClient`).
- **Each milestone independently merged**; suite must be green at each merge (current baseline 436).
- **After all merges (item 2):** seed 3–4 demo tasks with future `dueBy`/`notBefore` via the API so scheduling is visible, and re-verify in the running app.
