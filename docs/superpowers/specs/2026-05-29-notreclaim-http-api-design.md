# NotReclaim HTTP API — Design Spec (Milestone 4a)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestones 1–3b (all merged): `@notreclaim/scheduler`, `@notreclaim/db`,
`@notreclaim/core`, `@notreclaim/google`.

## Summary

Milestone 4a is the synchronous HTTP API: a Fastify server exposing JWT-authenticated
REST CRUD for tasks/habits/settings, schedule read + preview, a manual re-plan
trigger, and Google Sign-In (OAuth consent + callback → JWT). It turns the existing
libraries into an exercisable backend service. Realtime push, the watch-channel
webhook, and the automatic re-plan timer are milestone 4b.

The app is built by a `buildApp(deps)` factory with all collaborators injected, so
routes are tested with Fastify `inject` against fakes (DB-free, deterministic
`now`); production wires the real Prisma repos and Google adapter. Two deferred
items from earlier milestones are also addressed here.

## Goals

- A Fastify app factory (`buildApp(deps)`) with injected repos/services/config and an
  injectable `now`.
- Google Sign-In: consent URL endpoint + OAuth callback → `connectFromCode` → JWT.
- `requireAuth` JWT guard; all data routes user-scoped via `request.userId`.
- REST CRUD for tasks, habits, settings (Zod-validated).
- Schedule endpoints: read persisted blocks, preview desired+unscheduled, manual replan.
- Central domain-error → HTTP-status mapping.
- Deferred fixes: token-expiry skew margin; `deleteByGoogleEventIds` calendar-scoping.

## Non-Goals (4a)

WebSocket push, the Google watch-channel webhook receiver, and the poll/re-plan
background timer (all milestone 4b). Multi-user sign-up flows (single-user,
user-scoped data only). The web client (milestone 5).

## Package

New **`packages/server`** (`@notreclaim/server`), depending on `@notreclaim/db`,
`@notreclaim/core`, `@notreclaim/google`. Stack: Fastify, `@fastify/jwt`, Zod.

```
packages/server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    config.ts            # typed env (PORT, JWT_SECRET) + loadGoogleConfig + DATABASE_URL
    errors.ts            # mapDomainError(error) -> { status, code, message }
    app.ts               # buildApp(deps): FastifyInstance (AppDeps, requireAuth, error handler)
    auth-routes.ts       # /auth/google, /auth/google/callback
    task-routes.ts       # /tasks CRUD
    habit-routes.ts      # /habits CRUD
    settings-routes.ts   # /settings get/put
    schedule-routes.ts   # /schedule, /schedule/preview, /schedule/replan
    schemas.ts           # Zod schemas for request bodies/params/query
    server.ts            # entrypoint: build real deps + app.listen (typecheck/build only)
    index.ts             # exports buildApp + AppDeps
  test/
    fakes.ts             # buildTestApp(overrides) -> app with injected fakes
    auth.test.ts
    tasks.test.ts
    habits.test.ts
    settings.test.ts
    schedule.test.ts
```

## App factory & dependency injection

```ts
interface AppDeps {
  repos: {
    users: UserRepository;
    settings: SettingsRepository;
    tasks: TaskRepository;
    habits: HabitRepository;
    scheduledBlocks: ScheduledBlockRepository;
    calendarEvents: CalendarEventRepository;
    calendarSyncState: CalendarSyncStateRepository;
  };
  google: { client: GoogleClient; tokens: TokenService };
  schedulingRepos: SchedulingRepositories;          // for core computeDesiredSchedule
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>; // bound google.reconcile
  config: { jwtSecret: string; googleRedirectUri: string };
  now?: () => number;                                // defaults to Date.now
}

function buildApp(deps: AppDeps): FastifyInstance;
```

`now()` is the only impurity, injected so route tests are deterministic. Production
wires real Prisma repos, the real `GoogleClient`/`TokenService`, and a `reconcile`
bound to those; tests inject fakes.

## Configuration

`config.ts` reads and validates: `PORT` (default 3000), `JWT_SECRET` (required),
`DATABASE_URL` (required, used by the Prisma client in `server.ts`), and Google
config via `@notreclaim/google`'s `loadGoogleConfig` (`GOOGLE_CLIENT_ID/SECRET`,
`GOOGLE_REDIRECT_URI`, `ENCRYPTION_KEY`). Missing/invalid → clear startup error.
`.env*` stays gitignored.

## Auth — Google Sign-In → JWT

- `GET /auth/google` → `{ url: client.getConsentUrl(googleRedirectUri) }`.
- `GET /auth/google/callback?code=...` → `tokens.connectFromCode(code, googleRedirectUri)`
  → `user` → sign a JWT `{ sub: user.id }` (long-lived) → `{ token, userId }` JSON.
  Missing `code` → 400. *(M5's web client may later switch this to a
  redirect-with-token; JSON keeps 4a client-agnostic and testable.)*
- `requireAuth` preHandler: verify `Authorization: Bearer <jwt>` via `@fastify/jwt`,
  set `request.userId = payload.sub`. Missing/invalid → 401. All data routes use it.

## REST endpoints

All data routes are `requireAuth` and scoped to `request.userId`; bodies/params/query
are Zod-validated; repo errors flow through the central error handler.

### Tasks (`TaskRepository`)
- `POST /tasks` — body: title, priority, durationMs, dueBy (ISO→Date), minChunkMs,
  maxChunkMs, category?.
- `GET /tasks` — optional `?status=pending|scheduled|completed|archived`.
- `GET /tasks/:id` — 404 if not the user's.
- `PATCH /tasks/:id` — partial update.
- `DELETE /tasks/:id`.

### Habits (`HabitRepository`)
- `POST /habits` — title, priority, chunkMs, perPeriod, eligibleDays, periodType?,
  preferredStartMinute?, preferredEndMinute?.
- `GET /habits` · `GET /habits/:id` · `PATCH /habits/:id` · `DELETE /habits/:id`.

### Settings (`SettingsRepository`)
- `GET /settings` → the user's settings (or 404 if none yet).
- `PUT /settings` — upsert: timezone, workingHours (JSON), horizonDays?,
  defaultMinChunkMs, defaultMaxChunkMs.

### Schedule
- `GET /schedule?from=&to=` — persisted `ScheduledBlock`s in range (default
  `[now(), now() + horizonDays·day]`), via `scheduledBlocks.listByUserInRange`.
- `GET /schedule/preview` — `computeDesiredSchedule(schedulingRepos, userId, now())`
  → `{ blocks, unscheduled }` (read-only; the "at-risk" view).
- `POST /schedule/replan` — `reconcile(userId, now())` → `ReconcileResult` counts.

## Error handling

A single Fastify error handler via `mapDomainError`:
`NotFoundError`→404, `ConflictError`→409, `SettingsRequiredError`→409,
`GoogleNotConnectedError`→409, Zod validation→400, JWT verify failure→401,
`GoogleApiError`→502, otherwise→500 (logged; no internal details leaked).

## Deferred fixes (land in 4a)

- **`TokenService.getAccessToken` skew margin** (`@notreclaim/google`): refresh when
  `cachedExpiresAt - SKEW_MS <= now` with `SKEW_MS = 60_000`, so a token about to
  expire mid-request is refreshed. Update its unit test to realistic expiry values.
- **`deleteByGoogleEventIds` calendar-scoping** (`@notreclaim/db`): add a
  `googleCalendarId` parameter included in the `where` clause; update the caller
  (`syncPrimaryCalendar` passes `'primary'`) and the repo test.

## Testing

- **Route tests** (Fastify `inject` + injected fakes via a `buildTestApp(overrides)`
  helper; deterministic `now`):
  - Auth: 401 without/with a bad token; `/auth/google` returns a consent URL;
    callback mints a JWT (via `FakeGoogleClient` + a fake/real `TokenService`).
  - Tasks/habits/settings: CRUD happy paths; 404 (missing) and 409 (conflict)
    mapping; **user-scoping** (a JWT for user A cannot read/mutate user B's rows);
    Zod validation → 400.
  - `GET /schedule` returns persisted blocks; `GET /schedule/preview` returns
    `blocks` + `unscheduled`; `POST /schedule/replan` invokes the injected
    `reconcile` and returns its counts.
- **Deferred-fix unit tests** in their home packages (`@notreclaim/google` skew;
  `@notreclaim/db` delete-scoping).
- `server.ts` (real Prisma/Google wiring + `listen`) is verified by build/typecheck
  only — no live network or DB in tests.
