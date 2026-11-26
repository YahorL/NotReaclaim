# Lost Block Edits — Per-User Lock — Design

**Status:** implemented on `fix/b2a-lost-edits` (owner decisions: "fix it; edits wait their turn" for the lock, F7 "isolate failures" for the diff loop).
**Scope:** `packages/server`, `packages/core`, `packages/google`. No scheduler, schema, migration, repository-interface or web change.

Evidence labels: **[R]** verified by reading the code, **[E]** verified by a read-only experiment, **[I]** inferred (mostly Google API behaviour and timing).

## 0. Summary

- A planner edit made while a background replan was running could be silently and permanently undone **[R]**. A replan reads the stored blocks once, then writes one row at a time with awaited Google calls in between (seconds, for a Google-connected user). The block routes were not serialised with it, so a replan that read the old state could move a just-dragged block back, delete it, or push its old time to Google, which the next cycle then re-imported as a "Google edit".
- **Fix (option A′):** one per-user in-process FIFO lock (`server/src/user-lock.ts`), held around **compute + apply** in both replan paths and around each block route's read-modify-write. An edit that arrives mid-replan **waits** for the apply to finish and lands on top of its result. Token refresh, the Auto-scheduled calendar check and drift detection stay outside the lock.
- **Second change (F7):** a row whose save fails with an error that belongs to that row alone (a Google answer about that one event, a row gone or a foreign key) is skipped, counted and logged instead of aborting the user's whole replan. Every other error — the database or the network going away, an unknown error — still aborts, as before (§6).
- Remaining caveats: host-vs-Google clock skew inside drift's arbitration (§5), window W1 (a drift write racing an edit: a two-sided conflict, or a drag followed by an unpin; §1.4), and writers still outside the lock (task/habit cascades, drift, the inbound calendar sync; §8, §9).

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
| W1 | between read #1 and drift's write for B | a two-sided conflict (B's event **also** edited in Google), or B made unpinned again while Google still holds an older time (see §3.4) |
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
5. Start/Stop computing from a stale route-side `findById` (the route read, then a replan moved the row, then the route wrote from the old row): the result mixes two states of the block.

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
  - `GET /schedule` manual sweep (`manual-sweep.ts`): candidates read outside; none → no lock. Otherwise one token lookup (only if a candidate is mirrored) outside, then under the lock a fresh read, and only candidates still `isDiscardableUnstarted` are deleted (row, then its event), one at a time. If a candidate became mirrored while the sweep waited (a replan clocked before the row ended can mirror it: its pinned pass or a first insert) and no token was fetched, the sweep lets go, fetches one and retakes the lock once, like DELETE.
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
- The Start/Stop stale-read RACE (§2 item 5): both now compute from the row as the replan left it. The serial outcome is unchanged pre-existing Start semantics: if the replan moved the block (say to 09:00–10:00 tomorrow) and the user then presses Start, Start pulls the start to round15(now) and **keeps the block's end**, so the running block spans until tomorrow's 10:00 (pinned by `block-route-lock.test.ts`, "Start: clocked at ARRIVAL…"). Whether Start should keep the end is an open product question (§10).
- The re-import case (§2 item 4): the user's commit now always follows Google's response to the push, so `row.updatedAt > event.updated` holds **if the host clock is not behind Google's** by more than that latency (§5).
- The DELETE 404 race.

Not preserved, but no longer silent: an edit (PATCH, Start, Stop) that waited while the replan **removed** its row (the engine dropped that key and swept the block) answers 404 and changes nothing; the optimistic UI rolls back to the replan's result, and no follow-up replan is enqueued. A drag cannot pin a block that no longer exists.

Left open:
- W1, drift's row read and writes racing a route write. Two ways it bites: a genuine two-sided conflict (the same event edited in the app and in Google at the same moment), and a **drag followed by an unpin** before the drag's replan reaches drift's row read — the row is then unpinned at the new time while Google still holds the old one, and drift (unpinned ⇒ Google wins) moves it back and pins it there. Closable by moving drift's row read and writes into the lock after the listing (a small split of `detectDrift`).
- Writes by cascade: deleting a task or habit removes its blocks mid-apply (isolated per row, see §6).

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
- Now every create (A4), update (A1/A2), first insert and sweep delete (A5) isolates a failure **that belongs to that one row** — an allow-list — and aborts on everything else, exactly as before:
  - core's default (`isRowScopedDbError`, exported): the db layer's `NotFoundError` and `ConflictError` (matched by `name`; core imports `@notreclaim/db` for types only) and a foreign-key violation (Prisma `P2003`, duck-typed on `code`; the repository translates only P2002/P2025). Used by both replan paths, so a local plan aborts on a database outage too.
  - `ApplyScheduleOptions.isRowScoped` adds caller-specific ones. `reconcile` passes: a `GoogleApiError` that is neither a `GoogleTimeoutError` nor a 401 — Google **answered** about this event (400/403/404/409/410/412, and 429/5xx).
  - Fatal, therefore: any other DB error (P1001 unreachable, a reset connection, a pool timeout, a restart during a deploy), a network failure (`fetch failed` arrives as a plain `TypeError`, often after undici's ~10 s connect timeout, without the client's own 15 s signal firing), a timeout, a 401, any `GoogleAuthError` (a `GoogleGrantRevokedError` included — it is raised by the token refresh before apply, which is what flags `googleAuthBrokenAt`), and anything unknown.
  - Why an allow-list: with a deny-list, a database outage mid-apply let every remaining row make its Google call and then fail its DB write; the next cycle's drift took each Google/DB difference for a Google-side edit and pinned every block at a slot the user never chose, and failed creates left duplicate Google events. Now the apply stops at the first such row (one Google write without its DB write, as before isolation). A network failure no longer costs one connect timeout per row while the user's lock is held.
  - Decision on 429/5xx: isolated, but capped by a circuit. Isolating one is right — the row is retried next cycle either way, and isolating a rate-limited/5xx **first insert** is the existing rule (a first link's mass attach must not abort on one rejected insert). But they are not free: each call can take up to the client's 15 s timeout while the user's lock is held (a slow body), and a 5xx on a PUT or insert may have been applied on Google's side anyway (the DB keeps the old time, so the next cycle's drift pins that row at Google's time; an insert can leave a duplicate event). So `reconcile` also marks 429 and 5xx as **transient** (`ApplyScheduleOptions.isTransient`).
  - The streak: only transient failures extend it; a **successful** external call resets it (a create, update or delete that reached Google, compensating deletes included — a failed compensating delete does not); other isolated failures (a 403/404/409/410/412 answer, a DB NotFound/Conflict/P2003) leave it unchanged, so 429, 429, 403, 429 opens the circuit on the fourth call. One streak per apply, across the main loop, first inserts and sweep deletes (a sweep delete's transient failure counts like any other). DB errors are never transient, so a local plan is unaffected.
  - Circuit open (`MAX_TRANSIENT_STREAK = 3` consecutive transient failures): the apply makes **no further external call** — the mirror it uses throws an internal `ExternalCallSkipped` instead — but it **finishes and returns its counts**, so the caller still emits `schedule.updated`, logs the one warning, and the next cycle retries. (Throwing at the cap instead would starve the sweep, the pinned pass and `schedule.updated` on every cycle while three or more rows keep failing.) What happens to each remaining step:
    - needs an external call → skipped and counted as failed, with **no DB write** (Google first): a mirrored row's move (`updateFailed`), a new block (`createFailed`), a mirrored stale row's sweep (`deleteFailed`), an unchanged never-mirrored row's first insert (`attachFailed`), a pinned row's insert or push in the pinned pass (`pinnedFailed`);
    - needs none → still runs: a never-mirrored changed row still gets its DB move (its first insert is skipped and counted as `attachFailed`, the long-standing rule for a failed first insert: there is no event to disagree with), a stale row with no event is swept, a pinned key holder's key release, unchanged rows;
    - reported once: a `circuit-open` entry carrying the failure that opened it (no row ids); the skipped steps are only counted. Fatal errors still throw at once — and none can occur after the circuit opens, since no external call is made.
  - Worst case for the external calls of one apply: two consecutive transient failures can recur any number of times between successes (each up to 15 s), but never three in a row; after the third, no further call.
- Write order for non-failing rows is unchanged. Google first still means a failed Google call skips that row's DB write.
- Compensation where it is provably safe (best effort; a failed compensating delete only leaves the orphan it was meant to remove):
  - a create whose Google insert succeeded but whose DB create was rejected with a foreign-key violation or a unique-key conflict (the row provably does not exist) deletes the just-inserted event; any other create failure leaves the event alone, since the row may have committed with a lost reply (and such a failure aborts anyway);
  - a mirrored row whose Google move succeeded but whose DB update finds the row gone (`NotFoundError`, e.g. a cascade) deletes the event, as `storeInsertedIds` already did for a first insert.
- Counts: `createFailed`, `updateFailed`, `deleteFailed` on `ApplyCounts`/`ReplanCounts`, **present only when non-zero** (a clean run keeps its long-standing shape). A failed first insert counts as `attachFailed` once the row's move has landed; a never-mirrored changed row whose insert **and** move fail counts once, as `updateFailed` (its plan did not apply at all). A failed DB write after the first insert of an unchanged row counts as `attachFailed`. The counts surface in the replan result, the `POST /schedule/replan` reply and the `schedule.updated` event; the web `ReconcileResult` type needs no change. A single-row Google answer no longer fails `POST /schedule/replan` with a 502: it answers 200 with the count.
- Logging: apply reports each isolated failure (`kind` create/update/delete/attach/pinned, `blockId`, `engineKey`, `error`) through `ApplyScheduleOptions.onRowFailure`, forwarded by `planLocally` (6th argument) and `ReconcileDeps.onRowFailure`, plus `circuit-open` once (above). A compensating event delete that failed (the event is left behind) is reported as an `orphan` entry without a count of its own: after a rejected create or a vanished moved row it comes next to that row's own report; for `storeInsertedIds`' `'orphaned'` outcome and in the pinned pass the `orphan` entry is the **only** report (the row is counted in `attachFailed` / `pinnedFailed`). The callback runs inside a try/catch: a failing reporter never aborts the apply. `makeReplan` (`replan-router.ts`), which every replan passes through, warns **once per replan** when any `*Failed` count is non-zero, with the user id, the non-zero failed counts and the first failure of each kind (error name, HTTP `status` / DB `code`, and the message as one line: whitespace collapsed, a Prisma known-request error reduced to its last line, capped at 300 characters; any thrown value is described without throwing). If the replan **rejects** after rows were reported, the same warning is emitted with the reports gathered so far and `failed: "unavailable: …"`, then the error is rethrown unchanged. The whole warning is guarded: a logging failure never rejects a replan or suppresses `schedule.updated`. Error objects never enter the counts, so neither the reply nor the realtime event carries them.
- Not wired: `assembleScheduleInput`'s `timezoneFallbackFrom` (an invalid stored time zone planned as UTC). `computeDesiredSchedule` drops it, so reaching `makeReplan` would mean threading it through compute, `planLocally` and `reconcile`; left as a follow-up.

## 7. Tests

- `server/test/user-lock.test.ts`: FIFO, per-user isolation, release on throw (async and sync), idle entries dropped.
- `core/test/plan-locally-exclusive.test.ts`: a drag committed right after apply's read, through the same lock, is not overwritten; compute and apply run inside the section, settings outside.
- `google/test/reconcile-exclusive.test.ts`: the engine-diff overwrite through `reconcile` (drag during the first PUT); the stale pinned push re-imported by drift across two cycles (one fake clock stamping both sides in execution order); only compute + apply inside the section.
- `server/test/block-route-lock.test.ts`: PATCH / POST / Start / Stop / DELETE issued while a replan holds the lock wait and then apply on top of its writes (Start/Stop clocked at arrival, computed from the fresh row); DELETE 204 when the row vanished; a DELETE or sweep whose token lookup hangs does not hold the lock; the sweep takes the lock only with candidates and re-checks them; a real `makeReplan` + `planLocally(…, exclusive)` and a concurrent drag share the lock both ways.
- `server/test/write-order.test.ts`: traces updated where the order deliberately changed (DELETE peek + in-lock re-read, token before the lock, unknown-id 404 from the peek, vanished row 204; sweep token looked up once before its in-lock re-read).
- `core/test/apply.test.ts` / `google/test/reconcile.test.ts` / `server/test/schedule.test.ts` / `server/test/replan-router.test.ts`: the row-scoped allow-list (NotFound / Conflict / P2003 isolated; P1001, a reset connection, an unknown error, `fetch failed`, a timeout, a 401 and auth errors abort; 403/404/429/500 isolated), a database outage stopping after the first row's Google write with the next cycle pinning only that row, the compensations, the count-once rule, the failure reports, the once-per-replan warning, and that the reply and the event carry counts only.

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
- **Pinned pass isolates everything (open).** The pinned pass (A6/A7) still catches every error, timeouts and network failures included, so a Google outage can cost one timeout per pinned row while the lock is held; consider the same row-scoped allow-list there. (The main loop, first inserts included, already aborts on them; the pinned pass does honour an open circuit.)
- **Rate limits signalled as 403 (open, unverified).** Google often reports rate limits as a 403 with reason `rateLimitExceeded` / `userRateLimitExceeded`, which the circuit does not treat as transient (only 429 and 5xx are). Check Google's documentation before changing `isTransientGoogleError`.
- **Silent persistent row failures (done).** A replan that skipped rows is now logged once (§6).
- **Orphaned events (partly done).** Compensated where the row provably does not exist (§6); a create that fails for another reason after its insert still leaves its event, by design.
- **Manual sweep orphaning an event (done).** The sweep now decides whether it needs a token from its in-lock re-read (§3.2).
- **Reduced horizon makes a reissued key collide every cycle (open).** Apply reads existing rows only up to the horizon end (`listByUserInRange(0, horizonEnd)`). After `horizonDays` is reduced, a row beyond the new horizon still holds its engine key; when the engine reissues that key inside the horizon, the create hits the unique `(userId, engineKey)` constraint every cycle (visible as `createFailed` plus the warning; the just-inserted event is deleted again). Fix: read the keyed rows without the upper bound.
- **A past row whose Google event was deleted fails its update every cycle (open).** Drift only lists `[now, horizon]`, so a past row whose event is gone is never cleaned up; when its key is reissued, the move's PUT answers 404/410 every cycle (isolated, counted, warned). Fix: on 404/410 for an update, fall back to inserting a new event.
- **Task and habit deletes orphan Google events (open, pre-existing).** Deleting a task or habit cascades to its block rows in the database but never deletes their events on the Auto-scheduled calendar.
- **UX gaps seen in the live check (open, web).**
  - An edit answered with 404 after waiting (its block was removed by the replan) flashes back and vanishes with no message.
  - A second drop or click during a wait creates a second pinned block, and nothing shows that a request is pending (see the next item).
  - Start acts on a block position the user may not have seen (the replan may have just moved it) and keeps the replan's end (§10 question 4).
- **Duplicate submissions during long waits (open).** An edit can now wait for an in-flight apply (seconds after a reshuffle, longer on a first link), and nothing on that path times out. On the web, creating a block (drop from the panel / click-to-create) and Start are plain, non-optimistic mutations (`useCreateScheduledBlockMutation`, `useStartBlockMutation` in `api/queries.ts` **[R]**) and, per review, their controls are not disabled while pending **[I]**, so an impatient second click sends a second request that queues behind the first: a second pinned block, or a second Start. Consider disabling those controls while their request is pending.

## 10. Open questions for the owner

1. **Same-moment conflicts (W1).** A block moved in the app and its event moved in Google at the same moment: today whichever lands last wins. Closing it means moving drift's row read and writes into the lock.
2. **Deleted task blocks.** A deleted task block reappears on the next replan (accepted rule R10). Is "reappears later" still intended, or should a delete stick?
3. **Appendix scope.** Fix the calendar-sync hazards (§8) as a follow-up branch, or ledger them?
4. **Start keeps the block's end.** Start pulls the start to round15(now) and keeps the end, so a block the engine had placed far ahead becomes a running block until that far end (§3.4). Should Start instead keep the block's length (end = new start + duration), or cap it?
