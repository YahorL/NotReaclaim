# NotReclaim — Review 16c: Started tasks are user-managed (design)

Date: 2026-06-18

## Problem (from systematic debugging)

`POST /schedule/:id/start` pulls a block's start to `round15(now)` keeping its end (the
behaviour the user confirmed they want). When you start a block partway through, it
**shrinks**, dropping the task's coverage — so `afterMutation` reconcile auto-schedules the
freed remainder as a **new tile**. With Review 16b's side-by-side layout, that surprise tile
can land beside/over another block ("the autoscheduler created a task that overlapped another").
Reproduced: a 2h block 17:00–19:00, Started at 18:24 → shrank to 18:30–19:00, and a new
19:00–20:30 (1.5h) auto tile appeared.

(The "disappears on move" symptom was NOT reproducible at the data level — a moved/pinned block
persists — so it's a transient client artifact that becomes moot once the surprise tile is gone.)

## Goal

Pressing **Start** should not conjure surprise/overlapping tiles. **Start's own behaviour is
unchanged** (pull start to `round15(now)`, keep end). Instead: **once a task has a Started block,
the auto-scheduler stops generating/maintaining tiles for it** — the user's started + pinned
blocks become that task's schedule.

## Decision & trade-off

A task with a started block becomes **user-managed**: the engine no longer auto-schedules it.
- Removes the surprise remainder tile entirely (and any overlap it caused), regardless of where
  the engine would have placed it.
- On the next reconcile, that task's stale **auto** blocks (engineKey, future) are cleared
  (they're no longer in the desired schedule); its **started/pinned** blocks remain (pinned).
- Trade-off (accepted): the auto-scheduler won't backfill that task's remaining time afterward —
  the user schedules more manually if they want it. ("You started it, you own it.")

## Non-goals

- No change to `POST /schedule/:id/start` (time behaviour stays).
- No change to the timezone (16a) or overlap-layout (16b) work.
- Not the "skip-time counts as done" variant (considered, rejected: it would inflate a task's
  "time spent" with hours not actually worked).

## Change — `packages/core/src/assemble.ts`

In `assembleScheduleInput`, after loading `blocks`, build the set of task ids that have a
started block, and skip those tasks in the flexible-task loop:

```ts
const startedTaskIds = new Set(
  blocks.filter((b) => b.startedAt != null && b.taskId != null).map((b) => b.taskId as string),
);
// …
for (const t of allTasks) {
  if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
  if (startedTaskIds.has(t.id)) continue; // started → user-managed; engine stops auto-scheduling it
  // …unchanged…
}
```

`blocks` already spans `[epoch, horizonEnd]`, and DB `ScheduledBlock` has `startedAt`/`taskId`,
so no new query. This is the entire functional change; `apply.ts` already deletes a task's
future auto blocks once the task drops out of the desired schedule, and keeps pinned ones.

## Testing

- **`assemble.test.ts`**: a task with a block whose `startedAt != null` is **excluded** from
  `input.tasks` (not auto-scheduled), even though it has remaining duration; a task whose blocks
  are all un-started is still scheduled as before. (Use `makeBlock({ taskId, startedAt: <date> })`.)
- **Server (`schedule.test.ts` or `tasks`/reconcile path)**: after `POST /schedule/:id/start`
  on a task's block, a subsequent reconcile produces **no new auto block** for that task (it's
  excluded), and the started block remains. (Fakes: a task + an auto block; start it; assert the
  reconcile/preview no longer plans that task.)
- Tests per-package. Live-verify via geckodriver: reproduce the original sequence (schedule a
  block spanning now, press Start) → the block shrinks to now→end and **no remainder tile appears**;
  the task's other auto tiles clear.

## Edge cases

- A started task with genuinely-remaining work won't be auto-scheduled until... it stays manual
  (started blocks persist). Accepted per the decision; the user can schedule more or complete it.
- Completed/backlog tasks are already excluded by status — unaffected.
- A task with a started block AND a future pinned block: still excluded from auto-scheduling; both
  its blocks (started + pinned) are kept (pinned/started rows aren't auto-managed).
