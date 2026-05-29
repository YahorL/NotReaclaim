# NotReclaim Write-back + Reconcile — Design Spec (Milestone 3b-ii)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestones 1 (`@notreclaim/scheduler`), 2 (`@notreclaim/db`), 3a (`@notreclaim/core`), 3b-i (`@notreclaim/google`) — all merged.

## Summary

Milestone 3b-ii is the Google **write path**: it writes the engine's desired
schedule to a dedicated "Auto-scheduled" Google calendar and keeps DB and Google
in sync through a reconcile loop. The loop detects user edits to our events
(moves become pins; deletes are transient), recomputes the desired schedule,
and applies a keyed in-place diff (create/update/delete) to minimize Google
churn.

The reconcile orchestrator lives in `@notreclaim/google`, which gains a
dependency on `@notreclaim/core` (no cycle). Everything is tested against the
mockable `GoogleClient` and injected repositories; the one schema addition is
real-Postgres tested. No HTTP server or timer (milestone 4).

## Goals

- Extend `GoogleClient` with calendar/event write methods + a bounded `listEvents`.
- Persist the dedicated calendar's id (`User.autoScheduledCalendarId`) and an
  `ensureAutoScheduledCalendar` helper.
- A stable diff key (`ScheduledBlock.engineKey`) + a `ScheduledBlockRepository.update`.
- Drift detection: user moves → pin at new time; user deletes → transient remove.
- A reconcile orchestrator: drift → compute → keyed in-place diff → apply to
  Google and DB.

## Non-Goals (3b-ii)

- The HTTP server, OAuth callback route, watch-channel webhook receiver, and the
  poll/re-plan timer that sequences `syncPrimaryCalendar` → `reconcile` (all M4).
- Per-occurrence deletion suppression (deletes are transient by design).
- Multi-calendar write-back (single "Auto-scheduled" calendar in v1).

## Architecture & data flow

```
reconcile(deps, userId, now):
  accessToken  = tokens.getAccessToken(userId, now)
  calendarId   = ensureAutoScheduledCalendar(...)          # create + persist, or reuse
  settings     = schedulingRepos.settings.getByUserId      # -> SettingsRequiredError if absent
  horizonEnd   = now + horizonDays * 86_400_000
  detectDrift(...)                                         # user moves -> pin; deletes -> remove
  desired      = computeDesiredSchedule(schedulingRepos, userId, now)
  desiredNew   = desired.blocks minus pinned echoes        # engine placements only
  keyed diff (desiredNew vs existing non-pinned, on engineKey) -> create/update/delete
  return { created, updated, deleted, pinned, removed }
```

`reconcile` assumes `CalendarEvent` busy-rows are already fresh; the M4 timer
calls `syncPrimaryCalendar` then `reconcile`. They stay separate so each is
testable in isolation.

## `@notreclaim/db` changes (one migration)

- **`User.autoScheduledCalendarId String?`** — the dedicated calendar's id; added
  to `UpdateUserInput`.
- **`ScheduledBlock.engineKey String?`** with `@@unique([userId, engineKey])` —
  the stable diff key, holding the engine block id (`task:<id>:<index>` /
  `habit:<id>:<index>`). Null for pinned/user blocks (Postgres permits multiple
  nulls under the unique index).
- **`CreateScheduledBlockInput`** gains `engineKey?: string | null`.
- **`ScheduledBlockRepository.update(userId, id, data)`** where `data` is
  `{ startsAt?, endsAt?, pinned?, googleEventId?, googleCalendarId?, engineKey? }`;
  throws `NotFoundError` for a missing/wrong-user row (the existing
  `updateMany`+count pattern). Real-Postgres tested.

## `GoogleClient` write surface

Extend the interface (and the `FakeGoogleClient` + real adapter):

```ts
interface GoogleEventWrite {
  summary: string;
  startDateTime: string; // RFC3339
  endDateTime: string;   // RFC3339
}

interface GoogleClient {
  // ...existing read/auth methods, with listEvents extended:
  listEvents(args: { /* ... */ timeMin?: string; timeMax?: string }): Promise<ListEventsResult>;
  createCalendar(accessToken: string, summary: string): Promise<{ calendarId: string }>;
  insertEvent(accessToken: string, calendarId: string, event: GoogleEventWrite): Promise<{ googleEventId: string }>;
  updateEvent(accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, googleEventId: string): Promise<void>;
}
```

- `listEvents` gains optional `timeMax` for bounded reads of the Auto-scheduled
  calendar (no syncToken).
- `deleteEvent` treats HTTP 404/410 (already gone) as success (idempotent).
- The real adapter builds Calendar API request bodies; the fake records calls and
  serves scripted responses.

## Ensure-calendar helper

`ensureAutoScheduledCalendar(deps, userId, accessToken) → calendarId`:
- If `user.autoScheduledCalendarId` is set, return it.
- Otherwise `createCalendar(accessToken, 'NotReclaim')`, persist the id via
  `users.update(userId, { autoScheduledCalendarId })`, and return it.

## Write-back mapping

`toGoogleEventWrite(block) → GoogleEventWrite` (pure): an engine `ScheduledBlock`
→ `{ summary: block.title, startDateTime: new Date(block.start).toISOString(),
endDateTime: new Date(block.end).toISOString() }`.

## Drift detection

`detectDrift(deps, userId, calendarId, accessToken, now, horizonEnd)`:
1. List the Auto-scheduled calendar's events over `[now, horizonEnd]` (plain
   `listEvents` with `timeMin` + `timeMax`); map by `googleEventId`.
2. For each existing block in range with a `googleEventId`:
   - **Missing or cancelled** in Google → user deleted → `scheduledBlocks.delete`.
   - **Start or end differs** → user moved/resized → `scheduledBlocks.update(id,
     { startsAt, endsAt, pinned: true })`.
   - **Unchanged** → no action.

Runs before compute so freshly-pinned blocks feed in as fixed. Time comparison is
by epoch ms.

## Reconcile orchestrator

`reconcile(deps, userId, now) → { created, updated, deleted, pinned, removed }`.

`deps` bundles: `client` (full `GoogleClient`), `tokens` (`AccessTokenProvider`),
`users` (`Pick<UserRepository, 'findById' | 'update'>`), `scheduledBlocks`
(`Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>`),
and `schedulingRepos` (`SchedulingRepositories`, for `computeDesiredSchedule` and
settings).

Steps:
1. `accessToken`, then `calendarId = ensureAutoScheduledCalendar(...)`.
2. Load settings (`SettingsRequiredError` if absent); `horizonEnd`.
3. `detectDrift(...)`.
4. `desired = computeDesiredSchedule(schedulingRepos, userId, now)`.
5. Build `pinnedIds` from in-range pinned blocks (DB uuids); `desiredNew =
   desired.blocks.filter(b => !pinnedIds.has(b.id))` (the engine echoes pinned
   blocks with their DB-uuid id; fresh placements have `source:id:index` ids).
6. Keyed diff of `desiredNew` (key = engine block id) against existing
   non-pinned blocks with a non-null `engineKey` (map by `engineKey`):
   - **match + same start/end** → no-op (no Google write);
   - **match + moved** → `updateEvent`, then `scheduledBlocks.update`;
   - **desired-only** → `insertEvent` → `scheduledBlocks.create`
     (`engineKey = d.id`, `googleEventId`, `googleCalendarId = calendarId`, plus
     `toScheduledBlockInput(d)`);
   - **existing-only** → `deleteEvent`, then `scheduledBlocks.delete`.
7. Return counts (`removed` = drift deletions; `pinned` = drift pins).

**Google-before-DB ordering:** apply the Google event change first, then mirror
to the DB, so a failed Google write leaves the DB unchanged and retries cleanly.

## Error handling

- `SettingsRequiredError` (from `@notreclaim/core`) when no settings exist.
- `GoogleApiError` from failed Google writes; Google-before-DB ordering prevents
  partial DB state. `deleteEvent` swallows 404/410.
- `GoogleNotConnectedError` propagates from the token service.

## Testing

All against `FakeGoogleClient` + injected fake repositories (DB-free), except the
repository change:

- **`toGoogleEventWrite`:** field + ISO mapping.
- **`ensureAutoScheduledCalendar`:** creates + persists when absent; reuses the
  stored id when present.
- **`detectDrift`:** moved event → block pinned at the new time; deleted event →
  block removed; unchanged → untouched.
- **`reconcile`:** a new desired block → Google `insertEvent` + DB `create` with
  `engineKey`; a second identical run → **zero Google writes** (idempotency); a
  moved engine placement → `updateEvent` + DB update; a dropped placement →
  `deleteEvent` + DB delete; a pinned block is left alone and still feeds compute.
- **`ScheduledBlockRepository.update` + `engineKey` uniqueness:** real
  test-Postgres (milestone-2 harness): update mutates and is user-scoped; the
  `(userId, engineKey)` unique constraint holds; nulls coexist.
- The real adapter's new write methods are verified via build/typecheck only (no
  live network).
