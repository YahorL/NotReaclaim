# NotReclaim Realtime & Background Layer — Design Spec (Milestone 4b)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestones 1–4a (all merged): `@notreclaim/scheduler`, `@notreclaim/db`,
`@notreclaim/core`, `@notreclaim/google`, `@notreclaim/server`.

## Summary

Milestone 4b adds the realtime and background layer on top of the synchronous HTTP
API from 4a. It introduces an in-process **event bus**, a **WebSocket** endpoint
that pushes domain events to a user's connected clients, a **re-plan orchestrator**
that turns calendar/task changes into events, and an **always-on background poll
timer** that sequences `syncPrimaryCalendar → reconcile` per Google-connected user.
Local mutations (task/habit/settings CRUD) trigger an immediate re-plan; the timer
catches *external* calendar edits.

The architecture is an in-process event bus with thin impure shells over pure,
unit-testable cores (registry, forward, `runPollCycle`, the two orchestration
paths). Producers `emit`; the WS layer subscribes and forwards. Everything stays
deterministic and DB-/network-free in tests via injected fakes and an injectable
`now`; only the `setInterval` timer and raw-socket glue fall back to typecheck (plus
an optional localhost smoke test).

## Goals

- An in-process typed `EventBus` (`schedule.updated`, `sync.completed`, `task.changed`).
- A `/ws` WebSocket endpoint, JWT-authenticated at the handshake, that forwards a
  user's events to that user's sockets only.
- Immediate re-plan on local mutations (reconcile → `schedule.updated`, plus
  `task.changed` for task routes).
- An always-on background timer: per Google-connected user,
  `syncPrimaryCalendar → reconcile`, emitting `sync.completed` + `schedule.updated`.
- A `UserRepository.listConnectedIds()` to drive the timer.
- All logic deterministic and testable with fakes; impurity confined to thin shells.

## Non-Goals (4b)

The Google **watch-channel webhook receiver and registration** are deferred to
go-live (no public HTTPS URL / real Google creds in dev; for self-hosted, polling is
the primary mechanism regardless). No `habit.changed`/`settings.changed` event types
(habit/settings mutations just trigger a re-plan). No external message broker
(Redis); the bus is in-process, single-process. The web client is milestone 5.

## Package

All changes land in the existing **`packages/server`** (`@notreclaim/server`), plus a
small additive method in **`@notreclaim/db`**.

```
packages/server/
  src/
    events.ts              # NEW: EventBus + ServerEvent types + createEventBus()
    connection-registry.ts # NEW: pure Map<userId, Set<Client>>; add/remove/forward
    ws.ts                  # NEW: registerWebSocket(app, deps): /ws handshake + lifecycle
                           #      + pure parseWsAuth() helper
    replan.ts              # NEW: replanAfterMutation(), pollAndReplan()
    scheduler.ts           # NEW: runPollCycle() (pure) + startScheduler() (setInterval shell)
    app.ts                 # MODIFIED: AppDeps.events; build afterMutation; subscribe bus->registry;
                           #           register websocket + /ws; pass afterMutation to route registrars
    task-routes.ts         # MODIFIED: call afterMutation(userId, {taskId, action}) after mutations
    habit-routes.ts        # MODIFIED: call afterMutation(userId) after mutations
    settings-routes.ts     # MODIFIED: call afterMutation(userId) after mutation
    config.ts              # MODIFIED: POLL_INTERVAL_MS (default 300000)
    server.ts              # MODIFIED: create bus; bind sync; build pollAndReplan; startScheduler
    index.ts               # MODIFIED: export EventBus, ServerEvent, createEventBus, scheduler/replan bits
  test/
    fakes.ts               # MODIFIED: buildTestApp creates+exposes an EventBus; fake reconcile/sync spies
    events.test.ts         # NEW
    connection-registry.test.ts # NEW
    ws.test.ts             # NEW (auth helper + forwarding; optional localhost smoke)
    replan.test.ts         # NEW
    scheduler.test.ts      # NEW
    tasks.test.ts          # MODIFIED: assert task.changed + reconcile on mutations
    habits.test.ts         # MODIFIED: assert reconcile on mutations (no task.changed)
    settings.test.ts       # MODIFIED: assert reconcile on mutation

packages/db/
  src/repositories/user-repository.ts  # MODIFIED: listConnectedIds()
  test/...                              # MODIFIED: listConnectedIds repo test (real Postgres)
```

## Components

### 1. Event bus (`events.ts`)

A synchronous in-process pub/sub. No IO, no clock.

```ts
import type { ReconcileResult, SyncResult } from '@notreclaim/google';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: ReconcileResult }
  | { type: 'sync.completed';   userId: string; sync: SyncResult; counts: ReconcileResult }
  | { type: 'task.changed';     userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void; // returns unsubscribe
}

export function createEventBus(): EventBus;
```

Dispatch is synchronous; `subscribe` returns an unsubscribe function. A listener
that throws must not break delivery to other listeners (wrap each call).

### 2. Connection registry (`connection-registry.ts`)

Pure, zero Fastify/ws coupling, generic over a minimal client:

```ts
export interface Client {
  userId: string;
  send(data: string): void;
}

export interface ConnectionRegistry {
  add(client: Client): void;
  remove(client: Client): void;
  forward(event: ServerEvent): void; // JSON.stringify once; send to event.userId's clients only
  countForUser(userId: string): number;
}

export function createConnectionRegistry(): ConnectionRegistry;
```

`forward` serializes the event once and sends it to every client registered under
`event.userId`. If a client's `send` throws (dead socket), it is removed from the
registry and delivery continues to the rest.

### 3. WebSocket transport (`ws.ts`)

```ts
export function registerWebSocket(app: FastifyInstance, deps: AppDeps, registry: ConnectionRegistry): void;
export function parseWsAuth(app: FastifyInstance, query: unknown): { userId: string } | null;
```

- Registers `@fastify/websocket` and `GET /ws`.
- `parseWsAuth` (pure, no socket): reads `token` from the query object, verifies it
  via `app.jwt.verify`, and returns `{ userId }` only when the token is valid and
  has a non-empty `sub`; otherwise `null`. Unit-tested directly.
- On handshake: if `parseWsAuth` returns `null`, close the socket immediately
  (do not register). Otherwise wrap the raw socket as a `Client`
  (`send(data) → socket.send(data)`, `userId`) and `registry.add(client)`.
- On socket close → `registry.remove(client)`.
- The single bus→registry subscription is created in `buildApp` (one subscription
  total), not per connection: `deps.events.subscribe((e) => registry.forward(e))`.

### 4. Re-plan orchestrator (`replan.ts`)

Two paths, both deterministic and injected:

```ts
export interface ReplanDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  bus: EventBus;
  now: () => number;
  log?: (err: unknown) => void;
}

export interface PollDeps extends ReplanDeps {
  sync: (userId: string, now: number) => Promise<SyncResult>;
}

// Local mutation path: reconcile only.
export async function replanAfterMutation(deps: ReplanDeps, userId: string): Promise<void>;
//   try { counts = await reconcile(userId, now()); bus.emit({type:'schedule.updated', userId, counts}); }
//   catch (err) { log?.(err); }   // swallow: the mutation already succeeded

// Timer path: inbound sync, then reconcile.
export async function pollAndReplan(deps: PollDeps, userId: string): Promise<void>;
//   const sync = await deps.sync(userId, now());
//   const counts = await deps.reconcile(userId, now());
//   bus.emit({type:'sync.completed', userId, sync, counts});
//   bus.emit({type:'schedule.updated', userId, counts});
```

`replanAfterMutation` swallows errors (the HTTP mutation has already returned).
`pollAndReplan` lets errors propagate to `runPollCycle`, which isolates them
per-user.

### 5. Background scheduler (`scheduler.ts`)

```ts
export interface PollCycleDeps {
  listConnectedIds: () => Promise<string[]>;
  pollAndReplan: (userId: string) => Promise<void>;
  log?: (err: unknown) => void;
}
// Pure cycle: list users, run each, isolate per-user failures.
export async function runPollCycle(deps: PollCycleDeps): Promise<void>;
//   for (const id of await deps.listConnectedIds()) {
//     try { await deps.pollAndReplan(id); } catch (err) { deps.log?.(err); }
//   }

export interface SchedulerDeps extends PollCycleDeps { intervalMs: number; }
// Thin impure shell — lives only in server.ts.
export function startScheduler(deps: SchedulerDeps): { stop: () => void };
//   re-entrancy guard (skip tick if previous cycle still running); timer.unref(); clearInterval on stop.
```

`runPollCycle` is fully unit-tested with fakes. `startScheduler` is verified by
typecheck/build (plus an optional fake-timer test).

### 6. Mutation wiring (modifies 4a routes)

`buildApp` constructs an `afterMutation` hook and passes it to the route registrars:

```ts
type TaskChange = { taskId: string; action: 'created' | 'updated' | 'deleted' };
type AfterMutation = (userId: string, change?: TaskChange) => void;

const afterMutation: AfterMutation = (userId, change) => {
  if (change) deps.events.emit({ type: 'task.changed', userId, ...change });
  void replanAfterMutation({ reconcile: deps.reconcile, bus: deps.events, now: deps.now, log: app.log.error.bind(app.log) }, userId);
};
```

- `registerTaskRoutes(app, deps, afterMutation)`: after a successful create/update/
  delete, call `afterMutation(userId, { taskId, action })`. The hook fires *after*
  the response is prepared (fire-and-forget).
- `registerHabitRoutes` / `registerSettingsRoutes`: call `afterMutation(userId)`
  (no `change`) after a successful mutation → re-plan only.

Because `replanAfterMutation` invokes `deps.reconcile` synchronously up to its first
`await`, route tests can assert the `reconcile` call (spy) and the synchronous
`task.changed` emission (bus subscription) deterministically, with no timing race.
The deferred `schedule.updated` (after `reconcile` resolves) is covered by
`replan.test.ts`.

## Data flow

```
mutation (POST/PATCH/DELETE) → response prepared → afterMutation
    → task.changed (tasks only)
    → replanAfterMutation → reconcile → schedule.updated
timer tick → runPollCycle → per connected user → pollAndReplan
    → syncPrimaryCalendar → reconcile → sync.completed + schedule.updated
any emit → bus → single subscription → registry.forward → that user's /ws sockets
```

## Wiring / DI changes

- **`AppDeps`** gains `events: EventBus` (injected). `reconcile`, `now` already present.
- **`buildApp`**: create a `ConnectionRegistry`; register `@fastify/websocket`;
  subscribe `events → registry.forward`; `registerWebSocket(app, deps, registry)`;
  build `afterMutation`; pass it to the task/habit/settings registrars.
- **`config.ts`**: add `POLL_INTERVAL_MS` (default `300000`).
- **`server.ts`**: `const events = createEventBus()`; bind
  `sync = (userId, now) => syncPrimaryCalendar({...}, userId, now)`; build
  `pollAndReplan` closure over `{reconcile, sync, bus: events, now}`; pass `events`
  into `buildApp`; `startScheduler({ listConnectedIds: users.listConnectedIds,
  pollAndReplan, intervalMs: serverConfig.pollIntervalMs, log })`. `syncPrimaryCalendar`
  needs `syncState` + `events` repos, which `server.ts` already constructs
  (`createCalendarSyncStateRepository`, `createCalendarEventRepository`).
- **`@notreclaim/db`**: `UserRepository.listConnectedIds(): Promise<string[]>` →
  ids of users with `googleRefreshToken` not null.
- **New runtime dep:** `@fastify/websocket` (version matched to Fastify 4.x; pinned
  during planning). **Optional dev deps** for the smoke test: `ws`, `@types/ws`.

## Error handling

- Re-plan failures (e.g. Google 5xx) are caught inside `replanAfterMutation` and
  logged; the mutation/HTTP response already succeeded and the last good schedule
  stays. `pollAndReplan` errors are isolated per-user by `runPollCycle`.
- WS handshake with a missing/invalid/empty-`sub` token → socket closed immediately,
  never registered (mirrors the HTTP `authenticate` guard's empty-sub rejection).
- A client whose `send` throws is removed from the registry; delivery continues.
- The timer's re-entrancy guard prevents overlapping cycles if one runs long.

## Testing (deterministic, DB-/network-free with injected fakes + fixed `now`)

- **`events.test.ts`**: emit delivers to all subscribers; unsubscribe stops
  delivery; a throwing listener does not block others.
- **`connection-registry.test.ts`**: `forward` sends only to `event.userId`'s
  clients; serializes the event as JSON; a client whose `send` throws is removed and
  others still receive; `countForUser` after add/remove.
- **`ws.test.ts`**: `parseWsAuth` returns `{userId}` for a valid token, `null` for
  missing/invalid/empty-`sub`. **Optional** localhost smoke test (real `ws` client
  against `app.listen(0)`): a valid token connects and receives an emitted event;
  a bad token is closed. Localhost only — not external network.
- **`replan.test.ts`**: `replanAfterMutation` calls `reconcile` and emits
  `schedule.updated` with the counts; on `reconcile` rejection it emits nothing and
  swallows the error. `pollAndReplan` calls `sync` then `reconcile` and emits
  `sync.completed` (with sync + counts) and `schedule.updated`.
- **`scheduler.test.ts`**: `runPollCycle` calls `pollAndReplan` once per id from
  `listConnectedIds`; one user throwing does not stop the others.
- **Extended route tests**: task create/update/delete emit `task.changed` (correct
  `action`) and invoke `reconcile`; habit/settings mutations invoke `reconcile` with
  no `task.changed`; GET routes emit nothing and do not call `reconcile`.
- **`@notreclaim/db`**: `listConnectedIds` returns only users with a non-null
  `googleRefreshToken` (real Postgres).
- **Build/typecheck only**: `server.ts` wiring and `startScheduler`'s `setInterval`
  shell (no live network, DB, or timers in unit tests).

## Scope

One cohesive implementation plan (~8–10 TDD tasks); all pieces exist to move domain
events to connected clients. The watch-channel webhook is **deferred to go-live**;
the always-on poll timer is the working auto-replan mechanism for self-hosted/dev.
