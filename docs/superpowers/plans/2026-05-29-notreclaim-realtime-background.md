# NotReclaim Realtime & Background Layer Implementation Plan (Milestone 4b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add realtime WebSocket push and an always-on background poll/re-plan loop on top of the milestone-4a HTTP server, so local mutations and external calendar edits flow to connected clients as live events.

**Architecture:** An in-process typed `EventBus` decouples producers (the CRUD routes' re-plan hook; the background timer's sync→reconcile) from the transport (a `/ws` endpoint backed by a pure connection registry). The hard-to-test impurities — `setInterval` and raw sockets — are reduced to thin shells over pure cores (`runPollCycle`, `replanAfterMutation`/`pollAndReplan`, `parseWsAuth`, the registry). All logic is deterministic with injected fakes and an injectable `now`; only `server.ts` wiring and the `setInterval` shell fall back to typecheck.

**Tech Stack:** TypeScript (ESM, strict, explicit `.js` import extensions), Fastify 4, `@fastify/jwt`, `@fastify/websocket` (v8 — the Fastify-4 line), Zod, Vitest, Prisma/Postgres (db repo test only).

**Spec:** `docs/superpowers/specs/2026-05-29-notreclaim-realtime-background-design.md`

**Prerequisites:** The userspace Postgres cluster must be running for Task 1's db repo test (see the `local-postgres` memory). All other tasks are DB-/network-free.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/repositories/user-repository.ts` (modify) | add `listConnectedIds()` |
| `packages/server/src/events.ts` (new) | `EventBus`, `ServerEvent`, `createEventBus()` |
| `packages/server/src/connection-registry.ts` (new) | pure `Map<userId, Set<Client>>` registry + `forward` |
| `packages/server/src/replan.ts` (new) | `replanAfterMutation`, `pollAndReplan` |
| `packages/server/src/scheduler.ts` (new) | `runPollCycle` (pure) + `startScheduler` (setInterval shell) |
| `packages/server/src/ws.ts` (new) | `parseWsAuth` (pure) + `registerWebSocket` |
| `packages/server/src/app.ts` (modify) | `AppDeps.events`, `AfterMutation`, registry+subscription, register `/ws`, pass hook to routes |
| `packages/server/src/{task,habit,settings}-routes.ts` (modify) | call `afterMutation` after a successful mutation |
| `packages/server/src/config.ts` (modify) | `POLL_INTERVAL_MS` (default 300000) |
| `packages/server/src/server.ts` (modify) | create bus, bind `syncPrimaryCalendar`, build `pollAndReplan`, `startScheduler` |
| `packages/server/src/index.ts` (modify) | export new public symbols |
| `packages/server/test/fakes.ts` (modify) | inject + expose an `EventBus`; capture `emitted` events |

---

## Task 1: `@notreclaim/db` — `UserRepository.listConnectedIds()`

**Files:**
- Modify: `packages/db/src/repositories/user-repository.ts`
- Test: `packages/db/test/repositories/user-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe('UserRepository', ...)` in `packages/db/test/repositories/user-repository.test.ts`:

```ts
  it('listConnectedIds returns only users with a googleRefreshToken', async () => {
    const connected = await repo.create({ email: 'conn@example.com' });
    await repo.update(connected.id, { googleRefreshToken: 'enc-token' });
    await repo.create({ email: 'unconnected@example.com' });

    const ids = await repo.listConnectedIds();

    expect(ids).toContain(connected.id);
    expect(ids).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/db -- user-repository`
Expected: FAIL — `repo.listConnectedIds is not a function`.

- [ ] **Step 3: Implement `listConnectedIds`**

In `packages/db/src/repositories/user-repository.ts`, add this method to the object returned by `createUserRepository` (e.g. right after `findByGoogleId`):

```ts
    async listConnectedIds(): Promise<string[]> {
      const rows = await prisma.user.findMany({
        where: { googleRefreshToken: { not: null } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/db -- user-repository`
Expected: PASS (all UserRepository tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/user-repository.ts packages/db/test/repositories/user-repository.test.ts
git commit -m "feat(db): UserRepository.listConnectedIds for the poll loop"
```

---

## Task 2: `events.ts` — the typed event bus

**Files:**
- Create: `packages/server/src/events.ts`
- Test: `packages/server/test/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/events.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../src/events.js';

const COUNTS = { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 };

describe('EventBus', () => {
  it('delivers an emitted event to all subscribers', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    const event = { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' } as const;
    bus.emit(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const off = bus.subscribe(a);
    off();

    bus.emit({ type: 'schedule.updated', userId: 'u1', counts: COUNTS });

    expect(a).not.toHaveBeenCalled();
  });

  it('a throwing listener does not block delivery to others', () => {
    const bus = createEventBus();
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(good);

    expect(() => bus.emit({ type: 'schedule.updated', userId: 'u1', counts: COUNTS })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- events`
Expected: FAIL — cannot find module `../src/events.js`.

- [ ] **Step 3: Implement `events.ts`**

Create `packages/server/src/events.ts`:

```ts
import type { ReconcileResult, SyncResult } from '@notreclaim/google';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: ReconcileResult }
  | { type: 'sync.completed'; userId: string; sync: SyncResult; counts: ReconcileResult }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A faulty listener must not break delivery to the others.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- events`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/events.ts packages/server/test/events.test.ts
git commit -m "feat(server): in-process typed event bus"
```

---

## Task 3: `connection-registry.ts` — pure socket registry

**Files:**
- Create: `packages/server/src/connection-registry.ts`
- Test: `packages/server/test/connection-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/connection-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createConnectionRegistry, type Client } from '../src/connection-registry.js';
import type { ServerEvent } from '../src/events.js';

const event: ServerEvent = { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' };

function fakeClient(userId: string): Client & { sent: string[] } {
  const sent: string[] = [];
  return { userId, sent, send: (data) => sent.push(data) };
}

describe('ConnectionRegistry', () => {
  it('forwards only to clients of the event userId, serialized as JSON', () => {
    const reg = createConnectionRegistry();
    const a = fakeClient('u1');
    const b = fakeClient('u2');
    reg.add(a);
    reg.add(b);

    reg.forward(event);

    expect(a.sent).toEqual([JSON.stringify(event)]);
    expect(b.sent).toEqual([]);
  });

  it('stops sending after remove', () => {
    const reg = createConnectionRegistry();
    const a = fakeClient('u1');
    reg.add(a);
    reg.remove(a);

    reg.forward(event);

    expect(a.sent).toEqual([]);
    expect(reg.countForUser('u1')).toBe(0);
  });

  it('removes a client whose send throws and still delivers to others', () => {
    const reg = createConnectionRegistry();
    const bad: Client = {
      userId: 'u1',
      send: () => {
        throw new Error('dead socket');
      },
    };
    const good = fakeClient('u1');
    reg.add(bad);
    reg.add(good);

    reg.forward(event);

    expect(good.sent).toEqual([JSON.stringify(event)]);
    expect(reg.countForUser('u1')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- connection-registry`
Expected: FAIL — cannot find module `../src/connection-registry.js`.

- [ ] **Step 3: Implement `connection-registry.ts`**

Create `packages/server/src/connection-registry.ts`:

```ts
import type { ServerEvent } from './events.js';

export interface Client {
  userId: string;
  send(data: string): void;
}

export interface ConnectionRegistry {
  add(client: Client): void;
  remove(client: Client): void;
  forward(event: ServerEvent): void;
  countForUser(userId: string): number;
}

export function createConnectionRegistry(): ConnectionRegistry {
  const byUser = new Map<string, Set<Client>>();

  function remove(client: Client): void {
    const set = byUser.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) byUser.delete(client.userId);
  }

  return {
    add(client) {
      let set = byUser.get(client.userId);
      if (!set) {
        set = new Set();
        byUser.set(client.userId, set);
      }
      set.add(client);
    },
    remove,
    forward(event) {
      const set = byUser.get(event.userId);
      if (!set) return;
      const data = JSON.stringify(event);
      for (const client of [...set]) {
        try {
          client.send(data);
        } catch {
          remove(client);
        }
      }
    },
    countForUser(userId) {
      return byUser.get(userId)?.size ?? 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- connection-registry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/connection-registry.ts packages/server/test/connection-registry.test.ts
git commit -m "feat(server): pure connection registry with per-user forward"
```

---

## Task 4: `replan.ts` — the two orchestration paths

**Files:**
- Create: `packages/server/src/replan.ts`
- Test: `packages/server/test/replan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/replan.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { replanAfterMutation, pollAndReplan } from '../src/replan.js';
import { createEventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';

const COUNTS = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 };
const SYNC = { upserted: 2, deleted: 0, fullResync: false };
const NOW = 1_700_000_000_000;

function capture(bus = createEventBus()) {
  const events: ServerEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return { bus, events };
}

describe('replanAfterMutation', () => {
  it('reconciles and emits schedule.updated with the counts', async () => {
    const { bus, events } = capture();
    const reconcile = vi.fn(async () => COUNTS);

    await replanAfterMutation({ reconcile, bus, now: () => NOW }, 'u1');

    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(events).toEqual([{ type: 'schedule.updated', userId: 'u1', counts: COUNTS }]);
  });

  it('swallows a reconcile failure, emits nothing, and logs', async () => {
    const { bus, events } = capture();
    const reconcile = vi.fn(async () => {
      throw new Error('google down');
    });
    const log = vi.fn();

    await expect(replanAfterMutation({ reconcile, bus, now: () => NOW, log }, 'u1')).resolves.toBeUndefined();

    expect(events).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('pollAndReplan', () => {
  it('syncs then reconciles and emits sync.completed and schedule.updated', async () => {
    const { bus, events } = capture();
    const sync = vi.fn(async () => SYNC);
    const reconcile = vi.fn(async () => COUNTS);

    await pollAndReplan({ sync, reconcile, bus, now: () => NOW }, 'u1');

    expect(sync).toHaveBeenCalledWith('u1', NOW);
    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(events).toEqual([
      { type: 'sync.completed', userId: 'u1', sync: SYNC, counts: COUNTS },
      { type: 'schedule.updated', userId: 'u1', counts: COUNTS },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- replan`
Expected: FAIL — cannot find module `../src/replan.js`.

- [ ] **Step 3: Implement `replan.ts`**

Create `packages/server/src/replan.ts`:

```ts
import type { ReconcileResult, SyncResult } from '@notreclaim/google';
import type { EventBus } from './events.js';

export interface ReplanDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  bus: EventBus;
  now: () => number;
  log?: (err: unknown) => void;
}

export interface PollDeps extends ReplanDeps {
  sync: (userId: string, now: number) => Promise<SyncResult>;
}

/** Local-mutation path: re-plan from local state and announce the new schedule. Errors are swallowed because the originating HTTP mutation has already succeeded. */
export async function replanAfterMutation(deps: ReplanDeps, userId: string): Promise<void> {
  try {
    const counts = await deps.reconcile(userId, deps.now());
    deps.bus.emit({ type: 'schedule.updated', userId, counts });
  } catch (err) {
    deps.log?.(err);
  }
}

/** Timer path: pull external calendar changes (inbound sync) then re-plan. Errors propagate to runPollCycle for per-user isolation. */
export async function pollAndReplan(deps: PollDeps, userId: string): Promise<void> {
  const sync = await deps.sync(userId, deps.now());
  const counts = await deps.reconcile(userId, deps.now());
  deps.bus.emit({ type: 'sync.completed', userId, sync, counts });
  deps.bus.emit({ type: 'schedule.updated', userId, counts });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- replan`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/replan.ts packages/server/test/replan.test.ts
git commit -m "feat(server): re-plan orchestration (mutation + poll paths)"
```

---

## Task 5: `scheduler.ts` — poll cycle + interval shell

**Files:**
- Create: `packages/server/src/scheduler.ts`
- Test: `packages/server/test/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/scheduler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runPollCycle } from '../src/scheduler.js';

describe('runPollCycle', () => {
  it('calls pollAndReplan once per connected id, in order', async () => {
    const pollAndReplan = vi.fn(async () => {});

    await runPollCycle({ listConnectedIds: async () => ['u1', 'u2'], pollAndReplan });

    expect(pollAndReplan.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
  });

  it('isolates a per-user failure and continues to the next user', async () => {
    const seen: string[] = [];
    const pollAndReplan = vi.fn(async (id: string) => {
      seen.push(id);
      if (id === 'u1') throw new Error('boom');
    });
    const log = vi.fn();

    await runPollCycle({ listConnectedIds: async () => ['u1', 'u2'], pollAndReplan, log });

    expect(seen).toEqual(['u1', 'u2']);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- scheduler`
Expected: FAIL — cannot find module `../src/scheduler.js`.

- [ ] **Step 3: Implement `scheduler.ts`**

Create `packages/server/src/scheduler.ts`:

```ts
export interface PollCycleDeps {
  listConnectedIds: () => Promise<string[]>;
  pollAndReplan: (userId: string) => Promise<void>;
  log?: (err: unknown) => void;
}

/** Run one poll cycle: list connected users and re-plan each, isolating per-user failures. */
export async function runPollCycle(deps: PollCycleDeps): Promise<void> {
  const ids = await deps.listConnectedIds();
  for (const id of ids) {
    try {
      await deps.pollAndReplan(id);
    } catch (err) {
      deps.log?.(err);
    }
  }
}

export interface SchedulerDeps extends PollCycleDeps {
  intervalMs: number;
}

/** Thin impure shell: drive runPollCycle on an interval with a re-entrancy guard. Used only by server.ts (never in unit tests). */
export function startScheduler(deps: SchedulerDeps): { stop: () => void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runPollCycle(deps).finally(() => {
      running = false;
    });
  }, deps.intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- scheduler`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/scheduler.ts packages/server/test/scheduler.test.ts
git commit -m "feat(server): background poll cycle + interval shell"
```

---

## Task 6: install `@fastify/websocket`; `ws.ts` — handshake auth + transport

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/ws.ts`
- Test: `packages/server/test/ws.test.ts`

- [ ] **Step 1: Add the dependency**

Run (from repo root):

```bash
npm install --save-exact -w @notreclaim/server @fastify/websocket@8.3.1
```

Expected: `@fastify/websocket` `8.3.1` appears under `dependencies` in `packages/server/package.json` (the v8 line is the one compatible with Fastify 4). Verify the install:

Run: `npm ls -w @notreclaim/server @fastify/websocket`
Expected: shows `@fastify/websocket@8.3.1` with no peer-dependency warnings about Fastify.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/ws.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { parseWsAuth } from '../src/ws.js';

async function appWithJwt() {
  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: 'test-secret' });
  await app.ready();
  return app;
}

describe('parseWsAuth', () => {
  it('returns the userId for a valid token', async () => {
    const app = await appWithJwt();
    const token = app.jwt.sign({ sub: 'u1' });
    expect(parseWsAuth(app, { token })).toEqual({ userId: 'u1' });
  });

  it('returns null when the token is missing', async () => {
    const app = await appWithJwt();
    expect(parseWsAuth(app, {})).toBeNull();
  });

  it('returns null for an invalid token', async () => {
    const app = await appWithJwt();
    expect(parseWsAuth(app, { token: 'garbage' })).toBeNull();
  });

  it('returns null for a token with an empty sub', async () => {
    const app = await appWithJwt();
    const token = app.jwt.sign({ sub: '' });
    expect(parseWsAuth(app, { token })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- ws`
Expected: FAIL — cannot find module `../src/ws.js`.

- [ ] **Step 4: Implement `ws.ts`**

Create `packages/server/src/ws.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { ConnectionRegistry, Client } from './connection-registry.js';

/** Verify the JWT carried in the WS handshake query (?token=...). Returns the userId or null; never throws. */
export function parseWsAuth(app: FastifyInstance, query: unknown): { userId: string } | null {
  const token = (query as { token?: unknown } | null | undefined)?.token;
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = app.jwt.verify<{ sub?: string }>(token);
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/** Register @fastify/websocket and the authenticated /ws route. Connections that fail auth are closed immediately. */
export function registerWebSocket(app: FastifyInstance, registry: ConnectionRegistry): void {
  app.register(websocket);
  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (connection, request) => {
      const auth = parseWsAuth(instance, request.query);
      if (!auth) {
        connection.socket.close(1008, 'unauthorized');
        return;
      }
      const client: Client = {
        userId: auth.userId,
        send: (data) => connection.socket.send(data),
      };
      registry.add(client);
      connection.socket.on('close', () => registry.remove(client));
    });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- ws`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json package-lock.json packages/server/src/ws.ts packages/server/test/ws.test.ts
git commit -m "feat(server): /ws transport + handshake JWT auth"
```

---

## Task 7: wire into `app.ts`, the routes, and `test/fakes.ts`

This task makes `events` a required `AppDeps` field and wires the bus → registry → `/ws` and the `afterMutation` hook. The existing server test suite must stay green after it.

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/task-routes.ts`
- Modify: `packages/server/src/habit-routes.ts`
- Modify: `packages/server/src/settings-routes.ts`
- Modify: `packages/server/test/fakes.ts`

- [ ] **Step 1: Update `app.ts`**

In `packages/server/src/app.ts`:

1. Add imports near the existing imports:

```ts
import type { EventBus } from './events.js';
import { createConnectionRegistry } from './connection-registry.js';
import { registerWebSocket } from './ws.js';
import { replanAfterMutation } from './replan.js';
```

2. Add `events` to `AppDeps` (after `reconcile`):

```ts
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  events: EventBus;
```

3. Export the hook type (add after the `AppDeps` interface):

```ts
export type AfterMutation = (
  userId: string,
  change?: { taskId: string; action: 'created' | 'updated' | 'deleted' },
) => void;
```

4. Inside `buildApp`, after the `setErrorHandler` block and before the `registerAuthRoutes(...)` calls, add:

```ts
  const registry = createConnectionRegistry();
  deps.events.subscribe((event) => registry.forward(event));
  registerWebSocket(app, registry);

  const afterMutation: AfterMutation = (userId, change) => {
    if (change) deps.events.emit({ type: 'task.changed', userId, ...change });
    void replanAfterMutation(
      { reconcile: deps.reconcile, bus: deps.events, now: deps.now, log: (err) => app.log.error(err) },
      userId,
    );
  };
```

5. Update the route registrations to pass the hook:

```ts
  registerAuthRoutes(app, deps);
  registerTaskRoutes(app, deps, afterMutation);
  registerHabitRoutes(app, deps, afterMutation);
  registerSettingsRoutes(app, deps, afterMutation);
```

- [ ] **Step 2: Update `task-routes.ts`**

Replace the contents of `packages/server/src/task-routes.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { createTaskSchema, updateTaskSchema, listTasksQuerySchema, idParamSchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/tasks', guard, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const task = await deps.repos.tasks.create(request.userId, { ...body, dueBy: new Date(body.dueBy) });
    afterMutation(request.userId, { taskId: task.id, action: 'created' });
    reply.code(201);
    return task;
  });

  app.get('/tasks', guard, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    return deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
  });

  app.get('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const task = await deps.repos.tasks.findById(request.userId, id);
    if (!task) {
      reply.code(404).send({ code: 'not_found', message: `Task ${id} not found` });
      return;
    }
    return task;
  });

  app.patch('/tasks/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { dueBy: dueByStr, ...rest } = updateTaskSchema.parse(request.body);
    const data = { ...rest, ...(dueByStr ? { dueBy: new Date(dueByStr) } : {}) };
    const task = await deps.repos.tasks.update(request.userId, id, data);
    afterMutation(request.userId, { taskId: id, action: 'updated' });
    return task;
  });

  app.delete('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.tasks.delete(request.userId, id);
    afterMutation(request.userId, { taskId: id, action: 'deleted' });
    reply.code(204).send();
  });
}
```

- [ ] **Step 3: Update `habit-routes.ts`**

Replace the contents of `packages/server/src/habit-routes.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps, AfterMutation } from './app.js';
import { createHabitSchema, updateHabitSchema, idParamSchema } from './schemas.js';

export function registerHabitRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/habits', guard, async (request, reply) => {
    const body = createHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.create(request.userId, body);
    afterMutation(request.userId);
    reply.code(201);
    return habit;
  });

  app.get('/habits', guard, async (request) => deps.repos.habits.listByUser(request.userId));

  app.get('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const habit = await deps.repos.habits.findById(request.userId, id);
    if (!habit) {
      reply.code(404).send({ code: 'not_found', message: `Habit ${id} not found` });
      return;
    }
    return habit;
  });

  app.patch('/habits/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.update(request.userId, id, body);
    afterMutation(request.userId);
    return habit;
  });

  app.delete('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.habits.delete(request.userId, id);
    afterMutation(request.userId);
    reply.code(204).send();
  });
}
```

- [ ] **Step 4: Update `settings-routes.ts`**

Replace the contents of `packages/server/src/settings-routes.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@notreclaim/db';
import type { AppDeps, AfterMutation } from './app.js';
import { settingsSchema } from './schemas.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/settings', guard, async (request, reply) => {
    const settings = await deps.repos.settings.getByUserId(request.userId);
    if (!settings) {
      reply.code(404).send({ code: 'not_found', message: 'Settings not configured' });
      return;
    }
    return settings;
  });

  app.put('/settings', guard, async (request) => {
    const body = settingsSchema.parse(request.body);
    const settings = await deps.repos.settings.upsert(request.userId, {
      ...body,
      workingHours: body.workingHours as unknown as Prisma.InputJsonValue,
    });
    afterMutation(request.userId);
    return settings;
  });
}
```

- [ ] **Step 5: Update `test/fakes.ts` to inject + expose the bus**

In `packages/server/test/fakes.ts`:

1. Add imports at the top (after the existing imports):

```ts
import { createEventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';
```

2. Inside `buildTestApp`, after the `reconcileCalls` line, create the bus and capture buffer:

```ts
  const events = createEventBus();
  const emitted: ServerEvent[] = [];
  events.subscribe((e) => emitted.push(e));
```

3. In the `buildApp({ ... })` call, add `events,` to the deps object (e.g. right after the `reconcile:` property).

4. Change the return statement to expose them:

```ts
  return { app, tasks, habits, settings, reconcileCalls, emitted, events, FIXED_NOW };
```

- [ ] **Step 6: Run the full server suite to verify nothing regressed**

Run: `npm test -w @notreclaim/server`
Expected: PASS — all existing suites (auth, errors, tasks, habits, settings, schedule) plus the new events/connection-registry/replan/scheduler/ws suites are green.

- [ ] **Step 7: Typecheck the server package**

Run: `npm run build -w @notreclaim/server`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/task-routes.ts packages/server/src/habit-routes.ts packages/server/src/settings-routes.ts packages/server/test/fakes.ts
git commit -m "feat(server): wire event bus, /ws, and afterMutation hook into buildApp"
```

---

## Task 8: route tests — assert events + re-plan on mutation

**Files:**
- Modify: `packages/server/test/tasks.test.ts`
- Modify: `packages/server/test/habits.test.ts`
- Modify: `packages/server/test/settings.test.ts`

Note on determinism: `task.changed` is emitted synchronously inside `afterMutation`, and `deps.reconcile` is invoked synchronously when `replanAfterMutation` starts (before its first `await`). So both `emitted` and `reconcileCalls` are populated by the time `app.inject(...)` resolves — no flush needed. The deferred `schedule.updated` (after `reconcile` resolves) is covered by `replan.test.ts`, not here.

- [ ] **Step 1: Add task-mutation event tests**

Append these `it` blocks inside `describe('task routes', ...)` in `packages/server/test/tasks.test.ts` (reuses the existing `taskBody` const):

```ts
  it('emits task.changed (created) and triggers a re-plan on create', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({
      method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: taskBody,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'created' });
    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
  });

  it('emits task.changed (updated) on patch and (deleted) on delete', async () => {
    const { app, emitted } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const id = (await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody })).json().id;

    await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 4 } });
    await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });

    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'updated' });
    expect(emitted).toContainEqual({ type: 'task.changed', userId: 'u1', taskId: id, action: 'deleted' });
  });

  it('does not emit or re-plan on GET', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });

    expect(emitted).toEqual([]);
    expect(reconcileCalls).toEqual([]);
  });
```

- [ ] **Step 2: Add habit-mutation tests (re-plan, no task.changed)**

Append inside `describe('habit routes', ...)` in `packages/server/test/habits.test.ts` (reuses `habitBody`):

```ts
  it('triggers a re-plan but emits no task.changed on create', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({
      method: 'POST', url: '/habits', headers: { authorization: `Bearer ${token}` }, payload: habitBody,
    });
    expect(created.statusCode).toBe(201);

    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
    expect(emitted.some((e) => e.type === 'task.changed')).toBe(false);
  });
```

- [ ] **Step 3: Add settings-mutation test**

Append inside `describe('settings routes', ...)` in `packages/server/test/settings.test.ts` (reuses `settingsBody`):

```ts
  it('triggers a re-plan on settings upsert', async () => {
    const { app, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` }, payload: settingsBody,
    });

    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
  });
```

- [ ] **Step 4: Run the affected suites**

Run: `npm test -w @notreclaim/server -- tasks habits settings`
Expected: PASS, including the new mutation-event assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/server/test/tasks.test.ts packages/server/test/habits.test.ts packages/server/test/settings.test.ts
git commit -m "test(server): mutations emit task.changed and trigger re-plan"
```

---

## Task 9: `config.ts` + `server.ts` — production wiring

**Files:**
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/test/config.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing config test**

Create `packages/server/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
  it('defaults pollIntervalMs to 300000', () => {
    const cfg = loadServerConfig({ JWT_SECRET: 's' } as NodeJS.ProcessEnv);
    expect(cfg.pollIntervalMs).toBe(300000);
    expect(cfg.port).toBe(3000);
  });

  it('reads POLL_INTERVAL_MS from the environment', () => {
    const cfg = loadServerConfig({ JWT_SECRET: 's', POLL_INTERVAL_MS: '60000' } as NodeJS.ProcessEnv);
    expect(cfg.pollIntervalMs).toBe(60000);
  });

  it('rejects a non-positive POLL_INTERVAL_MS', () => {
    expect(() => loadServerConfig({ JWT_SECRET: 's', POLL_INTERVAL_MS: '0' } as NodeJS.ProcessEnv)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @notreclaim/server -- config`
Expected: FAIL — `pollIntervalMs` is `undefined`.

- [ ] **Step 3: Implement the config change**

Replace the contents of `packages/server/src/config.ts` with:

```ts
export interface ServerConfig {
  port: number;
  jwtSecret: string;
  pollIntervalMs: number;
}

/** Read and validate server-specific env (Google/encryption come from loadGoogleConfig). */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${env.PORT}`);
  const pollIntervalMs = env.POLL_INTERVAL_MS ? Number(env.POLL_INTERVAL_MS) : 300000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`Invalid POLL_INTERVAL_MS: ${env.POLL_INTERVAL_MS}`);
  }
  return { port, jwtSecret, pollIntervalMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @notreclaim/server -- config`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `server.ts` wiring**

Replace the contents of `packages/server/src/server.ts` with:

```ts
import {
  prisma,
  createUserRepository,
  createSettingsRepository,
  createTaskRepository,
  createHabitRepository,
  createScheduledBlockRepository,
  createCalendarEventRepository,
  createCalendarSyncStateRepository,
} from '@notreclaim/db';
import {
  createGoogleClient,
  createTokenService,
  reconcile,
  syncPrimaryCalendar,
  loadGoogleConfig,
} from '@notreclaim/google';
import { buildApp } from './app.js';
import { createEventBus } from './events.js';
import { pollAndReplan } from './replan.js';
import { startScheduler } from './scheduler.js';
import { loadServerConfig } from './config.js';

async function main(): Promise<void> {
  const serverConfig = loadServerConfig();
  const googleConfig = loadGoogleConfig();

  const client = createGoogleClient({ clientId: googleConfig.clientId, clientSecret: googleConfig.clientSecret });
  const users = createUserRepository(prisma);
  const tokens = createTokenService({ client, users, encryptionKey: googleConfig.encryptionKey });

  const settings = createSettingsRepository(prisma);
  const tasks = createTaskRepository(prisma);
  const habits = createHabitRepository(prisma);
  const scheduledBlocks = createScheduledBlockRepository(prisma);
  const calendarEvents = createCalendarEventRepository(prisma);
  const calendarSyncState = createCalendarSyncStateRepository(prisma);

  const schedulingRepos = { settings, calendarEvents, tasks, habits, scheduledBlocks };
  const bus = createEventBus();

  const reconcileBound = (userId: string, now: number) =>
    reconcile({ client, tokens, users, scheduledBlocks, schedulingRepos }, userId, now);
  const syncBound = (userId: string, now: number) =>
    syncPrimaryCalendar({ client, tokens, syncState: calendarSyncState, events: calendarEvents }, userId, now);

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: { client, tokens },
    schedulingRepos,
    reconcile: reconcileBound,
    events: bus,
    config: { jwtSecret: serverConfig.jwtSecret, googleRedirectUri: googleConfig.redirectUri },
  });

  await app.listen({ port: serverConfig.port, host: '0.0.0.0' });
  app.log.info(`NotReclaim server listening on :${serverConfig.port}`);

  const scheduler = startScheduler({
    listConnectedIds: () => users.listConnectedIds(),
    pollAndReplan: (userId) =>
      pollAndReplan(
        { sync: syncBound, reconcile: reconcileBound, bus, now: () => Date.now(), log: (err) => app.log.error(err) },
        userId,
      ),
    intervalMs: serverConfig.pollIntervalMs,
    log: (err) => app.log.error(err),
  });

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
```

- [ ] **Step 6: Typecheck the server package (server.ts is verified by build, not unit tests)**

Run: `npm run build -w @notreclaim/server`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/config.ts packages/server/test/config.test.ts packages/server/src/server.ts
git commit -m "feat(server): POLL_INTERVAL_MS config + production scheduler wiring"
```

---

## Task 10: public exports, optional WS smoke test, full verification

**Files:**
- Modify: `packages/server/src/index.ts`
- Test (optional): `packages/server/test/ws-smoke.test.ts`

- [ ] **Step 1: Update `index.ts` exports**

Replace the contents of `packages/server/src/index.ts` with:

```ts
export { buildApp } from './app.js';
export type { AppDeps, AfterMutation } from './app.js';
export { createEventBus } from './events.js';
export type { EventBus, ServerEvent } from './events.js';
export { createConnectionRegistry } from './connection-registry.js';
export type { ConnectionRegistry, Client } from './connection-registry.js';
export { replanAfterMutation, pollAndReplan } from './replan.js';
export type { ReplanDeps, PollDeps } from './replan.js';
export { runPollCycle, startScheduler } from './scheduler.js';
export type { PollCycleDeps, SchedulerDeps } from './scheduler.js';
export { parseWsAuth, registerWebSocket } from './ws.js';
export { loadServerConfig } from './config.js';
export type { ServerConfig } from './config.js';
export { mapDomainError } from './errors.js';
```

- [ ] **Step 2: Typecheck**

Run: `npm run build -w @notreclaim/server`
Expected: no TypeScript errors.

- [ ] **Step 3 (OPTIONAL): localhost WebSocket smoke test**

This step is optional — `parseWsAuth` already covers the auth logic deterministically. Implement it only if a real end-to-end handshake check is wanted; it uses a localhost socket (not external network). If you skip it, note that in the commit/PR.

Add the dev dependency:

```bash
npm install --save-dev -w @notreclaim/server ws@8.18.0 @types/ws@8.5.10
```

Create `packages/server/test/ws-smoke.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { buildTestApp, tokenFor } from './fakes.js';

type App = Awaited<ReturnType<typeof buildTestApp>>['app'];

const apps: App[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function listen() {
  const built = buildTestApp();
  apps.push(built.app);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { ...built, port };
}

describe('/ws (localhost smoke)', () => {
  it('a valid token connects and receives a forwarded event', async () => {
    const { app, events, port } = await listen();
    const token = await tokenFor(app, 'u1');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const received = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())));
    events.emit({ type: 'schedule.updated', userId: 'u1', counts: { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 } });
    const msg = JSON.parse(await received);

    expect(msg).toMatchObject({ type: 'schedule.updated', userId: 'u1' });
    ws.close();
  });

  it('a bad token is rejected (socket closes)', async () => {
    const { port } = await listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=garbage`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => {});
    });
    expect(code).toBe(1008);
  });
});
```

Run: `npm test -w @notreclaim/server -- ws-smoke`
Expected: PASS (2 tests).

- [ ] **Step 4: Run the entire monorepo test suite**

Ensure userspace Postgres is running (db tests), then run from the repo root:

Run: `npm test --workspaces --if-present`
Expected: PASS across all packages (scheduler, db, core, google, server). The server count grows by the events/connection-registry/replan/scheduler/ws/config suites and the new mutation-event assertions; the db count grows by the `listConnectedIds` test.

- [ ] **Step 5: Build the whole monorepo**

Run: `npm run build --workspaces --if-present`
Expected: no TypeScript errors in any package.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
# include the smoke test + lockfile only if Step 3 was done:
# git add packages/server/test/ws-smoke.test.ts packages/server/package.json package-lock.json
git commit -m "feat(server): public exports for realtime/background layer"
```

---

## Self-Review

**Spec coverage:**
- EventBus (`schedule.updated`/`sync.completed`/`task.changed`) → Task 2. ✅
- `/ws` JWT-authenticated handshake, per-user forwarding → Tasks 3 (registry), 6 (ws), 7 (wiring), 10 (smoke). ✅
- Immediate re-plan on mutation (+ `task.changed` for tasks; replan-only for habits/settings) → Tasks 4 (replan), 7 (hook + routes), 8 (assertions). ✅
- Always-on poll timer (`sync→reconcile` per connected user, emit `sync.completed`+`schedule.updated`) → Tasks 4 (pollAndReplan), 5 (runPollCycle/startScheduler), 9 (server wiring). ✅
- `UserRepository.listConnectedIds()` → Task 1. ✅
- `POLL_INTERVAL_MS` config (default 300000) → Task 9. ✅
- Error handling (swallow on mutation path, per-user isolation, dead-socket removal, bad-handshake close) → Tasks 4, 5, 3, 6. ✅
- Determinism / fakes / injected `now`; impurity confined to `startScheduler` + `server.ts` (build-only) → throughout. ✅
- Watch-channel webhook deferred → not implemented (matches spec Non-Goals). ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete code; the only optional step (Task 10 Step 3) is explicitly marked optional with rationale, not a placeholder.

**Type consistency:** `EventBus`/`ServerEvent` (Task 2) are consumed unchanged in Tasks 3, 4, 7, 10. `AfterMutation` (Task 7) signature matches its call sites in the three route files. `ReplanDeps`/`PollDeps` (Task 4) match the `pollAndReplan`/`replanAfterMutation` calls in `app.ts` and `server.ts`. `PollCycleDeps`/`SchedulerDeps` (Task 5) match the `startScheduler` call in `server.ts`. `syncPrimaryCalendar`'s `SyncDeps` field names (`client`/`tokens`/`syncState`/`events`-as-CalendarEventRepository) match the `syncBound` wiring in Task 9 (note: that `events` is the calendar-event repo, distinct from the `EventBus` named `bus`). `listConnectedIds` (Task 1) matches the `server.ts` call (Task 9).
