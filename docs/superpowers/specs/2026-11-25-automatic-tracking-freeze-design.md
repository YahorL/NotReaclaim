# Automatic Tracking: Keep Tracked Task Time in Place — Design

**Status:** implemented on `fix/b2b-tracking`.
**Scope:** `packages/core`, `packages/google`, `packages/server`, plus one optional field in `packages/scheduler`. No schema, migration or web change.

## 0. Summary

Time tracking has two modes (`Settings.requireStartToTrack`):

| | manual (`true`) | automatic (`false`) |
|---|---|---|
| Spent time (`computeSpentMs`) | finished blocks that were Started | every finished task block |
| `GET /schedule` sweep | deletes past un-started task blocks | none |

Two defects made automatic tracking record nothing for a Google-connected user:

- **B1, a running piece was re-planned under the user.** The engine plans from `now` and knew nothing about an auto piece that was running without having been Started, so every replan slid it forward, or made it jump past the next meeting.
- **B2, a finished piece was moved into the future.** Apply keyed over every stored row, past ones included, and the engine reissued the same key (`task:<id>:0`) for the remainder. The first replan after a piece ended moved that past row to the remainder's slot, so the time done stopped counting and was planned again.

For a polled user (a replan every 5 minutes) every replan landed inside a running piece, so no piece ever finished.

**Measured on a simulated Monday.** One task, working hours 09–17, replans from 08:02:17 every 5 minutes until 17:30.

| Scenario | Before: tracked | Before: Google writes | After: tracked | After: Google writes |
|---|---|---|---|---|
| Automatic, 2 h task, through `reconcile` (drift included) | 0 h | 159 updates; the work ends up on Tuesday | 2 h | none; drift pinned nothing |
| Automatic, 3 h task, meetings 10–11 and 13–14 (core, counting mirror) | 0 h | 62 updates | 3 h | none |
| The same with a 10-minute task buffer | — | — | 3 h | none |
| Automatic, 3 h task, a local user editing 4 times a day | 2 h (1 h lost to B2) | — | 3 h | — |
| Manual, never pressing Start | 0 h | 159 updates | 0 h | 159 updates (unchanged) |

Without the stable keys of §3, the automatic polled day costs 1 insert and 1 delete per piece hand-over (3 h with meetings: 2 inserts, 1 update, 2 deletes).

## 1. The rule

> **Automatic tracking only.** An un-pinned **task** row whose start has passed (`startsAt ≤ now`, running or finished) is the user's record of work:
> - it is never moved or swept by a replan;
> - it gives its engine key up when the engine reissues that key;
> - while it runs (`now < endsAt`) the engine sees it exactly like a pinned block: busy time with the task buffer on both sides, and its full length counts toward the task, so that time is not planned again;
> - once it ends it counts as spent. That part was already true.
>
> **Manual tracking:** nothing changes. Un-started pieces keep sliding until they are Started; past un-started rows are discarded by the sweep.

- **One predicate:** `isFrozenTaskRow(row, now, requireStartToTrack)` in `core/src/spent.ts`, equal to `!requireStartToTrack && taskId != null && !pinned && startsAt ≤ now`. It is used by both assemble and apply, with the same `now` and the same rows (both run inside the per-user lock).
- **Boundaries:**
  - `now == startsAt` freezes the row.
  - `now == endsAt` hands it over from coverage (`end > now`) to spent (`end ≤ now`), with no gap and no double count.
  - No grace window is needed. A piece placed at the 5-minute-rounded `now` begins at most 5 minutes later, and any replan before that sees the same grid start, so it emits the same piece.
- **Pinned rows** keep their own path (they are user-placed).
- **Habit rows** keep R21: a begun habit occurrence is raw busy time, never swept, its day consumed.

## 2. Mechanism

### 2.1 Assemble (`core/src/assemble.ts`)

- **`pinnedBlocks`** = rows that are `pinned` or frozen, with `endsAt > now`. That gives a running frozen piece:
  - busy time with ±`blockBufferMs`;
  - coverage through the existing pinned-coverage loop;
  - an echo in the engine result, and so in `/schedule/preview` and Stats, at its real time.
- **`startedTaskIds`** is unchanged: a task with any Started block is still left to the user.
- **Stable keys** (`firstChunkIndex`), see §3.

### 2.2 Apply (`core/src/apply.ts`)

- **`ApplyScheduleOptions.requireStartToTrack` is required.** An optional field falling back to a mode would let a future caller silently bring the loss back. `planLocally` and `reconcile` pass the user's setting.
- **First loop:** `pinned || isFrozenTaskRow(...)` takes the pinned branch (`pinnedIds` plus `pinnedKeyHolders`). Consequences, with no further code:
  - never matched, so never moved;
  - not in `existingByKey`, so never swept;
  - its engine echo is skipped by row id;
  - **it gives its key up:** when the engine reissues the row's `engineKey`, apply writes `{ engineKey: null }` on the row and then creates the new placement under that key. That write is the only change ever made to a frozen row. Times, title and `pinned` stay as they are.
- **Isolation:** the release and the create sit in one per-row isolation unit.
  - If the release fails, the create is skipped (the unique key would still be held). It is counted as `createFailed`.
  - The release is a DB write with no external call, so it still runs with the circuit open. The create is then skipped and counted, and the next cycle creates it.
- **The pinned pass** keys on `row.pinned`, so frozen rows get no outbound pushes: nothing ever changes their times.
  - **Caveat:** a frozen row that was never mirrored (planned before Google was linked) no longer gets its event attached late.
- **The read now has no upper bound** (`END_OF_TIME`, the year 9999). Rows left beyond a shortened horizon are moved, released or swept like any other. The pinned pass still only looks at rows starting before the horizon end, as before.

### 2.3 Engine (`packages/scheduler`)

- One optional field: `FlexibleTask.firstChunkIndex`. `scheduleTask` numbers pieces `task:<id>:<firstChunkIndex + i>`. Nothing else changed.

## 3. Stable keys

- **The problem:** without them, the first replan after a piece begins renumbers the remainder from 0.
  - The frozen piece gives up `:0`.
  - The remainder is created as a new row under `:0`.
  - The next piece's old `:1` row is swept.
  - Cost: 1 Google insert and 1 delete per hand-over, and the next piece's event id changes.
- **The fix:** assemble sets `firstChunkIndex` = 1 + the highest `task:<that task's id>:<n>` index held by any **frozen** row of the task (running or finished; rows whose key was released hold none). This happens only in automatic mode, where frozen rows exist. The remaining pieces then keep matching their own rows.
- **Result:** a whole polled day makes no Google write.
- **Keys grow over a task's life** (e.g. `task:t1:7`). That is harmless: nothing parses them.
- **Releases are still possible, but rare:**
  - **A key-order inversion**, for example after the user drags a later piece.
  - **A Stopped piece.** It is pinned, so it is not counted for the offset. The remainder then reissues the Stopped piece's key, so that row gives the key up and a new row is created.
  - **Why pinned rows are left out:** counting begun pinned rows too would save that create, but would renumber everything when the user drags a later piece to now.

## 4. Stop, completing a task, and Google (S4)

- **Stop** (`POST /schedule/:id/stop`) already accepted any task block.
  - **Preconditions:** the row exists (404 otherwise) and has a `taskId` (400 otherwise). `startedAt` is not required.
  - **Write:** `endsAt = stopBlockEndMs(start, end, now)` = `min(end, max(round15(now), start + 15 min))`, and `pinned: true`. `startedAt` stays null.
  - **On a frozen piece**, that ends it, pins it (never re-planned) and makes it count as spent once its end passes (automatic mode counts every finished task block).
  - **Tests:** server `schedule.test.ts` covers this, with a real `planLocally` afterwards; google `reconcile-tracking.test.ts` covers it end to end.
- **Completing a task, or moving it to the backlog** (`PATCH /tasks/:id` with `status` `completed` or `backlog`), in automatic mode:
  - It ends **every running block of that task** with Stop's write, frozen and pinned (Started or dragged) pieces alike.
  - It runs after the task update and under the per-user lock, clocked once at arrival (`completedAt` uses the same instant).
  - When a piece was ended it emits `data.changed [schedule, tasks]`, then the usual replan re-plans the freed time.
  - Manual mode is unchanged.
  - **Why backlog too:** the brief's decision says "completing". Backlog also takes the task out of the plan, and a backlogged task's running piece would otherwise stay busy and keep counting. This is a one-line condition, easy to narrow.
- **The lower clamp:** Stop never ends a block before `start + 15 min`.
  - Completing a task in the first 7.5 minutes of a piece therefore leaves a 15-minute piece that ends a little after now.
  - That counts 15 minutes and keeps those minutes busy.
  - The block shows as running until then, exactly like a Stop pressed that early.
  - **Alternative not taken:** deleting the piece when `round15(now) ≤ start`. It needs the Google delete path of `DELETE /schedule/:id` inside the task route.
- **S4: a shortened end never reached Google.** Stop rounds to the nearest quarter, so the new end can already be at or before `now`.
  - **Why it was lost:** the pinned pass skipped every ended row, and drift only reads rows overlapping `[now, horizon]`. The Google event kept its old, later end (stop at 09:37 → 09:30: never pushed; stop at 09:38 → 09:45: pushed).
  - **The fix:** the pinned pass lets an ended pinned row through when it is mirrored and the event observed this cycle still ends after `now`. The usual stamp arbitration and difference check follow.
  - **Pushed once:** after the push the event ends before `now` and drops out of drift's listing.
  - **Never inserted:** an ended row that was never mirrored still gets no event.
  - **Scope:** this covers Stop and the completion path.

## 5. Start

**New rule** (owner decision): `startBlockPatch(startsAt, endsAt, now)` always pins the block and stamps `startedAt = now` (the raw instant). Then:

| Case | Result |
|---|---|
| `now < startsAt` and `round15(now) < startsAt` | The block **moves** to `round15(now)` and keeps its length. This also applies to a block planned for another day. |
| `now < startsAt` but `round15(now) ≥ startsAt` (pressed within 7.5 minutes of a start that is not on the quarter grid, e.g. 09:08 for 09:10) | Its times are kept: Start never pushes a block later than planned. |
| `startsAt ≤ now`, including `now == startsAt` | As before: the start is pulled to `round15(now)` and the end is kept. That shortens the block, or grows it by up to 7.5 minutes when round15 lands before an off-grid start. If `round15(now) ≥ endsAt`, the times are left alone. |
| The moved block overlaps whatever follows | No clamping. The replan plans around a Started block. |

This supersedes the lost-edits design's §3.4 and §10 Q4, which described Start keeping the end.

## 6. Interactions

| Area | Behaviour |
|---|---|
| **Per-user lock** | Assemble and apply evaluate the predicate on the same `now` and rows inside one critical section. The completion path writes under the lock. Stop and Start already did. |
| **Row isolation and circuit** | The key release is DB-only (no external call, never part of the transient streak). Release and create form one unit (see §2.2). Frozen rows add no external calls. |
| **Drift** (`detect-drift.ts`) | For an unpinned row whose Google time differs, Google wins and the row is pinned. A frozen row's event is never rewritten, so it keeps matching the row: the polled day shows 0 drift pins. A Google-side edit of a running piece still pins it at Google's time. A Google-side delete still deletes the row; the time is then not counted and the remainder is re-planned. |
| **Pinned-block mirroring** | Frozen rows are skipped (`row.pinned` is false). Stopped and completed pieces are pinned and pushed, ended or not (S4). |
| **Manual-mode sweep** | Unchanged; it only runs in manual mode, where nothing is frozen. See §7 for what it does after the setting flips. |
| **Habits** | Untouched. The predicate requires `taskId`. Running habits keep the R21 path (raw `fixedEvents`, without the task buffer). `consumedSlotTimes` is habit-only. |
| **Spent time** | A task with frozen auto rows **and** pinned/Started rows counts every finished one in automatic mode, and coverage counts both running kinds. Nothing is planned twice. |
| **Duration shortened below what is done** | The engine gets nothing for that task. Not-yet-begun pieces are swept; frozen pieces stay whole, which can over-count by up to one piece. |
| **Duration lengthened after the pieces are done** | New pieces under new keys past the history's (`task:t1:1` after `:0`). |
| **Task deleted mid-piece** | Rows cascade (schema). Unchanged. Their Google events are orphaned (pre-existing). |
| **Completed-task purge (30 days)** | Cascades the rows. Unchanged. |
| **Stats** (`/schedule/preview`) | The running frozen piece is echoed at its real time. Finished pieces were never in the preview. |
| **Due dates and the unscheduled banner** | Coverage takes the running piece out of `remaining`, so a piece can no longer jump past its deadline while it is being worked on. |
| **Two pieces back to back** | The first is frozen and finished, the second frozen and running. Both keep their keys; no write. |
| **Meeting added on top of a running piece** | The piece stays whole and they overlap (owner decision 3). The full piece counts. |
| **Higher-priority task created mid-piece** | It is planned around the running piece. |
| **Start on the NEXT piece while a frozen one runs** | **Open until the web change in §8 lands.** The next piece moves to now (§5), overlapping the frozen piece, and both count. |
| **Start on a frozen running piece** | The start is pulled to `round15(now)`: the elapsed part stops counting, and the task becomes user-managed. Not reachable from the web once the top bar shows "Now … Stop" for it (§8). |

## 7. Switching the tracking mode

**Off → on (to manual)** is accepted without a schema change (owner decision 6). The web will ask for confirmation. What is lost:

1. **At once, in `spentMs`:** every finished task block without `startedAt` stops counting. That includes frozen auto pieces, pieces ended by Stop or by completing their task, and dragged or drawn (pinned) blocks. Only Started blocks count. The engine re-plans the lost time.
2. **For good, on the first `GET /schedule` in manual mode:** the sweep (`isDiscardableUnstarted`: `taskId && startedAt == null && endsAt ≤ now`, `pinned` not considered) **deletes every one of those rows together with its Google event**. Switching back off cannot bring them back.
   - This was already true before this change, but there was almost no automatically tracked history then.
   - It is pinned by `server/test/schedule.test.ts` ("after switching to manual, the first GET deletes every past un-started task block…").
   - **The sweep is unchanged.** Making it skip rows that ended before the switch needs a `trackingModeChangedAt` column.
3. **A running frozen piece** stops being frozen and slides again at the next replan. One whose key was given up becomes an unpinned key-less row, invisible to planning until it ends, and then swept.

**On → off (to automatic):** past un-started rows that the sweep has not deleted yet start counting and become frozen.

## 8. API contract for the web (not in this batch)

**Top bar "Now … Stop" in automatic mode.** A block is **running** when:
- `settings.requireStartToTrack == false`;
- `taskId != null`;
- `Date.parse(startsAt) ≤ now < Date.parse(endsAt)`.

This holds whatever `pinned` and `startedAt` are; a frozen auto piece has `pinned: false, startedAt: null`. Manual mode keeps today's rule (`startedAt != null && endsAt > now`). "Next" is the earliest task block with `startsAt > now`.

**Stop on it:** `POST /schedule/:id/stop`.
- **Responses:** 200 with the updated row; 404 for an unknown id, or a row removed while the request waited; 400 for a habit block.
- **The row:** `endsAt = min(endsAt, max(round15(now), startsAt + 15 min))`, `pinned: true`, `startedAt` unchanged (null).
- **Timing:** the end may still be a few minutes ahead (rounded up, or the 15-minute floor), so the block stays "running" until then, as after a Stop on a Started block today. A second Stop changes nothing.
- **Effects:** the block counts as spent once it ends, and the replan re-plans the rest of the task after it.

**Completing a task** (`PATCH /tasks/:id {status: 'completed' | 'backlog'}`) does the same to its running blocks in automatic mode. The client can refetch on the `data.changed [schedule, tasks]` it emits.

## 9. Tests

| Package | What |
|---|---|
| `core/test/tracking.test.ts` | Predicate truth table. The B2 and B1 scenarios in both modes: single and multi-piece tasks, zero remainder, boundaries, a meeting on top, a higher-priority task, duration shortened, frozen plus pinned pieces. Polled days with a counting mirror, including a buffer case and manual unchanged. Stable keys. Completion freeing the slot. |
| `core/test/apply.test.ts` | The two pre-existing move/sweep tests made explicitly manual, with automatic twins. Release-then-create as one unit, including with the circuit open. The echo skip. S4 (pushed once; no push for a newer Google edit or an unmirrored row). Rows beyond a shortened horizon. The circuit-open probe extended with an unchanged never-mirrored row. An event-less delete with an empty id passing an open circuit. |
| `core/test/assemble.test.ts` | Running frozen rows become pinned blocks with coverage in automatic mode only (not in manual mode; finished rows never; habit rows never). `firstChunkIndex`. |
| `core/test/block-timer.test.ts` | The Start table of §5. |
| `scheduler/test/items.test.ts` | `firstChunkIndex`. |
| `google/test/reconcile-tracking.test.ts` | A stateful calendar (lists by `timeMin`/`timeMax`) and a range-respecting store with the unique key. The polled day through `reconcile` with drift, in both modes. Stop rounding down and up reaching Google once. |
| `server/test/tasks.test.ts` | Completion and backlog ending running pieces. Manual unchanged. Other patches unchanged. 404. Under the lock. |
| `server/test/schedule.test.ts` | Stop on a frozen piece. The mode-switch sweep characterisation. The early-Start route outcome. |

Existing assertions changed:
- `core/test/apply.test.ts`:
  - "moves a stale past block forward…" now passes `requireStartToTrack: true`; expectation unchanged.
  - "still sweeps a TASK row that has begun…" now passes `requireStartToTrack: true`; expectation unchanged.
  - The circuit-open probe expects `attachFailed: 2` / `attached: 2` (one more row in the fixture).
  - Every other call gained `requireStartToTrack: false`.
- `core/test/block-timer.test.ts`: the signature gained `startsAt`. "a future block is pulled forward to round15(now)" (end kept) is replaced by the move-and-keep-length cases.
- `server/test/schedule.test.ts`: "pulls an upcoming block start…, keeping the end" (`endsAt` 03:00) is now "moves an upcoming block…, keeping its length" (`endsAt` 01:00).
- `server/test/block-route-lock.test.ts`: "Start: clocked at ARRIVAL…" expects `endsAt` 01:15 (was 10:00).

## 10. Open items

- **Web** (§8): the running-piece rule and Stop in the top bar; the mode-switch confirmation (§7). Until the top bar change ships, Start on the next piece double-counts (§6).
- **Owner questions:**
  - Should completion also end running pieces in **manual** mode (a Started block of a completed task keeps counting until its end)?
  - Should completing in the first 7.5 minutes of a piece delete it instead of leaving 15 minutes (§4)?
  - Is "backlog" wanted alongside "completed" (§4)?
- **Known, unchanged:**
  - A frozen row that was never mirrored stays without a Google event.
  - The manual sweep deletes pinned history (§7).
  - Unpinning a key-less row leaves an invisible zombie (lost-edits design §9): any such row in manual mode, and in automatic mode one whose start has not passed yet (once it has, it is frozen and handled).
  - Task deletes orphan Google events.
  - Running habits are not padded by the task buffer (R21 vs R25).
