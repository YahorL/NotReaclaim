# NotReclaim — Decouple Scheduling/Persistence from Google — Design Spec

**Date:** 2026-06-01
**Status:** Approved (ready for implementation planning)
**Motivation:** Google Calendar should be an optional add-on, not a hard dependency. Today the app
computes a schedule without Google but can only **commit/persist** it through a Google-gated
`reconcile`, so without a Google account `GET /schedule` is empty and `POST /schedule/replan`
returns `409`. This makes the local schedule fully functional without Google; Google stays as an
optional sync layer.

## Summary

Extract the Google-free keyed `ScheduledBlock` diff out of `@notreclaim/google` `reconcile` into
`@notreclaim/core`, parameterized by an optional **mirror** (the Google side-effects). A new
**local re-plan** path (`planLocally`) persists the engine's plan to the DB with no Google. The
server picks **local vs Google reconcile** per user based on whether they have a Google refresh
token. Google-connected behavior is **unchanged** (purely additive). A small Planner tweak dedupes
the proposed overlay against now-populated committed blocks.

## Goals

- Adding/editing tasks/habits/settings **commits a real schedule locally** (persisted
  `ScheduledBlock`s) with no Google; `GET /schedule` returns it; `POST /schedule/replan` returns
  `200` with counts.
- Keep **calendar-aware scheduling**: `assembleScheduleInput` already feeds synced calendar events
  to the engine — unchanged.
- Keep **Google-connected behavior identical** (two-way: read events + mirror auto-scheduled blocks
  to the dedicated Google calendar; drift/pinning).
- DRY: one keyed-diff implementation shared by local and Google paths.
- Deterministic tests; no real Google (`FakeGoogleClient`); `@notreclaim/db` tests hit Postgres.

## Non-Goals

- No change to the scheduler engine, `assembleScheduleInput`, `computeDesiredSchedule`, settings,
  task/habit CRUD, or query keys.
- No new "disable write-back" setting (the brainstorm's option C) — out of scope; two-way stays the
  Google default.
- **No DB migration:** `ScheduledBlock.googleEventId`/`googleCalendarId` are already nullable
  (`String?`) in the Prisma schema, and `@@unique([userId, engineKey])` already backs the keyed
  diff — so local blocks (null Google fields) persist with no schema change.
- No inbound calendar sync change (it already feeds the engine and is Google-only by nature).
- No Stats change (it keeps using `/schedule/preview`).

## Decisions (locked during brainstorming)

- **Approach A — shared diff + optional mirror.** One diff in core; Google is an injected
  side-effect adapter (vs. a Google-optional `reconcile` conditional, or a duplicated local path).
- **Two-way Google sync kept identical** when connected (default; the user declined to narrow it,
  so we preserve current behavior — no regression).
- **Back-fill on connect:** existing local blocks (null `googleEventId`) are inserted into the
  Google calendar by the next reconcile's diff — falls out of the shared diff naturally.
- **Connection check** = `user.googleRefreshToken != null` (the same predicate `listConnectedIds`
  uses).
- **Counts shape preserved:** local re-plan returns `{ created, updated, deleted, pinned: 0,
  removed: 0 }` so the `schedule.updated` WS payload and web are unaffected.

## Architecture / Components

### `@notreclaim/core` (new)
- **`ScheduleMirror`** (Google-agnostic interface):
  ```ts
  interface ScheduleMirror {
    create(block: EngineScheduledBlock): Promise<{ googleEventId: string; googleCalendarId: string }>;
    update(block: EngineScheduledBlock, existing: DbScheduledBlock): Promise<void>;
    delete(existing: DbScheduledBlock): Promise<void>;
  }
  ```
- **`applyDesiredSchedule(scheduledBlocks, userId, desired, opts)`** where `opts = { now,
  horizonEnd, mirror? }` → `{ created, updated, deleted }` (the repo methods take `userId`:
  `listByUserInRange(userId, …)`, `create(userId, …)`, `update(userId, id, …)`,
  `delete(userId, id)`). This is the existing `reconcile` diff lifted out:
  - List existing committed blocks in `[now, horizonEnd]`; the set of pinned ids is preserved
    untouched; non-pinned blocks with an `engineKey` index by key.
  - For each desired block not pinned: if a keyed match exists and times changed → (mirror?.update)
    + `scheduledBlocks.update(times)`, `updated++`; if no match → (mirror?.create → ids | null) +
    `scheduledBlocks.create({ ...toScheduledBlockInput(block), engineKey, googleEventId, googleCalendarId })`,
    `created++`.
  - For each existing keyed block not in desired → (mirror?.delete) + `scheduledBlocks.delete`,
    `deleted++`.
  - **No mirror:** `googleEventId`/`googleCalendarId` are `null` on create; no external calls.
  - The repo surface needed (`scheduledBlocks`): `listByUserInRange`, `create`, `update`, `delete`
    (the same `Pick` reconcile already uses) — passed with `userId` bound or as a param consistent
    with the existing repo signatures.
- **`planLocally(schedulingRepos, scheduledBlocks, userId, now)`** = `computeDesiredSchedule(...)`
  → `applyDesiredSchedule(scheduledBlocks, desired, { now, horizonEnd, /* no mirror */ })` →
  `{ created, updated, deleted, pinned: 0, removed: 0 }`. `horizonEnd` from settings
  (`SettingsRequiredError` when missing, matching reconcile).

### `@notreclaim/google` (refactor, behavior-identical)
- `reconcile` keeps: `tokens.getAccessToken`, `ensureAutoScheduledCalendar`, `detectDrift`
  (`pinned`/`removed`), `computeDesiredSchedule`. Its hand-rolled diff loop is **replaced by a call
  to `applyDesiredSchedule`** with a **`googleMirror(client, accessToken, calendarId)`** adapter
  whose `create`/`update`/`delete` call `client.insertEvent`/`updateEvent`/`deleteEvent`
  (via the existing `toGoogleEventWrite`). Result merges drift counts:
  `{ ...diffCounts, pinned, removed }`. Net external behavior identical to today.

### `@notreclaim/server` (wiring)
- Add a `planLocally`-backed dep and a per-user branch:
  `replan(userId, now)` = `users.findById(userId).googleRefreshToken != null ? reconcile(userId,
  now) : planLocally(userId, now)`.
- `POST /schedule/replan` calls `replan` (was `reconcile`). `replanAfterMutation` calls `replan`
  (was `reconcile`) — so local users get a committed schedule on every task/habit/settings change.
- The poll timer (`pollAndReplan`, gated by `listConnectedIds` = Google users) is **unchanged**.
- `AppDeps` gains whatever `planLocally` needs (the `schedulingRepos` + `scheduledBlocks` repo are
  already wired for `reconcile`); add a `users.findById` reach if not already present.

### `packages/web` (minor)
- **Planner overlay dedupe:** the proposed overlay must not draw a ghost for a block already
  committed. In `Planner`/`WeekGrid`, compute the set of committed `engineKey`s
  (`schedule.data[].engineKey`) and pass only proposed blocks whose `id` (the engineKey, e.g.
  `task:t1:0`) is **not** in that set to the grid's `proposed`. (PreviewBlock.id === the engine key
  === ScheduledBlock.engineKey.) Keeps the grid clean now that committed blocks populate. No other
  web change; Re-plan now succeeds (no `409`), so the "Re-plan failed" strip simply stops firing
  for local users.

## Data flow

Mutation (task/habit/settings) → `replanAfterMutation` → `replan` → (local) `planLocally`
persists the keyed diff → `schedule.updated` WS → web invalidates `schedule` → `GET /schedule`
returns committed blocks → Planner draws solid blocks; the proposed overlay shows only
not-yet-committed ghosts (typically none right after a re-plan). When Google connects, `replan`
routes to `reconcile`, whose diff mirrors the existing local blocks up to the calendar (back-fill).

## Error handling

`replanAfterMutation` keeps swallowing+logging (the HTTP mutation already succeeded). `POST
/schedule/replan` surfaces errors as today; local path can still throw `SettingsRequiredError`
(404/appropriate) when settings are missing. Google path keeps `GoogleNotConnectedError` semantics
internally, but it is only invoked for connected users now, so users without Google never hit it.

## Testing (vitest; DI; injected `now`; no real Google)

- **core `applyDesiredSchedule`** (fake in-memory `scheduledBlocks` repo): create/update/delete
  counts; **no mirror → persisted blocks have null `googleEventId`/`googleCalendarId`**; pinned
  blocks untouched; keyed update only when times change; with a **fake mirror**, ids are stored and
  create/update/delete are invoked.
- **core `planLocally`**: computes + persists via a fake repo; returns the `{…, pinned:0,
  removed:0 }` shape; throws `SettingsRequiredError` without settings.
- **google `reconcile`**: existing suite stays green using `FakeGoogleClient` (now exercising the
  shared diff); assert it still inserts/updates/deletes Google events + persists ids + merges
  drift counts.
- **server**: `POST /schedule/replan` for a **no-Google** user persists blocks and returns counts
  (not 409); a task mutation triggers a local persist (blocks appear in `GET /schedule`); a
  Google-connected user still routes through `reconcile`.
- **web**: Planner hides a proposed ghost whose engineKey matches a committed block; still shows
  ghosts for not-yet-committed proposed blocks.
- Full monorepo suite green; web build clean. `@notreclaim/db` repo tests hit Postgres.

## Scope / decomposition (for the plan)

~5 TDD tasks, sequential:
1. **core:** `ScheduleMirror` + `applyDesiredSchedule` + `planLocally` (+ tests).
2. **google:** refactor `reconcile` to delegate to `applyDesiredSchedule` via a `googleMirror`
   (+ keep tests green; behavior identical).
3. **server:** `replan` branch (Google vs local) wired into the `/schedule/replan` route and
   `replanAfterMutation`; `AppDeps` wiring (+ tests, incl. no-Google persist).
4. **web:** Planner proposed-overlay dedupe vs committed `engineKey`s (+ test).
5. **verification:** full monorepo suite + web build.
