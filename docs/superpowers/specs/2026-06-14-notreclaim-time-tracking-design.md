# NotReclaim — Task Time Tracking (design)

Date: 2026-06-14

## Goal

Track how much time has been spent on a task and how much is left, surface those
figures in the UI, and let the scheduler stop planning a task once its time is met.
A per-user setting controls whether time is counted automatically or only after the
user explicitly **Starts** a task.

This design is **timer-free**: "spent" is derived purely from the durations of the
task's scheduled blocks that have already finished. There is no live stopwatch, no
banking, and no running-timer state.

## User-confirmed behaviour

- **Spent = Σ duration of the task's *finished* blocks** (`block.end <= now`).
  **Left = max(0, durationMs − spent).** An in-progress or future block does not
  contribute to spent until it finishes.
- **Auto mode** (setting OFF — default): every finished block counts. Pressing
  **Start** is optional and only snaps the block start (see below) so the count can
  reflect when work really began.
- **Manual mode** (setting ON): **Start** marks the block as started and snaps its
  start to the nearest 15 minutes. A block that **finishes un-started is deleted from
  the calendar** and never counts.
- **Missed (deleted) blocks are re-planned later**: the scheduler reschedules the
  task's remaining time into a future slot. The task still aims for its full duration.
- **Left drives the scheduler**: `remaining = durationMs − spent − (future pinned
  coverage)`; once `remaining <= 0` the scheduler places no more blocks. The task is
  **not** auto-completed — the user marks it complete.
- **Resize / move a block after starting it works**: the started block is pinned and
  remains draggable/resizable; spent uses the block's actual (possibly edited) start
  and end.

## Non-goals / out of scope

- Any live timer / stopwatch / banking / pause.
- Auto-completing a task when it reaches 0 left.
- A historical time-log / per-session audit trail.
- Time tracking for habit blocks (tasks only).
- Manually editing logged time in the UI.

## Data model

### Settings (one new field)

- `requireStartToTrack: boolean` — default `false`.
  - Prisma: `requireStartToTrack Boolean @default(false)`
  - UI label: **"Only count time after I press Start."**

### ScheduledBlock (one new field)

- `startedAt: DateTime?` — set when the user presses Start (the click instant); `null`
  means not started. Used in manual mode to (a) keep the block out of the discard sweep
  and (b) include it in "spent". Decoupled from `startsAt` (which the snap edits).

`timeLoggedMs` on Task is **not used** by this design (left as-is). No new Task columns.

### Task API payload (derived, read-only)

- `spentMs: number` — computed server-side (see Computation) and returned on every task
  so the drawer and panel cards show the same number everywhere.

## Computation (one pure, tested helper in core)

`computeSpentMs(taskId, blocks, requireStartToTrack, now)` — pure, no IO:

- Consider the task's blocks with `block.end <= now` (finished).
- **Auto mode** (`requireStartToTrack === false`): sum `(end − start)` over all of them.
- **Manual mode** (`requireStartToTrack === true`): sum only those with `startedAt != null`.

This single helper is used by:

1. **Tasks GET routes** — load the user's blocks via
   `listByUserInRange(userId, new Date(0), new Date(now))`, group by `taskId`, attach
   `spentMs` per task. `left` is computed on the client as `max(0, durationMs − spentMs)`.
2. **The scheduler assembler** — to subtract spent from remaining (below).

## Scheduler tie-in (`assemble.ts`)

Today `assemble.ts` loads blocks over `[now, horizonEnd]` and sets
`remaining = durationMs − futurePinnedCoverage`. Change:

- Load blocks over `[new Date(0), horizonEnd]`.
- `spent = computeSpentMs(task, blocks, requireStartToTrack, now)` (finished blocks).
- `coverage` = sum of **pinned** blocks with `end > now` (current/future) — unchanged
  semantics, just explicitly time-filtered so it never overlaps `spent`.
- `remaining = durationMs − spent − coverage`; existing `if (remaining <= 0) continue;`
  then naturally stops scheduling a finished task.
- The engine's `pinnedBlocks` input stays current/future only (`end > now`); past
  blocks are history and must not be re-fed as immovable busy time.

Because a discarded (manual-mode, un-started) block is neither counted in `spent` nor
pinned coverage, its time stays in `remaining` → the engine re-plans it. (Confirmed
"re-plan later" behaviour, no forfeit tracking required.)

## Start + 15-minute snap

### `round15(ms)` (pure, tested)

`Math.round(ms / 900000) * 900000` — nearest 15 minutes. e.g. 15:10 → 15:15.

### `POST /schedule/:id/start`

1. Load the block (`scheduledBlocks.findById(userId, id)`); 404 if missing, 400 if it
   has no `taskId` (habit block).
2. `snapped = round15(now)`. If `block.startsAt < snapped < block.endsAt` (started
   late, snap lands inside the block), update the block: `startsAt = snapped`, `endsAt`
   unchanged, `pinned = true`. Otherwise keep `startsAt` (on-time/early — never extend).
3. Set `startedAt = now` and `pinned = true` on the block (so it survives the discard
   sweep and reconcile).
4. `afterMutation(userId)` so reconcile reclaims any freed gap.
5. Return the updated block.

The same endpoint serves both modes; in auto mode it just snaps + records `startedAt`
(harmless — counting ignores `startedAt` in auto mode).

## Manual-mode discard sweep

A helper deletes past un-started task blocks: blocks where `taskId != null`,
`endsAt <= now`, `startedAt == null`, **only when** `requireStartToTrack` is true. It
runs as part of `reconcile` (`afterMutation`) and at the start of `GET /schedule`
(self-healing on load so missed blocks visibly disappear). Correctness of "spent" does
not depend on the sweep — `computeSpentMs` already excludes un-started blocks in manual
mode; the sweep only removes them from the calendar.

## API summary

- DB migration: +1 Settings column, +1 ScheduledBlock column.
- Repos: `settings` upsert includes `requireStartToTrack`; `scheduledBlocks` gains
  `findById(userId, id)`, `update` accepts `startedAt`, mapper exposes `startedAt`.
- Server: `POST /schedule/:id/start`; discard sweep wired into reconcile + `GET
  /schedule`; attach `spentMs` in tasks GET; `settingsSchema` + `requireStartToTrack`.
- `startedAt`/`pinned` for a Start are set by the start endpoint, not the generic
  `updateScheduledBlockSchema` (the snap/drag path already handles `pinned`).

## Web UI

- **Settings form:** a checkbox bound to `requireStartToTrack`.
- **Start button** (task blocks only), in two places:
  - **Next-task topbar widget** (`TopBar.tsx`).
  - **Planner task tile** (`InteractiveBlock.tsx`).
  - Shows **Start** when `startedAt == null`; once started, shows a non-interactive
    "Started" state. (Same in both modes; in auto mode it is purely optional.)
- **Spent / left figures** (e.g. `1h20m / 2h` with a thin progress bar):
  - **Task edit drawer** (`TaskDrawer.tsx`).
  - **Right-side panel cards** (`PlannerTaskPanel.tsx`).
- New client/query mutation: `useStartBlockMutation` (invalidate `['schedule']` and
  `['tasks']`). Formatting reuses `formatDurationShort`.

## Testing

- Pure unit tests: `round15`; `computeSpentMs` (auto vs manual; finished vs in-progress
  vs future; started vs un-started; resize changes the counted duration).
- Server route tests (DB + settings fakes): start snaps late / keeps on-time / pins /
  records `startedAt` / reclaims; `spentMs` attached in tasks GET; discard sweep deletes
  past un-started blocks only in manual mode and leaves started ones; assemble subtracts
  spent so a finished task stops being scheduled and a discarded block is re-planned.
- Web component tests: Start vs Started button state; clicking calls the mutation;
  drawer & panel render spent/left and the progress bar; settings checkbox round-trips.
- Tests run per-package; web tests with `TZ=UTC`. TDD throughout.

## Edge cases

- Start when `snapped` is at/after the block end or at/before the start: no move; just
  records `startedAt` + pins.
- Start on a block with no `taskId`: 400 (no habit timers).
- Switching the setting changes displayed/scheduled numbers (auto counts all finished
  blocks; manual counts only started ones) — acceptable for a single-user app.
- A finished task (`remaining <= 0`) stays `pending` with 0 left and gets no new blocks
  until the user completes it.
