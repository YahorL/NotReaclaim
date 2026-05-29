# NotReclaim Pinned-Block Fulfillment — Design Spec (Milestone 3b-iii)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Context:** A fix for an interaction found in the milestone 3b-ii review; lands on the
same branch (`feat/writeback-reconcile`) and merges together with 3b-ii.
**Depends on:** Milestones 1–3b-ii, all on `feat/writeback-reconcile` / `main`.

## Problem

When a user moves an auto-scheduled block in Google, `detectDrift` pins it
(`pinned = true`) but the block keeps its `engineKey`. The underlying task stays
pending with its full `durationMs`, and the engine has no notion that the pinned
block already covers part of that work. So `computeDesiredSchedule` re-places the
task's full duration as a fresh placement with the same engine id
(`task:<id>:<index>`), which collides with the pinned block's retained
`engineKey` under `@@unique([userId, engineKey])` → `ConflictError` (crash) and a
conceptual duplicate. Habits have the same collision risk and an analogous
over-scheduling problem (a pinned occurrence isn't counted against `perPeriod`).

## Goals

1. **No crash:** a pinned block must not collide on `engineKey`.
2. **No duplicate work:** pinned blocks count toward their task's / habit's
   scheduled work, so the engine doesn't re-place already-covered time.
3. Keep the engine backward-compatible and everything deterministic + DB-free in
   tests.

## Non-Goals

- Time-tracking / `timeLoggedMs`-based reduction (separate feature).
- Auto-completing tasks that pins fully cover (status is unchanged; the task is
  simply not re-placed).
- Any HTTP/timer wiring (milestone 4).

## Part A — clear `engineKey` on pin (`@notreclaim/google`)

In `detectDrift`, when a moved event pins a block, also clear its `engineKey`:
`scheduledBlocks.update(userId, block.id, { startsAt, endsAt, pinned: true, engineKey: null })`.

Rationale: a pinned block is user-fixed and managed by the drift/pin path, not the
keyed diff. Clearing `engineKey` removes it from the diff key space (multiple
nulls coexist under the unique index), eliminating the collision for tasks and
habits alike.

## Part B1 — task fulfillment (`@notreclaim/core`)

In `assembleScheduleInput`, when building the `FlexibleTask` list, reduce each
task's `durationMs` by the duration already covered by **pinned** blocks bound to
it:

- Covered = sum of `(end − start)` over pinned engine blocks (already built as
  `pinnedBlocks`) with `sourceType === 'task'` and `sourceId === task.id`.
- `remaining = max(0, durationMs − covered)`.
- If `remaining === 0`, **drop the task** (no fresh placement).
- Else emit the task with `durationMs = remaining` (other fields, including
  `minChunkMs`/`maxChunkMs`, unchanged).

Only **pinned** blocks count; non-pinned engine blocks are the engine's own
recomputed output and must not reduce the task.

## Part B2 — per-period habit fulfillment

### Engine extension (`@notreclaim/scheduler`, additive/backward-compatible)

Add an optional field to the engine `Habit`:

```ts
/**
 * Optional per-period occurrence targets, parallel to `periods`. When present,
 * periodTargets[i] is the number of occurrences to place in periods[i]
 * (a target of 0 places none). When absent, every period uses `perPeriod`
 * (previous behavior).
 */
periodTargets?: number[];
```

`scheduleHabit` iterates periods by index and uses
`const target = habit.periodTargets?.[i] ?? habit.perPeriod;` as the per-period
occurrence count. With `periodTargets` absent, behavior is identical to today, so
all existing engine tests stay green.

### Core (`@notreclaim/core`)

In `assembleScheduleInput`, after `expandHabit` produces each engine `Habit`,
compute per-period targets from pinned coverage:

- For period `i`, `pinnedOccurrences[i]` = count of pinned engine blocks with
  `sourceType === 'habit'`, `sourceId === habit.id`, and `start` within
  `[periods[i].start, periods[i].end)`.
- `periodTargets[i] = max(0, perPeriod − pinnedOccurrences[i])`.
- Set `habit.periodTargets` only when at least one period has pinned coverage;
  otherwise leave it undefined (so the common no-pin case uses the `perPeriod`
  path).

This is correct for any `perPeriod`.

## Data flow after the fix

```
detectDrift: move -> pin block, engineKey := null        (Part A)
computeDesiredSchedule / assembleScheduleInput:
  tasks:  durationMs -= pinned task coverage (drop if 0)  (Part B1)
  habits: periodTargets[i] = max(0, perPeriod - pinned occurrences in period i)  (Part B2)
engine: places only the remaining task duration / per-period habit targets
reconcile keyed diff: pinned blocks (engineKey null) excluded; fresh placements
  create cleanly — no collision, no duplicate
```

## Error handling

No new error types. The previously-possible `ConflictError` from the engineKey
collision is eliminated by Part A. Existing `SettingsRequiredError` /
`GoogleApiError` behavior is unchanged.

## Testing (deterministic, DB-free with injected fakes + fixed `now`)

- **Engine (`@notreclaim/scheduler`):** `periodTargets` honored per period; a
  target of 0 places no occurrence in that period; absent `periodTargets` falls
  back to `perPeriod` (existing behavior unchanged).
- **Core task reduction:** a task with a pinned block covering part of its
  duration is placed for only the remainder; a task fully covered by pins is
  dropped (no placement); non-pinned blocks do not reduce the task.
- **Core habit reduction:** a period with `perPeriod` pinned occurrences gets
  target 0 (no fresh placement that period); a partially covered period
  (`perPeriod > 1`) gets the correct reduced target; uncovered periods keep
  `perPeriod`.
- **Google `detectDrift`:** pinning clears `engineKey` (assert the updated block
  has `engineKey === null`).
- **Reconcile end-to-end regression:** a task block that has been pinned (engineKey
  cleared), with the task still pending, produces **no `ConflictError`**, **no
  duplicate** placement (task fully covered → zero creates), and zero spurious
  Google writes on the following re-plan.
- Existing milestone 1 / 3a / 3b-i / 3b-ii tests remain green (the engine change
  is additive; core changes only affect the pinned-coverage paths).
