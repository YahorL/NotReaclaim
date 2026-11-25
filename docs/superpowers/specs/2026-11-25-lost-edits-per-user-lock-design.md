# Lost Block Edits — Per-User Lock — Design

**Status:** implemented on `fix/b2a-lost-edits` (owner decisions: "fix it; edits wait their turn" for the lock, F7 "isolate failures" for the diff loop).
**Scope:** `packages/server`, `packages/core`, `packages/google`. No scheduler, schema, migration, repository-interface or web change.

Evidence labels: **[R]** verified by reading the code, **[E]** verified by a read-only experiment, **[I]** inferred (mostly Google API behaviour and timing).

## 0. Summary

- A planner edit made while a background replan was running could be silently and permanently undone **[R]**. A replan reads the stored blocks once, then writes one row at a time with awaited Google calls in between (seconds, for a Google-connected user). The block routes were not serialised with it, so a replan that read the old state could move a just-dragged block back, delete it, or push its old time to Google, which the next cycle then re-imported as a "Google edit".
- **Fix (option A′):** one per-user in-process FIFO lock (`server/src/user-lock.ts`), held around **compute + apply** in both replan paths and around each block route's read-modify-write. An edit that arrives mid-replan **waits** for the apply to finish and lands on top of its result. Token refresh, the Auto-scheduled calendar check and drift detection stay outside the lock.
- **Second change (F7):** a row that fails to save in apply's diff loop is skipped and counted instead of aborting the user's whole replan. Connection-level Google failures still abort.
- Remaining caveats: host-vs-Google clock skew inside drift's arbitration (§5), a true two-sided conflict (same event edited in the app and in Google at the same moment, window W1), and writers still outside the lock (task/habit cascades, drift, the inbound calendar sync; §8, §9).

## 1. Mechanism

### 1.1 Who runs a replan

- `afterMutation` (`app.ts`) fires `replanAfterMutation` (`replan.ts`) without awaiting it → `AppDeps.replan` = `makeReplan` (`replan-router.ts`): Google `reconcile` when connected, else core `planLocally`, serialised per user with one coalesced follow-up run (`replan-queue.ts` `serialisePerUser`).
- `POST /schedule/replan` awaits the same `replan`.
- The poller (`poller.ts`, `pollAndReplan` in `replan.ts`) runs the inbound calendar sync **outside** the queue, then the same `replan`.
- Block writers outside any replan: `POST /schedule` (pin), `PATCH /schedule/:id` (drag / resize / unpin), `POST /schedule/:id/start`, `/stop`, `DELETE /schedule/:id` (no follow-up replan), and the manual-mode sweep in `GET /schedule` (`manual-sweep.ts`, no follow-up replan).

### 1.2 What a replan reads, and when [R]

Google user (`google/src/reconcile.ts`):
1. `getAccessToken`, then `ensureAutoScheduledCalendar` (a Google call only on first link).
2. `detectDrift` (`detect-drift.ts`): paged Google listing, **read #1** of rows in `[now, horizon]`, then its writes (D1, D2).
3. `computeDesiredSchedule` → `assembleScheduleInput` (`core/src/assemble.ts`): **read #2**, all rows `[0, horizon]`.
4. `applyDesiredSchedule` (`core/src/apply.ts`): **read #3** (`existing`), then the writes below, sequentially, each Google call awaited before its DB write.

Local user (`planLocally`, `core/src/apply.ts`): read #2, then read #3 + writes. No Google call.

### 1.3 Every replan write to `ScheduledBlock` [R]

| # | Site | Writes | Decided from | Google call and order |
|---|---|---|---|---|
| D1 | `detectDrift`, missing/cancelled event | delete row | read #1 + listing | none |
| D2 | `detectDrift`, `googleWins` | times, `pinned: true`, `engineKey: null` | read #1 + listing; unpinned → Google wins; pinned → only if `event.updated > row.updatedAt` | none |
| A1 | apply, changed keyed row | `mirror.update` (PUT, or insert if unmirrored), then `update {startsAt, endsAt, title}` | read #3 `match` vs desired (read #2) | Google first |
| A2 | apply, `storeInsertedIds` | ids (with the move, if any) | read #3 | Google first; NotFound → compensating event delete |
| A3 | apply, pinned key holder | `update {engineKey: null}` | read #3 | none |
| A4 | apply, new key | `mirror.create`, then `create` | key not in read #3 | Google first |
| A5 | apply, sweep | `mirror.delete`, then `delete` | read #3, key unseen, `endsAt > now`, not a begun habit | Google first |
| A6 | apply, pinned pass, unmirrored | insert, store ids | read #3 | per-row isolated |
| A7 | apply, pinned pass | **Google only**: push the pinned row's read-#3 times/title | read #3 vs `observed` (drift's listing) | per-row isolated; no DB write |

The sweep (A5) and the pinned pass (A6/A7) iterate only rows from read #3, so a row created after it is never touched. `reconcile` and `sync.ts` have no `ScheduledBlock` write of their own. Every update goes through `updateMany`, which bumps `@updatedAt` **[E]**, and stored stamps round-trip exactly through a JS `Date` (no sub-millisecond digits on the dev DB **[E]**).

### 1.4 Windows

For one replan R and one user write U to block B:

| Window | U commits… | Effect |
|---|---|---|
| W0 | before drift's read #1 | no race |
| W1 | between read #1 and drift's write for B | matters only if B's event was **also** edited in Google (two-sided conflict) |
| W2 | between read #2 and read #3 | stale `desired`, fresh `existing`: transient duplicates and ghosts |
| **W3** | between read #3 and R's write for B | **stale writes: the lossy window** |
| W4 | after R's write for B | no race |

W3 for a Google user is one Google round trip per changed, created or swept row before B (≈0.2–0.3 s each **[I]**): seconds after a reshuffle, tens of seconds on the first reconcile after linking.

## 2. Failure analysis (before the fix)

**LOSSY** (the edit is permanently gone or rewritten):
1. Drag/resize of an auto block in W3 while the engine moves or renames its key: A1 writes the engine position, and the PATCH had set `pinned: true`, so the block is frozen at a spot the user never chose.
2. The same while the engine drops the key: A5 deletes the block and its event.
3. Start on an auto block in W3: A1 moves the running block to the engine's slot (spent time then computed from the wrong interval; started tasks are excluded from planning, so it is cemented), or A5 deletes it and the Start is lost.
4. A second edit (drag, resize, Start, Stop) of a pinned block during the replan triggered by the first edit of the same block: A7 pushes the previous times; if Google stamps that push after the user's commit, the next cycle's drift reads it as a Google-side edit (D2) and writes the old times back.
5. Start/Stop computing from a stale route-side `findById` (the route read, then a replan moved the row, then the route wrote): e.g. a block spanning from now to the engine's new end tomorrow.

**Self-healing** (via the follow-up replan R′, or the next poll/mutation): every W2 case (duplicate auto rows; ghost rows keyed by a deleted/unpinned row's uuid), W3 with unchanged desired, unmirrored inserts (A2/A6), POST pin, unpin.

**ABORT** (apply throws part-way; the rest of the run and `schedule.updated` are skipped): DELETE and the manual sweep racing A1/A5. DELETE and the sweep enqueue no R′, and local users have no poll. A PUT to an event the route just deleted might resurrect it as an orphan **[I]**.

**DELETE 404 race:** drift's D1 could delete the row between the route's Google delete and its DB delete, so a successful delete answered 404 and the optimistic UI rolled back.

## 3. Decision: option A′ (narrow per-user lock)

### 3.1 Why

- It is the only option that **closes** both loss mechanisms (DB overwrite and stale Google push), because it removes the interleaving instead of detecting it after a Google call has already happened.
- Smallest change: `applyDesiredSchedule`'s logic untouched by the lock, no schema, scheduler or repository-interface change.
- Cost: an edit's reply can wait for the rest of an in-flight compute + apply. Near zero in steady state (apply makes no Google writes when nothing changed); noticeable after a large reshuffle; tens of seconds on the first reconcile after linking **[I, rare]**. Owner decision: edits simply wait (no fail-fast, no timeout of their own). Each Google request already times out after 15 s (`google-client.ts`), which bounds how long one call inside the lock can hang.
- Single process only, exactly like the existing replan queue. A cross-process version would need a Postgres advisory lock (session locks fight Prisma's pool; `pg_advisory_xact_lock` would hold a transaction across Google calls). Not worth it before a second server process exists.

### 3.2 As built

- `server/src/user-lock.ts`: `createUserLock()` returns `withUserLock(userId, fn)`, a FIFO mutex per user. Users never block each other; a rejected `fn` releases the lock and rejects only its caller; the map entry is dropped when idle (`held()` for tests). Not re-entrant.
- `core`: `Exclusive = <T>(fn: () => Promise<T>) => Promise<T>`; `planLocally(repos, blocks, userId, now, exclusive = run directly)` reads settings outside, then runs `computeDesiredSchedule` + `applyDesiredSchedule` inside `exclusive`.
- `google`: `ReconcileDeps.exclusive?`; `reconcile` runs token refresh, `ensureAutoScheduledCalendar`, `detectDrift` and the mirror construction outside, compute + apply inside.
- `server.ts`: one `createUserLock()`; both `reconcileBound` and `planLocallyBound` get `exclusive: (fn) => userLock(userId, fn)`; the app gets it as the required `AppDeps.withUserLock`. `test/fakes.ts` `buildTestApp` uses a real lock by default and returns it.
- Routes (`schedule-routes.ts`), each releasing the lock before `data.changed` and `afterMutation`:
  - `POST /schedule`: task lookup outside; `create` inside.
  - `PATCH /schedule/:id`: `update` inside.
  - Start/Stop: `now = deps.now()` read at **arrival**; `findById` + compute (`startBlockPatch` / `stopBlockEndMs`) + `update` inside. 404/400 decided inside, replied after.
  - `DELETE /schedule/:id`: an unlocked `findById` peek (unknown id → 404 without touching the lock); the Google token is fetched **before** the lock and only if the peeked row is mirrored; inside: re-read, Google delete, row delete. A row gone at the re-read, or a NotFound on the final delete (drift runs outside the lock), answers **204**. If the row was mirrored by a replan while the request waited (no token fetched), it lets go, fetches a token, and retakes the lock once.
  - `GET /schedule` manual sweep (`manual-sweep.ts`): candidates read outside; none → no lock. Otherwise one token lookup (only if a candidate is mirrored) outside, then under the lock a fresh read, and only candidates still `isDiscardableUnstarted` are deleted (row, then its event), one at a time.
- Google token lookups never run under the lock: a slow or hung refresh (google-auth-library's own timeout **[I]**) cannot hold up a user's edits. A failed lookup is kept and logged per row with the usual write-back warning.

### 3.3 Deadlock and starvation

- The lock is never re-entered: routes take it once per section (DELETE's retry takes it a second time only after releasing it); replans take it once, inside their own queued run.
- No route awaits a replan while holding the lock: `afterMutation` is fire-and-forget and runs after release. `POST /schedule/replan` awaits the replan without holding anything; the replan takes the lock itself.
- Neither the replan queue nor the poller holds the lock while waiting: the poller awaits `pollAndReplan`, whose sync runs unlocked and whose replan takes the lock only around compute + apply.
- FIFO per user: a waiter is never overtaken, so a stream of replans cannot starve an edit (and vice versa).
- If a section never settles, that user's later sections wait forever. Inside the lock there are only DB statements and Google calls, each Google call bounded by the 15 s request timeout; Prisma calls have no timeout of their own **[I]**.

### 3.4 What it closes

- W3: apply's read and all its writes (with their Google calls) sit in one critical section that excludes every block route.
- W2: compute's read is inside the same section, so the duplicates and ghosts go too.
- The Start/Stop stale read (§2 item 5).
- The re-import case (§2 item 4): the user's commit now always follows Google's response to the push, so `row.updatedAt > event.updated` holds **if the host clock is not behind Google's** by more than that latency (§5).
- The DELETE 404 race.

Not preserved, but no longer silent: an edit (PATCH, Start, Stop) that waited while the replan **removed** its row (the engine dropped that key and swept the block) answers 404 and changes nothing; the optimistic UI rolls back to the replan's result, and no follow-up replan is enqueued. A drag cannot pin a block that no longer exists.

Left open: W1 (drift writes racing a route write: matters only for a genuine two-sided conflict; closable by moving drift's row read and writes into the lock after the listing); writes by cascade (deleting a task or habit removes its blocks mid-apply — no longer an abort, see §6).

### 3.5 Web companion

A route waiting on the lock widens the known snap-back race (a `schedule.updated` refetch landing before the route's write). The web already defers schedule/calendar-event refetches while a planner write is pending (`api/queries.ts`). Live-verify drag-during-replan before deciding whether anything more is needed.

## 4. Rejected options (brief)

- **A. Routes await the per-user replan queue.** Correct, but over-locks: a drag waits for the token refresh, the paged drift listing, compute and apply. `serialisePerUser` also coalesces waiters into one run, which route writes cannot share.
- **B. Optimistic concurrency in apply** (conditional `updateIfUnchanged`/`deleteIfUnchanged`). The right shape for multiple processes, but the Google side does not fall out of a DB CAS: A1 pushes before its DB write, A5 must flip to DB-first, A7 has no DB write at all, and each needs a pre-check and a compensating push. A site-by-site rewrite of the most intricate file, for zero added route latency.
- **C. Abort-and-restart (generation counter).** Shrinks the window but does not close it: the check and the write straddle an awaited HTTP call, so a stale push can still land and be re-imported. Aborted runs leave Google and the DB half-updated until R′.
- **D. Re-read before the write phase.** Read #3 is already as late as it can be; the lossy window is the write phase itself.
- **E. Per-row lock + re-validate.** Kept as a follow-up if first-link latency ever matters; it reintroduces B's re-validation logic.

## 5. Clock caveat (all options)

`googleWins` compares Google's `updated` (Google's clock) with `row.updatedAt` (the host clock). Under A′ the user's commit follows Google's response by at least the network latency, so ordinary NTP skew is fine; a host clock seconds behind Google's would still re-import a push. The robust fix stores the `updated` stamp Google returns for our own write on the row and treats an equal stamp as ours — a schema change, out of scope.

## 6. Per-row failure isolation in apply (F7)

- Before: one row that failed to save in the main diff loop (a Google error, or a foreign-key error because its task was deleted a moment ago) aborted the whole apply, so later rows, the sweep, the pinned pass and `schedule.updated` were skipped — possibly on every cycle. The pinned pass and the first-insert ("attach") path already isolated per row.
- Now every create (A4), update (A1/A2) and sweep delete (A5) is isolated: a failing row is skipped and counted, and the loop carries on. Google first still means a failed Google call skips that row's DB write. The order of writes for non-failing rows is unchanged.
- New optional counts on `ApplyCounts`/`ReplanCounts`: `createFailed`, `updateFailed`, `deleteFailed`, **present only when non-zero** (a clean run keeps its long-standing shape). A failed DB write after the first insert of an **unchanged** row counts as `attachFailed`; for a **changed** row (insert + move in one write) it counts as `updateFailed`. They surface in the replan result, the `POST /schedule/replan` reply and the `schedule.updated` WS event; the web's `ReconcileResult` type needs no change.
- Core has no logging (it is pure); failures surface only as counts, like the pinned pass.
- A single-row Google error no longer fails `POST /schedule/replan` with a 502: it answers 200 with the count. 403/429 on one event are isolated, so the loop keeps calling Google for the remaining rows.
- Still fatal: `ApplyScheduleOptions.isFatal` (default: nothing fatal), checked at every catch in the main loop, the first-insert ("attach") catches included — so a fatal error during a first-link insert now aborts instead of being counted. Google's `reconcile` passes `abortsApply`: any `GoogleAuthError` (a `GoogleGrantRevokedError` included — the token service is what flags `googleAuthBrokenAt`, during the refresh before apply, but should one ever come out of a mirror call it must reach the caller), a `GoogleApiError` 401 (the access token was rejected: every later call would fail too), and a `GoogleTimeoutError` (Google unreachable: isolating it would make every remaining row wait out its own 15 s timeout while the user's lock is held). Errors outside the loop (apply's read, compute, drift, the token refresh) are unaffected.
- A create that fails after its Google insert leaves that event behind (the create may have committed with a lost reply, so it is not deleted blind) — the same orphan the old abort produced.

## 7. Tests

- `server/test/user-lock.test.ts`: FIFO, per-user isolation, release on throw (async and sync), idle entries dropped.
- `core/test/plan-locally-exclusive.test.ts`: a drag committed right after apply's read, through the same lock, is not overwritten; compute and apply run inside the section, settings outside.
- `google/test/reconcile-exclusive.test.ts`: the engine-diff overwrite through `reconcile` (drag during the first PUT); the stale pinned push re-imported by drift across two cycles (one fake clock stamping both sides in execution order); only compute + apply inside the section.
- `server/test/block-route-lock.test.ts`: PATCH / POST / Start / Stop / DELETE issued while a replan holds the lock wait and then apply on top of its writes (Start/Stop clocked at arrival, computed from the fresh row); DELETE 204 when the row vanished; a DELETE or sweep whose token lookup hangs does not hold the lock; the sweep takes the lock only with candidates and re-checks them; a real `makeReplan` + `planLocally(…, exclusive)` and a concurrent drag share the lock both ways.
- `server/test/write-order.test.ts`: traces updated where the order deliberately changed (DELETE peek + in-lock re-read, token before the lock, unknown-id 404 from the peek, vanished row 204; sweep token looked up once before its in-lock re-read).
- `core/test/apply.test.ts` / `google/test/reconcile.test.ts` / `server/test/schedule.test.ts`: per-row isolation of create, update and delete (Google and DB failures), the fatal set, and the counts in the replan reply and event.

## 8. Appendix: the poll-sync hazards (open, same family, not fixed here)

- The poll's inbound sync runs **outside** the per-user queue and the lock, so it can overlap a replan and the calendar routes. `upsertMany` overwrites `title/startsAt/endsAt` on match, including `source: 'app'` rows. `PATCH /calendar/events/:id` writes the DB first, then a best-effort `patchEvent`. The full resync runs `deleteMirroredByCalendar`, `upsertMany`, `deleteByGoogleEventIds` (`google/src/sync.ts`) with no enclosing transaction.
- **Stale upsert reverting an app event.** The sync's listing is taken before the route's `patchEvent`, and its upsert lands after the route's DB write, restoring the listed (old) times. Self-heals within one poll if `patchEvent` succeeded; **permanent** if it failed, or if a title-only edit in the revert window pushes the stale times (the route fills unsent fields from the reverted row). The lock does not help (the listing itself is stale). Proposed fix: a guarded `upsertMany(…, { listedAt })` that skips `app` rows modified after `listedAt`, plus a re-touch of the row after a successful `patchEvent`.
- **Non-atomic full resync.** Between purge and upsert a concurrent replan plans tasks over the user's meetings and pushes them to Google; the poll's own reconcile moves them back. Self-healing churn; rare (first sync or a 410). Fix: one `$transaction` for purge + upsert + delete.
- **Duplicate row on `POST /calendar/events`.** A poll upsert between the route's Google insert and `setGoogleIds` creates a `google`-source mirror row; `setGoogleIds` then hits the unique constraint and the write-back is swallowed. Permanent duplicate, rare. Fix: on `ConflictError`, delete the mirror row holding those ids and retry once.
- Suggested order: duplicate row → stale upsert (guard + re-touch) → atomic resync, as one "calendar sync hardening" branch.

## 9. Engineering findings

- **Unpin zombie (open).** `PATCH {pinned:false}` on a row whose `engineKey` is null (rows from POST, A3 or D2) leaves an unpinned, key-less row: apply never moves, sweeps or mirrors it, assemble ignores it for busy time, and in non-manual mode it counts as spent once it ends. Fix idea: such an unpin deletes the row (and its event) and replans, or gives it a key back.
- **DELETE 404 race (fixed).** A NotFound on the final delete now answers 204.
- **W2 ghosts (fixed).** Engine pass-through blocks carry the row uuid as id; a row that stopped being pinned between assemble and apply made apply create an auto row keyed by that uuid. Compute now runs inside the lock.
- **Resurrected orphan events (race removed; Google behaviour still unverified [I]).** Whether a PUT to a just-deleted event restores it was never probed; A′ removes the race that could issue one.
- **Writers still outside the lock (open).** Task/habit deletes cascade to blocks mid-apply (now isolated per row instead of aborting); drift's writes (W1); the inbound sync (§8).
- **Pinned-pass timeouts (open).** The pinned pass still isolates every error, timeouts included, so a Google outage can cost one 15 s timeout per pinned row while the lock is held; consider applying the same fatal set there. (The main loop, first inserts included, already aborts on them.)
- **Silent persistent row failures (open).** Nothing logs non-zero `*Failed` counts; a row failing every cycle is visible only in the replan result. Consider a server-side warning when a replan reports failures.
- **Orphaned event on a failed create after insert (open).** See §6.

## 10. Open questions for the owner

1. **Same-moment conflicts (W1).** A block moved in the app and its event moved in Google at the same moment: today whichever lands last wins. Closing it means moving drift's row read and writes into the lock.
2. **Deleted task blocks.** A deleted task block reappears on the next replan (accepted rule R10). Is "reappears later" still intended, or should a delete stick?
3. **Appendix scope.** Fix the calendar-sync hazards (§8) as a follow-up branch, or ledger them?
