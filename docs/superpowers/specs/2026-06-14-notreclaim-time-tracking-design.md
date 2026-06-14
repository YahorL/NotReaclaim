# NotReclaim — Task Time Tracking (design)

Date: 2026-06-14

## Goal

Track how much time has been spent on a task and how much is left, surface those
figures in the UI, and add a per-user setting that controls whether time is
counted automatically or only after the user explicitly **Starts** a task.

Pressing **Start** also snaps the task's scheduled block start to the nearest
15-minute mark (reflecting "I started late") without changing the block's end.

## User-confirmed behaviour

- **Auto mode** (setting OFF — the default): a scheduled block's time counts toward
  the task's "spent" **only once that block has finished** (`block.end <= now`).
  Whole finished blocks count; an in-progress block does not tick partially.
  Pressing Start is optional and only performs the 15-minute snap.
- **Manual mode** (setting ON): the user presses **Start**; a live timer runs and
  **auto-ends at the assigned block's end**. If the user never starts a block, that
  block's time **does not count**. Stopping / completing / starting another task
  banks the elapsed time.
- The user can **resize (or move) a block after starting it** and the timer keeps
  working — its auto-end boundary follows the block's *current* end.

## Non-goals / out of scope

- Multiple concurrently-running timers (at most one task runs at a time).
- A historical time-log / per-session audit trail (only the accumulated total).
- Time tracking for habit blocks (tasks only).
- Manually editing logged time in the UI (the field exists on the API but no UI).
- Idle detection, pause (distinct from stop), pomodoro, notifications.

## Data model

### Settings (one new field)

- `requireStartToTrack: boolean` — default `false`.
  - Prisma: `requireStartToTrack Boolean @default(false)`
  - UI label: **"Only count time after I press Start."**

### Task (two new server-managed fields)

`timeLoggedMs` already exists (Int, default 0). Add:

- `runningSince: DateTime?` — when the current live timer started (null = not running).
- `runningBlockId: String?` — the scheduled block the timer is bound to. Used to read
  the *current* block end as the auto-stop boundary, so resizing the block updates it.

At most one of the user's tasks has `runningSince != null` at any time.

### Task API payload (derived, read-only)

- `spentMs: number` — computed server-side (see Computation) and returned on every task.
- `runningSince: string | null` — so the client can show Start vs Stop.

`runningBlockId` stays server-side (not needed by the client). `timeLoggedMs`
continues to be returned and remains client-settable via `PATCH /tasks/:id`.

## Computation (one pure, tested helper on the server)

`computeSpentMs(task, taskBlocks, settings, now)` — pure, no IO:

- **Auto mode** (`requireStartToTrack === false`):
  `spentMs = Σ over taskBlocks where block.end <= now of (block.end - block.start)`.
  (Whole finished blocks only. In-progress / future blocks contribute 0.)
- **Manual mode** (`requireStartToTrack === true`):
  `spentMs = timeLoggedMs + live`, where
  `live = task.runningSince ? clamp(min(now, boundary) - runningSince, 0) : 0`
  and `boundary = endsAt of the block whose id === runningBlockId` (looked up in
  `taskBlocks`); if that block is missing, `boundary = now`.

`taskBlocks` = the user's scheduled blocks for this task. The tasks GET routes load
the user's blocks via `listByUserInRange(userId, new Date(0), new Date(now))` (overlap
semantics → all blocks starting at/before now; future-only blocks are excluded and
would contribute 0 anyway), group by `taskId`, and attach `spentMs` per task.

`left` is **not** stored; the client computes `left = max(0, durationMs - spentMs)`.

## Start / Stop / snap / bank

### `round15(ms)` (pure, tested)

Round to nearest 15 minutes: `Math.round(ms / 900000) * 900000`. e.g. 15:10 → 15:15.

### `POST /schedule/:id/start`

1. Load the block (`scheduledBlocks.findById(userId, id)`); 404 if missing, 400 if it
   has no `taskId` (habit block).
2. `snapped = round15(now)`. If `block.startsAt < snapped < block.endsAt`, update the
   block: `startsAt = snapped`, `endsAt` unchanged, `pinned = true`. (Skip the move if
   `snapped <= block.startsAt` — started early/on-time — or `snapped >= block.endsAt`.)
3. **Manual mode only:** bank any currently-running task (`tasks.findRunning`), then set
   `runningSince = snapped` (or the unchanged `block.startsAt` when no move happened)
   and `runningBlockId = block.id` on `block.taskId`. **Auto mode:** no timer is set.
4. `afterMutation(userId)` so reconcile reclaims the freed gap.
5. Return the updated block.

Note `runningSince` is set to the (snapped) block start, not the click instant, so the
running task aligns with where its block now begins; `live` clamps to ≥ 0 if `snapped`
is slightly in the future.

### `POST /schedule/:id/stop`

Resolve `taskId` from the block, bank that task, return the updated block. (Symmetric
with start; the tile and Next-task widget always have the block id.)

### Banking helper (`bankRunningTask`)

For a running task: `timeLoggedMs += clamp(min(now, boundary) - runningSince, 0)` where
`boundary = current end of runningBlockId's block` (or `now` if gone); then clear
`runningSince` and `runningBlockId`.

### Complete

`PATCH /tasks/:id` with `status: 'completed'`: if the task is running, bank it first,
then apply the status change.

### Resize-after-start

The started block is pinned, so the existing drag/resize path (`InteractiveBlock` →
`PATCH /schedule/:id`) keeps working. Because the manual-mode boundary is read live from
`runningBlockId`'s current `endsAt`, resizing/moving the block automatically updates the
timer's auto-end. No change to the resize path itself; verified by a test.

## API summary

- DB migration: +1 Settings column, +2 Task columns.
- Repos: `settings` upsert includes `requireStartToTrack`; `tasks` update includes
  `runningSince`/`runningBlockId` + new `findRunning(userId)`; `scheduledBlocks` +
  `findById(userId, id)`.
- Server: `POST /schedule/:id/start`, `POST /schedule/:id/stop`; bank-on-complete in
  `PATCH /tasks/:id`; attach `spentMs` (and continue returning `runningSince`) in tasks
  GET; `settingsSchema` + `requireStartToTrack`.
- `runningSince`/`runningBlockId` are server-managed and are **not** accepted from the
  client `updateTaskSchema`.

## Web UI

- **Settings form:** a checkbox bound to `requireStartToTrack`.
- **Start/Stop button** (task blocks only), in two places:
  - **Next-task topbar widget** (`TopBar.tsx`).
  - **Planner task tile** (`InteractiveBlock.tsx`).
  - Manual mode → Start⇄Stop toggle (Stop shown while `runningSince != null`).
    Auto mode → momentary **Start** (snap only; no Stop state).
- **Spent / left figures** (e.g. `1h20m / 2h` + a thin progress bar):
  - **Task edit drawer** (`TaskDrawer.tsx`).
  - **Right-side panel cards** (`PlannerTaskPanel.tsx`).
- New client/query mutations: `useStartBlockMutation`, `useStopBlockMutation`
  (invalidate `['schedule']` and `['tasks']`). Formatting reuses `formatDurationShort`.

## Testing

- Pure unit tests: `round15`, `computeSpentMs` (both modes, finished vs in-progress
  blocks, running timer with live clamp, missing running block, resize-changes-boundary).
- Server route tests (DB + settings fakes): start snaps & pins & reclaims; start sets
  the timer in manual mode only; start banks a previously-running task; stop banks;
  complete banks; resizing a running block updates the boundary; `spentMs` attached.
- Web component tests: button shows Start vs Stop by mode/running; clicking calls the
  right mutation; drawer & panel render spent/left and progress.
- Tests run per-package; web tests with `TZ=UTC`. TDD throughout.

## Edge cases

- Start when `snapped >= block.end` (started essentially at/after the block): skip the
  move; in manual mode the timer still starts but `live` is ~0.
- Start on a block with no `taskId`: 400 (no habit timers).
- Switching the setting changes displayed numbers (auto vs manual use different sources);
  acceptable for a single-user app — no migration of historical values.
- Deleting the running block: boundary falls back to `now`; banking stops cleanly.
