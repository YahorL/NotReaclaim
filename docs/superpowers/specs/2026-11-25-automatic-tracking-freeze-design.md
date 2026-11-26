# Automatic Tracking: Keep Tracked Task Time in Place — Design

**Status:** implemented on `fix/b2b-tracking`.
**Scope:** `packages/core`, `packages/google`, `packages/server`, one optional field in `packages/scheduler`, and one additive column (`Settings.requireStartSince`, migration `20261125000000_settings_require_start_since`). No web change.

## 0. Summary

Time tracking has two modes (`Settings.requireStartToTrack`):

| | manual (`true`) | automatic (`false`) |
|---|---|---|
| Spent time (`computeSpentMs`) | finished blocks that were Started | every finished task block |
| `GET /schedule` sweep | deletes past un-started task blocks, except history kept from automatic tracking (§7) | none |

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
| Automatic, tasks of 3 h and 2 h, 10-minute buffer, no meetings, through `reconcile` | 5 h | 10 updates; every gap after a finished piece shrank from 10 to 5 minutes | 5 h | none; gaps unchanged (§2.1, trailing buffer) |
| Automatic, 3 h task, a local user editing 4 times a day | 2 h (1 h lost to B2) | — | 3 h | — |
| Manual, never pressing Start | 0 h | 159 updates | 0 h | 159 updates (unchanged) |

Without the stable keys of §3, the automatic polled day costs 1 insert and 1 delete per piece hand-over (3 h with meetings: 2 inserts, 1 update, 2 deletes).

## 1. The rule

> **Automatic tracking.** An un-pinned **task** row whose start has passed (`startsAt ≤ now`, running or finished) is the user's record of work:
> - it is never moved or swept by a replan;
> - it gives its engine key up when the engine reissues that key;
> - while it runs (`now < endsAt`) the engine sees it exactly like a pinned block: busy time with the task buffer on both sides, and its full length counts toward the task, so that time is not planned again; after it ends, its trailing task buffer stays busy until `end + buffer`;
> - once it ends it counts as spent. That part was already true.
>
> **Manual tracking:** un-started pieces keep sliding until they are Started, and past un-started rows are discarded by the sweep — **except history kept from automatic tracking**: an un-pinned task row that ended at or before `Settings.requireStartSince` (the moment manual tracking was last switched on) is frozen the same way, and the sweep keeps every row that ended by then (§7). With `requireStartSince` null nothing changes.

- **One predicate:** `isFrozenTaskRow(row, now, { requireStartToTrack, requireStartSince })` in `core/src/spent.ts`: `taskId != null && !pinned` and, in automatic mode, `startsAt ≤ now`; in manual mode, `requireStartSince != null && endsAt ≤ requireStartSince`. Assemble and apply use it with the same `now` and the same rows, and with ONE settings read taken inside the per-user lock (both replan paths read the settings there and hand them to compute and apply; reconcile's earlier read only sizes drift's listing window). Before, a settings change landing between the pre-lock read and the section gave assemble and apply different modes: switching to automatic created a second piece over the running one (double-counted for good), switching to manual swept it and recreated it under its row id.
- **Boundaries:**
  - `now == startsAt` freezes the row.
  - `now == endsAt` hands it over from coverage (`end > now`) to spent (`end ≤ now`), with no gap and no double count.
  - No grace window is needed. A piece placed at the 5-minute-rounded `now` begins at most 5 minutes later, and any replan before that sees the same grid start, so it emits the same piece.
- **Pinned rows** keep their own path (they are user-placed).
- **A piece ending exactly at `now`** is spent, not busy and not coverage (pinned by a test: a `>=` mutant at the coverage filter counted it twice).
- **Habit rows** keep R21: a begun habit occurrence is raw busy time, never swept, its day consumed.

## 2. Mechanism

### 2.1 Assemble (`core/src/assemble.ts`)

- **`pinnedBlocks`** = rows that are `pinned` or frozen, with `endsAt > now`. That gives a running frozen piece:
  - busy time with ±`blockBufferMs`;
  - coverage through the existing pinned-coverage loop;
  - an echo in the engine result, and so in `/schedule/preview` and Stats, at its real time.
- **`startedTaskIds`** is unchanged: a task with any Started block is still left to the user.
- **Trailing buffer (automatic only):** a frozen or pinned task row with `end ≤ now < end + taskBufferMs` adds `[end, end + buffer)` to the busy set (`task-tail:<id>`). While a piece runs it is busy with ±buffer and the pieces behind it are placed after that buffer; without the tail, a replan in that window saw the time as free and re-planned the next piece from `now`, so back-to-back pieces crept by up to the buffer at every hand-over, each move pushed to Google. Pinned rows are included (a Stopped, completed or dragged piece ends the same way and causes the same creep); manual tracking is left exactly as it was.
- **Stable keys** (`firstChunkIndex`), see §3.

### 2.2 Apply (`core/src/apply.ts`)

- **`ApplyScheduleOptions.requireStartToTrack` and `requireStartSince` are required.** An optional field falling back to a mode would let a future caller silently bring the loss back. `planLocally` and `reconcile` pass the settings they read inside the section.
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
- **The read now has no upper bound** (`END_OF_TIME`, the year 9999). Rows left beyond a shortened horizon are moved, released or swept like any other. The pinned pass still only looks at rows starting before the horizon end, as before. **This is the one change that also applies in manual tracking** with `requireStartSince` null: far-future keyed un-pinned rows are now swept or moved, and a pinned far row only loses a reissued key (which ends the every-cycle unique-key collisions; the reviewer's simulation counted 6,738 of them). Low risk; kept.

### 2.3 Engine (`packages/scheduler`)

- One optional field: `FlexibleTask.firstChunkIndex`. `scheduleTask` numbers pieces `task:<id>:<firstChunkIndex + i>`. Nothing else changed.

## 3. Stable keys

- **The problem:** without them, the first replan after a piece begins renumbers the remainder from 0.
  - The frozen piece gives up `:0`.
  - The remainder is created as a new row under `:0`.
  - The next piece's old `:1` row is swept.
  - Cost: 1 Google insert and 1 delete per hand-over, and the next piece's event id changes.
- **The fix:** assemble sets `firstChunkIndex` = 1 + the highest `task:<that task's id>:<n>` index held by any **frozen** row of the task (running or finished; rows whose key was released hold none). In manual tracking the frozen rows are the kept history, so the first manual replan after the switch does not renumber over it either; with `requireStartSince` null there are none. The remaining pieces then keep matching their own rows.
- **Result:** a whole polled day makes no Google write.
- **Keys grow over a task's life** (e.g. `task:t1:7`). That is harmless: nothing parses them.
- **Releases are still possible, but rare:**
  - **A key-order inversion**, for example after the user drags a later piece.
  - **A Stopped piece.** It is pinned, so it is not counted for the offset. The remainder then reissues the Stopped piece's key, so that row gives the key up and a new row is created.
  - **Why pinned rows are left out:** counting begun pinned rows too would save that create, but would renumber everything when the user drags a later piece to now.

## 4. Stop, ending running pieces, and Google (S4)

- **Stop** (`POST /schedule/:id/stop`) already accepted any task block. Unchanged by this design.
  - **Preconditions:** the row exists (404 otherwise) and has a `taskId` (400 otherwise). `startedAt` is not required.
  - **Write:** `endsAt = stopBlockEndMs(start, end, now)` = `min(end, max(round15(now), start + 15 min))`, and `pinned: true`. `startedAt` stays null.
  - **On a frozen piece**, that ends it, pins it (never re-planned) and makes it count as spent once its end passes (automatic mode counts every finished task block).
- **Ending running pieces** (`server/src/running-pieces.ts`, `endRunningPiecesUnderLock`), used by the two paths below, under the per-user lock and clocked once at arrival:
  - a piece that ran **7.5 minutes or more** gets Stop's write (end at `stopBlockEndMs`, pinned);
  - a piece begun **less than 7.5 minutes ago** (where Stop's floor would leave a 15-minute block ending in the future and counting 15 minutes) is **deleted**, row and Google event, with the same token handling as `DELETE /schedule/:id`: no read or token lookup happens before the lock; if a piece to delete turns out to have an event and no token was passed, the section returns without writing, the token is looked up outside the lock, and the section runs once more. Boundaries: 7 min 29 s → deleted; 7 min 30 s → a 15-minute block (`round15` rounds half up).
  - **Elapsed is measured from when the user began** (`beganAt`): for a Started block whose `startedAt` lies within the snapping distance of its start (`startedAt ≥ startsAt − 7.5 min`), from the EARLIER of `startedAt` and `startsAt`; for any other block (never Started, or Started long ago and dragged since), from `startsAt`. (Taking `startedAt` when it was the later one deleted real work: Start at 09:07 on a block begun at 09:00, completed at 09:14, measured 7 minutes; now 14, kept as 09:00–09:15. Likewise a Started block dragged earlier.) Start snaps to the nearest quarter, so a block Started at 09:08 runs from 09:15: completing its task at 09:22 used to measure 7 minutes and delete 14 minutes of work; it now ends it at 09:30 (Stop's write, 15 minutes counted). Started at 09:08 and completed at 09:10: deleted. A Started block dragged to begin in 5 minutes, completed now: measured from its start, not begun, deleted with its event.
  - The explicit Stop route keeps its 15-minute floor (owner decision O3).
- **Completing, backlogging or archiving a task** (`PATCH /tasks/:id` with `status` `completed`, `backlog` or `archived`) ends its running pieces, after the task update:
  - **automatic tracking:** every running piece of the task (frozen or pinned);
  - **manual tracking** (owner decision O2): the pinned (Started, or dragged) running pieces; an un-started piece never counted and is swept by the replan anyway;
  - "running" includes a Started block whose start Start snapped up to 7.5 minutes ahead (Start at 09:08 → 09:15, task completed at 09:10): it is short, so it is deleted;
  - it emits `data.changed [schedule, tasks]` when a piece changed, then the usual replan re-plans the freed time.
- **Start ends the other running blocks** (automatic tracking only; review finding R1 and owner decision F2): `POST /schedule/:id/start` ends every OTHER running task block of the user that was **never Started**, auto-placed or hand-placed (pinned: dragged, created on the planner, dropped from the task panel), any task (one thing is worked on at a time), in the same locked section, before the Start write. A hand-placed block is **never deleted** by this path: young or not, it ends where the Started block begins. Only auto pieces are deleted when begun under 7.5 minutes ago.
  - **Start at the exact minute** (owner decision B2c, replacing "left as it is"): when at least one such running hand-placed block begins at or after the Started block's snapped start (round15(now), after the recent-end clamp of §5), ending it there would leave it no length, and it used to be left whole next to the Started block, both counting (hand-placed 09:15–10:15, Start at 09:17 on another block → 09:15–10:15: 120 minutes for 62 of work). The Started block then begins at the **exact minute** instead (`exactStartMs`, `core/src/block-timer.ts`), keeping its length (early Start) or its end (begun), and every running block begun before that start, hand-placed or auto, ends **exactly** there (no gap where Stop's arithmetic would round down to the quarter): 09:15–09:17 and 09:17–10:17. Nothing is deleted that would not have been before.
    - **The exact start** is `now` truncated to the whole minute (times without seconds) when every such block began before that minute; when one began within the current minute (Start at 09:15:40 on a block begun at 09:15), the raw instant `now`, seconds and all. The recent-end clamp applies on top (the start is the later of the two), and in the triggered case it never binds: such a block begins at or after the clamped start, and the exact start is after it.
    - **Residual:** a hand-placed block that began at this very instant (`startsAt == now`) cannot be cut: it is left whole, and when it is the only one Start keeps round15 as before. The same holds when the exact start would be at or after the end of a begun Started block (Start on a block that has already ended): Start keeps round15.
    - **Unchanged:** manual tracking; automatic Starts with no such block (round15); auto pieces never trigger it (a young one is deleted as before).
    - **Off-grid times downstream:** the engine already takes arbitrary busy times (the 5-minute alignment rounds an auto start up to :x0/:x5 when it still fits, else keeps the exact start); Stop on the Started block later gives `min(end, max(round15(now), start + 15 min))`, still at least 15 minutes long; its `beganAt` is its start (Start's press lies within the snapping distance); a second press is held at the exact start by the clamp on the cut block's new end; the cut block's shortened end reaches Google through the S4 pinned pass, once. The web already renders arbitrary times (Google-side drags are off-grid too).
    - The same rule cuts a never-Started block that an explicit Stop pinned and whose 15-minute-floor end is still ahead (auto 09:15–10:15 stopped at 09:16 → 09:15–09:30; Start at 09:17 → 09:15–09:17, was left whole). Before, the piece the user moved on from stayed frozen whole next to the Started one: a 2 h task, Start on the second piece at 09:30, counted 120 minutes for 90 of work. An ended piece also never runs past the started block's new start: with a piece begun at 10:10 and Start at 10:19 (the started block moves to 10:15), Stop's floor alone would end it at 10:25 and 10 minutes would count twice; it ends at 10:15. Running blocks that were Started earlier are left alone (both modes). Manual tracking: Start writes only the started block, as before.
- **S4: a shortened end never reached Google.** Stop rounds to the nearest quarter, so the new end can already be at or before `now`.
  - **Why it was lost:** the pinned pass skipped every ended row, and drift only reads rows overlapping `[now, horizon]`. The Google event kept its old, later end (stop at 09:37 → 09:30: never pushed; stop at 09:38 → 09:45: pushed).
  - **The fix:** the pinned pass lets an ended pinned row through when it is mirrored and the event observed this cycle still ends after `now`. The usual stamp arbitration and difference check follow.
  - **Pushed once:** after the push the event ends before `now` and drops out of drift's listing.
  - **Never inserted:** an ended row that was never mirrored still gets no event.
  - **Scope:** this covers Stop, the completion path and the pieces Start ends.

## 5. Start

**New rule** (owner decision): `startBlockPatch(startsAt, endsAt, now)` always pins the block and stamps `startedAt = now` (the raw instant). Then:

| Case | Result |
|---|---|
| `now < startsAt` and `round15(now) < startsAt` | The block **moves** to `round15(now)` and keeps its length. This also applies to a block planned for another day. |
| `now < startsAt` but `round15(now) ≥ startsAt` (pressed within 7.5 minutes of a start that is not on the quarter grid, e.g. 09:08 for 09:10) | Its times are kept: Start never pushes a block later than planned. |
| `startsAt ≤ now`, including `now == startsAt` | As before: the start is pulled to `round15(now)` and the end is kept. That shortens the block, or grows it by up to 7.5 minutes when round15 lands before an off-grid start. If `round15(now) ≥ endsAt`, the times are left alone. |
| The moved block overlaps whatever follows | No clamping. The replan plans around a Started block. |
| The new start would lie before the end of a block that ended a moment ago (both modes) | When Start moves a start EARLIER (either branch), it is raised to the latest end, in `(new start, now]`, of the user's other task blocks that count as spent — every one in automatic tracking, the Started ones in manual tracking (an un-started one never counts and is about to be swept, so it does not hold the start back) — never past the block's own start. The early branch keeps the length, the begun branch the end; capped at the block's own start, the clamp cannot empty a block. Example (10-minute buffer): 11:20–12:20 ended, Start at 12:21 on 12:30–13:30 → 12:20–13:20 (was 12:15–13:15: 5 minutes counted twice). The route passes the ends of the blocks that ended in the last 7.5 minutes (`recentEnds`). |
| Automatic tracking: another running hand-placed, never-Started block begins at or after the new start | The candidate start is the exact minute instead of `round15(now)` (`startBlockPatch`'s `from`, chosen by `exactStartMs`, §4), in both branches and under the same clamp. |

This supersedes the lost-edits design's §3.4 and §10 Q4, which described Start keeping the end.

## 6. Interactions

| Area | Behaviour |
|---|---|
| **Per-user lock** | Assemble and apply evaluate the predicate on the same `now`, rows and settings read inside one critical section. Ending running pieces (completion, Start) writes under the lock; Google token lookups never run under it. |
| **Row isolation and circuit** | The key release is DB-only (no external call, never part of the transient streak). Release and create form one unit (see §2.2). Frozen rows add no external calls. |
| **Drift** (`detect-drift.ts`) | For an unpinned row whose Google time differs, Google wins and the row is pinned. A frozen row's event is never rewritten, so it keeps matching the row: the polled day shows 0 drift pins. A Google-side edit of a running piece still pins it at Google's time. A Google-side delete of a running piece's event still deletes the row; the time is then not counted and the remainder is re-planned. Drift only reads rows overlapping `[now, horizon]`, so a Google-side delete of a FINISHED piece's (or kept history's) event leaves the row in place — pre-existing. |
| **Pinned-block mirroring** | Frozen rows are skipped (`row.pinned` is false). Stopped and completed pieces are pinned and pushed, ended or not (S4). |
| **Manual-mode sweep** | Keeps history that ended by `requireStartSince` (§7); otherwise unchanged. |
| **Habits** | Untouched. The predicate requires `taskId`. Running habits keep the R21 path (raw `fixedEvents`, without the task buffer). `consumedSlotTimes` is habit-only. Residual (not fixed, a different mechanism from the trailing-buffer creep): when a habit occurrence BEGINS it becomes raw busy time without its ±buffer, so the task pieces placed after its buffer move up to its end at the next replan (probe: habit 10:00–10:30 with a 10-minute buffer, pieces 10:40 / 11:50 / 13:00 → 10:30 / 11:40 / 12:50, three updates at 10:00). It happens in both modes; fixing it means giving begun habits ±buffer and a tail, which would change manual tracking. |
| **Spent time** | A task with frozen auto rows **and** pinned/Started rows counts every finished one in automatic mode, and coverage counts both running kinds. Nothing is planned twice. |
| **Duration shortened below what is done** | The engine gets nothing for that task. Not-yet-begun pieces are swept; frozen pieces stay whole, which can over-count by up to one piece. |
| **Duration lengthened after the pieces are done** | New pieces under new keys past the history's (`task:t1:1` after `:0`). |
| **Task deleted mid-piece** | Rows cascade (schema). Unchanged. Their Google events are orphaned (pre-existing). |
| **Completed-task purge (30 days)** | Cascades the rows, kept history included. Unchanged. |
| **Stats** (`/schedule/preview`) | The running frozen piece is echoed at its real time. Finished pieces were never in the preview. |
| **Due dates and the unscheduled banner** | Coverage takes the running piece out of `remaining`, so a piece can no longer jump past its deadline while it is being worked on. |
| **Task renamed while a piece runs** | The running (and every finished) piece keeps its old title, in the DB and on Google: titles only travel through the keyed diff, which never matches a frozen row. Before, the sliding piece picked up the new title. Pinned by a test; not changed. |
| **First replan after deploy** | Rows left by the old code can have a past row holding a higher key than a future one (B2 recycled `:0` forward and kept `:1` as history). The offset then numbers the remainder after the past key, so such a future row is swept and its time re-created under new keys: a one-time Google delete plus insert per affected future piece, settled in one cycle. |
| **Two pieces back to back** | The first is frozen and finished, the second frozen and running. Both keep their keys; no write. |
| **Meeting added on top of a running piece** | The piece stays whole and they overlap (owner decision 3). The full piece counts. |
| **Higher-priority task created mid-piece** | It is planned around the running piece. |
| **Start on the NEXT piece while a frozen one runs** | The running piece is ended where the Started block begins (§4). No double count, with or without the web change. |
| **Start on a frozen running piece** | The start is pulled to `round15(now)`: the elapsed part stops counting, and the task becomes user-managed. Not reachable from the web once the top bar shows "Now … Stop" for it (§8). |

## 7. Switching the tracking mode

**Off → on (to manual)** — owner decision O1: history is kept, it merely stops counting.

- **Storage:** `Settings.requireStartSince TIMESTAMPTZ NULL`, migration `20261125000000_settings_require_start_since` (one additive nullable column, no default, no backfill).
- **Transitions** (`server/src/settings-routes.ts`, the only writers of the setting; `ensureUserDefaults` and the admin CLI never set it): on `PUT`/`PATCH /settings`, on the server clock, read and written under the per-user lock, and always written as a pair (on → on writes back the timestamp it read). Before, a save keeping manual tracking on that read "on" before a concurrent switch off and wrote after it left manual tracking on with a NULL timestamp, and the next `GET /schedule` swept all kept history. The lock is what makes it correct: it makes the read-modify-write atomic within the one server process (like every other user write). The pair write alone only keeps the timestamp non-null; without the lock it can be STALE — a save read at "on since 08:00", held while the user switches off and back on at 13:00, would write 08:00 back, and the sweep would then delete rows that ended in (08:00, 13:00]. Tests pin the lock on PUT and on PATCH, and the pair write, each on its own. Cost: a settings save waits for an in-flight replan's compute + apply, like a block edit.
  - false (or no settings row yet) → true: set to now;
  - true → true: unchanged (the settings form re-sends every field on save);
  - → false: cleared (it means nothing in automatic mode, and the next switch on sets it afresh);
  - not sent: unchanged.
  - Never taken from the client (the request schemas strip it) and never returned (the three settings responses drop it).
- **Meaning of null:** in automatic mode, irrelevant. In manual mode, "on since before the column existed": nothing is kept, the sweep and the replans behave exactly as before.
- **What is kept:** task blocks that ENDED at or before the timestamp, pinned or not — in the database, the planner and Google. While manual tracking is on they do not count as spent (only Started blocks count, as before) and are never busy (they have ended).
  - **The sweep** (`isDiscardableUnstarted(b, now, requireStartSince)`) keeps every row that ended at or before it, pinned or not; never-Started rows ending after it are discarded as before (a row ending 1 ms after the switch is discarded; one ending exactly at it is kept).
  - **Replans** in manual mode would otherwise recycle kept rows: the engine numbers the task from `:0` again and apply would MOVE the past row holding that key, with its Google event, to the remainder's future slot. An un-pinned kept row is therefore frozen (`isFrozenTaskRow`): never moved or swept, its key released when reissued (and, through stable keys, usually not reissued at all), never mirrored again (it is not pinned). Pinned kept rows already had that protection.
- **Switched on while a piece runs:** that piece ends after the switch, so it is an ordinary manual-mode un-Started block: it slides at the next replan and, once past, is discarded. Likewise a Stop rounded UP past the switch (stopped at 10:38 → ends 10:45, switched on at 10:40) is not kept.
- **On, off, on:** each switch on takes a new timestamp; rows that ended by the latest one are kept.
- **On → off (to automatic):** the kept rows are past task blocks, so they count again and stay frozen. Past un-started rows the sweep has not deleted yet start counting too.
- **Null equivalence:** with `requireStartSince` null the manual-mode predicate is false for every row and the sweep rule reduces to the old one. Rerunning the reviewer's 30-world manual-mode simulation (`diff.mjs`, fresh traces from the pre-batch `base` and from this branch, no `EXTRA`) gave byte-identical traces (28,558 lines). The sweep's null case keeps its old characterisation test.
- **Rollback:** the previous code works against the migrated database: its Prisma client names its columns, so reads, `upsert` (insert/update of named columns) and `updateMany` on Settings never touch the extra nullable column. But the previous code sweeps and recycles kept history again, and a setting toggled by it leaves the timestamp stale (it is neither set nor cleared); after rolling forward, a stale non-null timestamp keeps history up to that old moment.

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

**Completing, backlogging or archiving a task** (`PATCH /tasks/:id {status}`) ends its running blocks (§4: all of them in automatic mode, the pinned ones in manual mode; deleted when begun under 7.5 minutes ago). The client can refetch on the `data.changed [schedule, tasks]` it emits.

**Start** (`POST /schedule/:id/start`) in automatic mode also ends the other running task blocks that were never Started (auto pieces begun under 7.5 minutes ago are deleted; hand-placed blocks never are), and in both modes never moves the block back over a block that has just ended and counts; the response is the started row only, so the client refetches the schedule (it already does on `data.changed`). The started row's start, and the ended blocks' ends, can be off the quarter grid (the exact minute, §4; seconds only when pressed within the minute a hand-placed block began).

**Mode-switch confirmation** (switching "Require Start to track" on): "Time tracked automatically so far is kept on the calendar but will no longer count as time spent while Require Start is on." The settings responses do not carry `requireStartSince`.

## 9. Tests

| Package | What |
|---|---|
| `core/test/tracking.test.ts` | Predicate truth table (both modes, kept-history boundaries). The legacy key layout, a rename mid-piece, the deadline warning. The B2 and B1 scenarios in both modes. Polled days with a counting mirror. Stable keys. Completion freeing the slot. Kept history across a switch to manual and back; null timestamp unchanged; a switch while a piece runs. |
| `core/test/apply.test.ts` | The two pre-existing move/sweep tests made explicitly manual, with automatic twins. Release-then-create as one unit. The echo skip. S4. Rows beyond a shortened horizon. The circuit-open probe. An event-less delete passing an open circuit. |
| `core/test/assemble.test.ts` | Running frozen rows as pinned blocks, automatic only. `firstChunkIndex`. A piece ending exactly at `now`. The trailing buffer (automatic only, pinned included, not habits). |
| `core/test/plan-locally-exclusive.test.ts` | One settings read, inside the section; a mode switch landing while the replan waits, both directions. |
| `core/test/spent.test.ts`, `block-timer.test.ts` | The sweep rule with a timestamp; the Start table of §5; `startBlockPatch` from an exact start (both branches, the clamp on top, an already-ended block) and `exactStartMs` (minute truncation, same-minute raw instant, same-instant null). |
| `scheduler/test/items.test.ts` | `firstChunkIndex`. |
| `db/test/repositories/settings-repository.test.ts` | `requireStartSince` defaults to null, is set and cleared, and is kept when not sent. |
| `google/test/reconcile-tracking.test.ts` | A stateful calendar and a range-respecting store with the unique key. The polled day through `reconcile` in both modes; with two tasks and a 10-minute buffer. Stop rounding down and up reaching Google once. Start ending the running piece reaching Google; at the exact minute, the cut hand-placed block and the off-grid Started block reaching Google once. A mode switch during drift, both directions. Kept history through manual polls. |
| `server/test/tasks.test.ts` | Completion, backlog and archive in both modes; 7 min 29 s / 7 min 30 s / well past; the token looked up outside the lock, and the retry when a piece became mirrored. 404. Under the lock. |
| `server/test/schedule.test.ts` | Stop on a frozen piece. Start ending other running pieces (the reviewer's probe, two tasks, off-grid, twice, short piece, manual, habit 400). Start at the exact minute (§4): T4f2 early and begun, seconds truncated, pressed within the minute H began, two hand-placed blocks, one begun before the snapped start, with an auto piece (tracked == wall time) and a short one, with the clamp, a Stop-pinned block, twice, the already-ended fallback, auto pieces not triggering it, on-grid and manual unchanged, the same-instant residual. The sweep with and without a timestamp. The early-Start route outcome. |
| `server/test/settings.test.ts` | The `requireStartSince` transitions; on/off/on; never from or to the client. |

Existing assertions changed:
- `core/test/apply.test.ts`:
  - "moves a stale past block forward…" and "still sweeps a TASK row that has begun…" now pass `requireStartToTrack: true`; expectations unchanged.
  - The circuit-open probe expects `attachFailed: 2` / `attached: 2` (one more row in the fixture).
  - Every other call gained `requireStartToTrack: false, requireStartSince: null`.
- `core/test/block-timer.test.ts`: the signature gained `startsAt`; "a future block is pulled forward to round15(now)" (end kept) is replaced by the move-and-keep-length cases.
- `core/test/plan-locally-exclusive.test.ts`: "…the settings read outside" now expects no read before the section and exactly one inside.
- `core/test/spent.test.ts`: `isDiscardableUnstarted` takes the timestamp; the existing cases pass `null`, expectations unchanged.
- `server/test/schedule.test.ts`: "pulls an upcoming block start…, keeping the end" (`endsAt` 03:00) is now "moves an upcoming block…, keeping its length" (`endsAt` 01:00). The mode-switch characterisation ("the first GET deletes every past un-started task block…") became the null-timestamp case beside the kept-history case.
- `server/test/block-route-lock.test.ts`: "Start: clocked at ARRIVAL…" expects `endsAt` 01:15 (was 10:00).
- `server/test/write-order.test.ts`: "Start reads the clock ONCE…" traces two more reads under the lock before the Start write (`blocks.listByUserInRange` twice: the blocks that ended in the last 7.5 minutes, then the other running pieces).
- `server/test/tasks.test.ts` (this branch's own): "manual tracking: unchanged, the running pieces keep their planned end" became "manual tracking, %s: the Started running piece ends too…" (O2).
- `server/test/schedule.test.ts` (B2c): "a hand-placed block that begins where (or after) the Started block begins is left untouched" became "residual: a hand-placed block that began at this very instant is left untouched…": the same fixture (begins at `now`, 09:30), expectation unchanged, plus the Started block's 09:30–10:30. The case it described for a block beginning AFTER the snapped start now cuts it (the new tests).

## 10. Open items

- **Web** (§8): the running-piece rule and Stop in the top bar; the mode-switch confirmation text (§7, §8).
- **Known, unchanged:**
  - A task renamed mid-piece leaves the frozen pieces with the old title (§6).
  - A frozen row that was never mirrored stays without a Google event.
  - A begun habit loses its task buffer (R21), so pieces behind it move up once (§6).
  - A Google-side delete of a finished piece's event leaves the row (drift reads `[now, horizon]` only).
  - Unpinning a key-less row leaves an invisible zombie (lost-edits design §9): any such row in manual mode outside kept history, and in automatic mode one whose start has not passed yet.
  - Task deletes orphan Google events.
- **Known limits of ending running blocks:**
  - ~~A hand-placed, never-Started block that begins at or after the Started block's new start is left untouched~~ — **fixed by B2c, "Start at the exact minute" (§4)**: the Started block begins at the exact minute and that block ends there (hand-placed 09:15–10:15, Start at 09:17 on another block → 09:15–09:17 and 09:17–10:17: 62 minutes for 62, was 120). **Residual:** a hand-placed block that began at this very instant (`startsAt == now`, e.g. hand-placed 09:30–10:30, Start at exactly 09:30:00.000) has no length to keep: it is left whole and the Started block keeps round15, so its overlap with the Started block counts twice, as before. The exact minute is used in that case only.
  - Stop's 15-minute floor can leave an end in the future that the next Start overlaps, when that block was **Started** (Start leaves Started blocks alone): a block Started at 09:08 (→ 09:15) and its task completed at 09:16 leaves 09:15–09:30; Start on t2 at 09:17 moves it to 09:15 → 15 minutes counted twice (the clamp only sees blocks that have already ENDED). The explicit-Stop variant predates this batch: Start at 10:00, Stop at 10:02 → ends 10:15; Start another at 10:03 → it begins 10:00. A **never-Started** block in that position is now cut by B2c (§4).
  - Pre-existing: Start on a block that has already begun moves its start LATER to round15(now), dropping time that was counting in automatic mode (auto 09:00–10:00, Start at 09:52 → 09:45–10:00: 45 minutes stop counting); re-Starting a running Started block through the API drops its elapsed part the same way.
- **Completion is not atomic** (`PATCH /tasks/:id`): the task is updated first and its running pieces ended second. If ending them throws, the task is already completed and the reply is a 500; repeating the request is safe (it ends the pieces then).
- **For the owner:**
  - After switching to manual, never-Started rows created DURING the manual interval that neither the sweep nor a replan touched (no `GET /schedule` and no replan before they ended) count again after switching back to automatic.
  - `GET /schedule` reads the settings before taking the lock and its sweep does not re-read them: a switch to automatic racing a GET can still delete rows that now count.
