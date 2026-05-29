# NotReclaim HTTP API Implementation Plan (Milestone 4a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fastify HTTP API — JWT auth via Google Sign-In, REST CRUD for tasks/habits/settings, and schedule read/preview/replan — built on the existing libraries.

**Architecture:** A new `packages/server` whose `buildApp(deps)` factory takes all collaborators (repos, Google client/tokens, scheduling repos, a bound `reconcile`, config, and an injectable `now`) as dependencies, so every route is tested with Fastify `inject` against in-memory fakes (no DB, deterministic). A thin `server.ts` wires the real Prisma repos + Google adapter for production. Two deferred fixes land in their home packages.

**Tech Stack:** TypeScript (ESM, strict, `.js` import extensions), Fastify, `@fastify/jwt`, Zod, Vitest, npm workspaces.

---

## Conventions

- Route tests use Fastify `inject` + injected fakes; mint test JWTs with `app.jwt.sign({ sub })` after `await app.ready()`. No DB, no network.
- `now` is injected (`deps.now`, default `Date.now`) — the server is the one place real wall-clock time legitimately enters; tests pass a fixed `now`.
- Domain errors come from the libraries: `NotFoundError`/`ConflictError` (`@notreclaim/db`), `SettingsRequiredError` (`@notreclaim/core`), `GoogleNotConnectedError`/`GoogleApiError` (`@notreclaim/google`).
- Build order for Task 1: db → google (the delete-scoping signature change spans both).

## File Structure

```
packages/google/src/token-service.ts                       # MODIFY: skew margin
packages/google/test/token-service.test.ts                 # MODIFY: realistic expiry
packages/db/src/repositories/calendar-event-repository.ts  # MODIFY: deleteByGoogleEventIds + calendarId
packages/db/test/repositories/calendar-event-repository.test.ts # MODIFY
packages/google/src/sync.ts                                # MODIFY: pass 'primary' to delete
packages/google/test/fakes.ts                              # MODIFY: fakeEventsRepo delete signature
packages/server/
  package.json  tsconfig.json  vitest.config.ts
  src/
    config.ts errors.ts app.ts schemas.ts
    auth-routes.ts task-routes.ts habit-routes.ts settings-routes.ts schedule-routes.ts
    server.ts index.ts
  test/
    fakes.ts auth.test.ts tasks.test.ts habits.test.ts settings.test.ts schedule.test.ts errors.test.ts
```

---

### Task 1: Two deferred fixes (`@notreclaim/google` skew, `@notreclaim/db` delete-scoping)

**Files:**
- Modify: `packages/google/src/token-service.ts`, `packages/google/test/token-service.test.ts`
- Modify: `packages/db/src/repositories/calendar-event-repository.ts`, `packages/db/test/repositories/calendar-event-repository.test.ts`
- Modify: `packages/google/src/sync.ts`, `packages/google/test/fakes.ts`

- [ ] **Step 1 (skew, TDD): update the token-service caching test.** In `packages/google/test/token-service.test.ts`, replace the body of the `it('getAccessToken refreshes, caches, and re-refreshes after expiry', ...)` test with realistic expiry values that exercise the 60s skew:
```ts
    const client = new FakeGoogleClient();
    client.refreshResponses = [
      { accessToken: 'a1', expiresAt: 3_600_000 },
      { accessToken: 'a2', expiresAt: 7_200_000 },
    ];
    const users = fakeUserRepo([makeUser({ id: 'u1', googleId: 'g-123' })]);
    const svc = createTokenService({ client, users, encryptionKey: key });
    await users.update('u1', { googleRefreshToken: encryptToken('refresh-1', key) });

    expect(await svc.getAccessToken('u1', 1000)).toBe('a1');
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 2000)).toBe('a1'); // cached (well before expiry - skew)
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 3_600_000)).toBe('a2'); // within 60s skew of expiry -> refresh
    expect(client.refreshCalls).toBe(2);
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/token-service.test.ts`
Expected: FAIL — the third call still returns `'a1'` (no skew yet).

- [ ] **Step 3: Add the skew margin in `packages/google/src/token-service.ts`.** Add a module constant near the top:
```ts
const TOKEN_SKEW_MS = 60_000;
```
and change the cache hit check in `getAccessToken` from `if (cached && cached.expiresAt > now)` to:
```ts
      if (cached && cached.expiresAt - TOKEN_SKEW_MS > now) {
        return cached.accessToken;
      }
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/token-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5 (delete-scoping, TDD): update db tests.** In `packages/db/test/repositories/calendar-event-repository.test.ts`, find the existing `deleteByGoogleEventIds` test and change its call to pass a calendar id, and add a scoping test. Replace the existing delete test with:
```ts
  it('deletes events by googleEventId scoped to user and calendar', async () => {
    const user = await users.create({ email: 'c3@example.com' });
    await repo.upsertMany(user.id, [
      event({ googleCalendarId: 'primary', googleEventId: 'g1' }),
      event({ googleCalendarId: 'primary', googleEventId: 'g2' }),
      event({ googleCalendarId: 'other', googleEventId: 'g1' }),
    ]);
    await repo.deleteByGoogleEventIds(user.id, 'primary', ['g1']);
    const all = await repo.listByUserInRange(
      user.id, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'),
    );
    // only primary/g1 removed; other/g1 and primary/g2 remain
    expect(all.map((e) => `${e.googleCalendarId}:${e.googleEventId}`).sort())
      .toEqual(['other:g1', 'primary:g2']);
  });
```
(The `event(over)` factory defaults `startsAt`/`endsAt` into 2026-01-01; all three rows fall in the listed range. If the file lacks a 3-arg-friendly `event` factory, it already spreads `over`, so the `googleCalendarId`/`googleEventId` overrides work.)

- [ ] **Step 6: Run to verify failure.**
Run: `cd packages/db && npx vitest run test/repositories/calendar-event-repository.test.ts`
Expected: FAIL — `deleteByGoogleEventIds` takes 2 args, not 3 (type error / wrong deletion).

- [ ] **Step 7: Update the repo method** in `packages/db/src/repositories/calendar-event-repository.ts`:
```ts
    async deleteByGoogleEventIds(
      userId: string,
      googleCalendarId: string,
      googleEventIds: string[],
    ): Promise<void> {
      await prisma.calendarEvent.deleteMany({
        where: { userId, googleCalendarId, googleEventId: { in: googleEventIds } },
      });
    },
```

- [ ] **Step 8: Run db test + rebuild db.**
Run: `cd packages/db && npx vitest run test/repositories/calendar-event-repository.test.ts && npm run build`
Expected: PASS; build clean.

- [ ] **Step 9: Update the google caller + its fake.** In `packages/google/src/sync.ts`, change the delete call to pass the calendar id:
```ts
  if (toDelete.length > 0) await deps.events.deleteByGoogleEventIds(userId, PRIMARY, toDelete);
```
In `packages/google/test/fakes.ts`, update `fakeEventsRepo`'s method signature to match (keep recording the ids):
```ts
    async deleteByGoogleEventIds(_userId: string, _googleCalendarId: string, ids: string[]): Promise<void> {
      deleted.push(ids);
    },
```

- [ ] **Step 10: Run google suite + rebuild google.**
Run: `cd packages/google && npx vitest run && npm run build`
Expected: all google tests pass (the sync incremental-delete test still asserts `deleted[0] === ['e9']`); build clean.

- [ ] **Step 11: Commit (two commits).**
```bash
git add packages/google/src/token-service.ts packages/google/test/token-service.test.ts
git commit -m "fix(google): add 60s skew margin to access-token cache"
git add packages/db/src/repositories/calendar-event-repository.ts packages/db/test/repositories/calendar-event-repository.test.ts packages/google/src/sync.ts packages/google/test/fakes.ts
git commit -m "fix(db,google): scope deleteByGoogleEventIds by calendar id"
```

---

### Task 2: Scaffold `packages/server` (config + error mapping)

**Files:**
- Create: `packages/server/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/errors.ts`, `test/errors.test.ts`

- [ ] **Step 1: Create `packages/server/package.json`**
```json
{
  "name": "@notreclaim/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@notreclaim/db": "*",
    "@notreclaim/core": "*",
    "@notreclaim/google": "*",
    "fastify": "^4.28.0",
    "@fastify/jwt": "^8.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/server/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/server/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: Create `packages/server/src/config.ts`**
```ts
export interface ServerConfig {
  port: number;
  jwtSecret: string;
}

/** Read and validate server-specific env (Google/encryption come from loadGoogleConfig). */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${env.PORT}`);
  return { port, jwtSecret };
}
```

- [ ] **Step 5: Write the failing test `packages/server/test/errors.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { ZodError, z } from 'zod';
import { NotFoundError, ConflictError } from '@notreclaim/db';
import { SettingsRequiredError } from '@notreclaim/core';
import { GoogleNotConnectedError, GoogleApiError } from '@notreclaim/google';
import { mapDomainError } from '../src/errors.js';

describe('mapDomainError', () => {
  it('maps domain errors to HTTP statuses', () => {
    expect(mapDomainError(new NotFoundError('x')).status).toBe(404);
    expect(mapDomainError(new ConflictError('x')).status).toBe(409);
    expect(mapDomainError(new SettingsRequiredError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleNotConnectedError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleApiError(500, 'boom')).status).toBe(502);
    let zerr: unknown;
    try { z.object({ a: z.string() }).parse({}); } catch (e) { zerr = e; }
    expect(zerr).toBeInstanceOf(ZodError);
    expect(mapDomainError(zerr).status).toBe(400);
    expect(mapDomainError(new Error('other')).status).toBe(500);
  });
});
```

- [ ] **Step 6: Run to verify failure.**
Run: `cd packages/server && npx vitest run test/errors.test.ts`
Expected: FAIL — module not found (deps must install first; see Step 8 if resolution errors).

- [ ] **Step 7: Create `packages/server/src/errors.ts`**
```ts
import { ZodError } from 'zod';
import { NotFoundError, ConflictError } from '@notreclaim/db';
import { SettingsRequiredError } from '@notreclaim/core';
import { GoogleNotConnectedError, GoogleApiError } from '@notreclaim/google';

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

/** Map any thrown value to an HTTP status + safe code/message. */
export function mapDomainError(error: unknown): MappedError {
  if (error instanceof ZodError) {
    return { status: 400, code: 'validation_error', message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'not_found', message: error.message };
  }
  if (error instanceof ConflictError) {
    return { status: 409, code: 'conflict', message: error.message };
  }
  if (error instanceof SettingsRequiredError) {
    return { status: 409, code: 'settings_required', message: error.message };
  }
  if (error instanceof GoogleNotConnectedError) {
    return { status: 409, code: 'google_not_connected', message: error.message };
  }
  if (error instanceof GoogleApiError) {
    return { status: 502, code: 'google_api_error', message: error.message };
  }
  return { status: 500, code: 'internal_error', message: 'Internal Server Error' };
}
```

- [ ] **Step 8: Install deps + build prerequisites + run the test.**
Run: `npm install`
Then: `npm run build -w @notreclaim/scheduler && npm run build -w @notreclaim/db && npm run build -w @notreclaim/core && npm run build -w @notreclaim/google`
Then: `cd packages/server && npx vitest run test/errors.test.ts`
Expected: deps installed; prerequisite builds clean; errors test PASS (1).

- [ ] **Step 9: Commit.**
```bash
git add packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts packages/server/src/config.ts packages/server/src/errors.ts packages/server/test/errors.test.ts package-lock.json
git commit -m "chore(server): scaffold @notreclaim/server with config + error mapping"
```

---

### Task 3: App factory, auth, and test harness

**Files:**
- Create: `packages/server/src/app.ts`, `packages/server/src/auth-routes.ts`, `packages/server/src/schemas.ts`
- Create: `packages/server/test/fakes.ts`, `packages/server/test/auth.test.ts`

- [ ] **Step 1: Create `packages/server/src/schemas.ts`** (Zod schemas used across routes)
```ts
import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().min(1) });

export const authCallbackQuerySchema = z.object({ code: z.string().min(1) });

export const createTaskSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  durationMs: z.number().int().positive(),
  dueBy: z.string().datetime(),
  minChunkMs: z.number().int().positive(),
  maxChunkMs: z.number().int().positive(),
  category: z.string().nullable().optional(),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived']).optional(),
  timeLoggedMs: z.number().int().nonnegative().optional(),
});
export const listTasksQuerySchema = z.object({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived']).optional(),
});

export const createHabitSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  chunkMs: z.number().int().positive(),
  perPeriod: z.number().int().positive(),
  eligibleDays: z.array(z.number().int().min(0).max(6)),
  periodType: z.enum(['week']).optional(),
  preferredStartMinute: z.number().int().nullable().optional(),
  preferredEndMinute: z.number().int().nullable().optional(),
});
export const updateHabitSchema = createHabitSchema.partial().extend({
  status: z.enum(['active', 'paused']).optional(),
});

export const settingsSchema = z.object({
  timezone: z.string().min(1),
  workingHours: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMinute: z.number().int(),
      endMinute: z.number().int(),
    }),
  ),
  horizonDays: z.number().int().positive().optional(),
  defaultMinChunkMs: z.number().int().positive(),
  defaultMaxChunkMs: z.number().int().positive(),
});

export const rangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
```

- [ ] **Step 2: Create `packages/server/src/app.ts`** (factory, JWT, auth guard, error handler, deps type)
```ts
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type {
  SettingsRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
} from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import type { GoogleClient, TokenService, ReconcileResult } from '@notreclaim/google';
import { mapDomainError } from './errors.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerTaskRoutes } from './task-routes.js';
import { registerHabitRoutes } from './habit-routes.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { registerScheduleRoutes } from './schedule-routes.js';

export interface AppDeps {
  repos: {
    settings: SettingsRepository;
    tasks: TaskRepository;
    habits: HabitRepository;
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
  };
  google: {
    client: Pick<GoogleClient, 'getConsentUrl'>;
    tokens: Pick<TokenService, 'connectFromCode'>;
  };
  schedulingRepos: SchedulingRepositories;
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  config: { jwtSecret: string; googleRedirectUri: string };
  now: () => number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export function buildApp(input: Omit<AppDeps, 'now'> & { now?: () => number }): FastifyInstance {
  const deps: AppDeps = { ...input, now: input.now ?? (() => Date.now()) };
  const app = Fastify({ logger: false });

  app.register(fastifyJwt, { secret: deps.config.jwtSecret });
  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      request.userId = payload.sub;
    } catch {
      reply.code(401).send({ code: 'unauthorized', message: 'Invalid or missing token' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapDomainError(error);
    if (mapped.status === 500) app.log.error(error);
    reply.code(mapped.status).send({ code: mapped.code, message: mapped.message });
  });

  registerAuthRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerHabitRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerScheduleRoutes(app, deps);

  return app;
}
```

- [ ] **Step 3: Create `packages/server/src/auth-routes.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema } from './schemas.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/auth/google', async () => {
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri) };
  });

  app.get('/auth/google/callback', async (request) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = app.jwt.sign({ sub: user.id });
    return { token, userId: user.id };
  });
}
```

- [ ] **Step 4: Create the test harness `packages/server/test/fakes.ts`** (stateful in-memory repos + buildTestApp)
```ts
import type { Settings, Task, Habit, ScheduledBlock, User } from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import { buildApp, type AppDeps } from '../src/app.js';

const FIXED_NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

export function fakeTaskRepo(seed: Task[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Task => ({
    id: `task-${++n}`, userId, title: '', priority: 1, durationMs: 0,
    dueBy: new Date(0), minChunkMs: 0, maxChunkMs: 0, category: null,
    status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
    ...data,
  }) as Task;
  return {
    async create(userId: string, data: Record<string, unknown>): Promise<Task> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<Task | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string, opts: { status?: string } = {}): Promise<Task[]> {
      return rows.filter((r) => r.userId === userId && (!opts.status || r.status === opts.status));
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Task> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${id}`); }
    },
  };
}

export function fakeHabitRepo(seed: Habit[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Habit => ({
    id: `habit-${++n}`, userId, title: '', priority: 1, chunkMs: 0, perPeriod: 1,
    periodType: 'week', preferredStartMinute: null, preferredEndMinute: null,
    eligibleDays: [], status: 'active', createdAt: new Date(0), updatedAt: new Date(0),
    ...data,
  }) as Habit;
  return {
    async create(userId: string, data: Record<string, unknown>): Promise<Habit> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<Habit | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string): Promise<Habit[]> {
      return rows.filter((r) => r.userId === userId);
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Habit> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Habit ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Habit ${id}`); }
    },
  };
}

export function fakeSettingsRepo(seed: Settings | null = null) {
  let row = seed;
  return {
    async getByUserId(userId: string): Promise<Settings | null> {
      return row && row.userId === userId ? row : null;
    },
    async upsert(userId: string, data: Record<string, unknown>): Promise<Settings> {
      row = {
        id: 'settings-1', userId, timezone: 'utc', workingHours: [], horizonDays: 14,
        defaultMinChunkMs: 0, defaultMaxChunkMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
        ...data,
      } as Settings;
      return row;
    },
  };
}

export function fakeScheduledBlockRepo(seed: ScheduledBlock[] = []) {
  return {
    async listByUserInRange(userId: string): Promise<ScheduledBlock[]> {
      return seed.filter((b) => b.userId === userId);
    },
  };
}

export interface TestAppOptions {
  tasks?: Task[];
  habits?: Habit[];
  settings?: Settings | null;
  blocks?: ScheduledBlock[];
  connectUser?: User;
  reconcileResult?: AppDeps['reconcile'] extends (...a: never[]) => Promise<infer R> ? R : never;
  schedulingReposOverride?: SchedulingRepositories;
}

export function buildTestApp(opts: TestAppOptions = {}) {
  const tasks = fakeTaskRepo(opts.tasks ?? []);
  const habits = fakeHabitRepo(opts.habits ?? []);
  const settings = fakeSettingsRepo(opts.settings ?? null);
  const scheduledBlocks = fakeScheduledBlockRepo(opts.blocks ?? []);
  const reconcileCalls: Array<{ userId: string; now: number }> = [];

  const schedulingRepos: SchedulingRepositories = opts.schedulingReposOverride ?? {
    settings,
    calendarEvents: { listByUserInRange: async () => [] },
    tasks,
    habits,
    scheduledBlocks,
  };

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: {
      client: { getConsentUrl: () => 'https://consent.example/auth' },
      tokens: {
        connectFromCode: async () =>
          opts.connectUser ?? ({
            id: 'u1', email: 'a@example.com', googleId: 'g-1', googleRefreshToken: 'enc',
            autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0),
          } as User),
      },
    },
    schedulingRepos,
    reconcile: async (userId, now) => {
      reconcileCalls.push({ userId, now });
      return opts.reconcileResult ?? { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 };
    },
    config: { jwtSecret: 'test-secret', googleRedirectUri: 'http://localhost:3000/auth/google/callback' },
    now: () => FIXED_NOW,
  });

  return { app, tasks, habits, settings, reconcileCalls, FIXED_NOW };
}

export async function tokenFor(app: Awaited<ReturnType<typeof buildTestApp>>['app'], userId = 'u1'): Promise<string> {
  await app.ready();
  return app.jwt.sign({ sub: userId });
}
```

- [ ] **Step 5: Write the failing test `packages/server/test/auth.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

describe('auth', () => {
  it('returns a consent URL', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('consent.example');
  });

  it('callback exchanges a code for a JWT', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe('u1');
    expect(typeof res.json().token).toBe('string');
  });

  it('callback without a code is a 400', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback' });
    expect(res.statusCode).toBe(400);
  });

  it('a protected route rejects a missing token with 401', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('a protected route accepts a valid token', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 6: Create placeholder route registrars so the app compiles.** Create `packages/server/src/task-routes.ts`, `habit-routes.ts`, `settings-routes.ts`, `schedule-routes.ts`, each exporting an empty registrar for now (filled in Tasks 4–5). For each file (substitute the name):
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';

export function registerTaskRoutes(_app: FastifyInstance, _deps: AppDeps): void {}
```
Use the matching export names: `registerTaskRoutes`, `registerHabitRoutes`, `registerSettingsRoutes`, `registerScheduleRoutes`. (The `GET /tasks` auth tests in Step 5 will 401/200 even with an empty registrar because `authenticate` runs as the route's `onRequest`… but an empty registrar means `/tasks` doesn't exist → 404, not 200/401. So Task 3's auth test needs a real `/tasks`. To avoid a circular dependency, implement the minimal `GET /tasks` now and flesh out the rest in Task 4.) Replace `task-routes.ts` with:
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { listTasksQuerySchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/tasks', { onRequest: [app.authenticate] }, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    return deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
  });
}
```

- [ ] **Step 7: Run to verify failure, then pass.**
Run: `cd packages/server && npx vitest run test/auth.test.ts`
Expected: initially FAIL (modules missing) → after Steps 1–6 exist, PASS (5 tests).

- [ ] **Step 8: Type-check.**
Run: `cd packages/server && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

- [ ] **Step 9: Commit.**
```bash
git add packages/server/src/app.ts packages/server/src/auth-routes.ts packages/server/src/schemas.ts packages/server/src/task-routes.ts packages/server/src/habit-routes.ts packages/server/src/settings-routes.ts packages/server/src/schedule-routes.ts packages/server/test/fakes.ts packages/server/test/auth.test.ts
git commit -m "feat(server): app factory, JWT auth, Google sign-in, error handler"
```

---

### Task 4: Tasks, habits, settings CRUD routes

**Files:**
- Modify: `packages/server/src/task-routes.ts`, create `habit-routes.ts`, `settings-routes.ts` (full)
- Test: `packages/server/test/tasks.test.ts`, `habits.test.ts`, `settings.test.ts`

- [ ] **Step 1: Write `packages/server/test/tasks.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const taskBody = {
  title: 'Write report', priority: 1, durationMs: 3600000,
  dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000,
};

describe('task routes', () => {
  it('creates, fetches, lists, updates, and deletes a task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload: taskBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const got = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe('Write report');

    const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth });
    expect(list.json()).toHaveLength(1);

    const patched = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { priority: 5 } });
    expect(patched.json().priority).toBe(5);

    const del = await app.inject({ method: 'DELETE', url: `/tasks/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it('returns 404 for a missing task', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid body with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${token}` }, payload: { title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('scopes tasks by user', async () => {
    const { app } = buildTestApp();
    const tokenA = await tokenFor(app, 'userA');
    const tokenB = await tokenFor(app, 'userB');
    const created = await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: `Bearer ${tokenA}` }, payload: taskBody });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/server && npx vitest run test/tasks.test.ts`
Expected: FAIL — only `GET /tasks` exists so far.

- [ ] **Step 3: Replace `packages/server/src/task-routes.ts` with the full CRUD set**
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { createTaskSchema, updateTaskSchema, listTasksQuerySchema, idParamSchema } from './schemas.js';

export function registerTaskRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/tasks', guard, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const task = await deps.repos.tasks.create(request.userId, { ...body, dueBy: new Date(body.dueBy) });
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
    const body = updateTaskSchema.parse(request.body);
    const data = { ...body, ...(body.dueBy ? { dueBy: new Date(body.dueBy) } : {}) };
    return deps.repos.tasks.update(request.userId, id, data);
  });

  app.delete('/tasks/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.tasks.delete(request.userId, id);
    reply.code(204).send();
  });
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/server && npx vitest run test/tasks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `packages/server/src/habit-routes.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { createHabitSchema, updateHabitSchema, idParamSchema } from './schemas.js';

export function registerHabitRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.post('/habits', guard, async (request, reply) => {
    const body = createHabitSchema.parse(request.body);
    const habit = await deps.repos.habits.create(request.userId, body);
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
    return deps.repos.habits.update(request.userId, id, body);
  });

  app.delete('/habits/:id', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await deps.repos.habits.delete(request.userId, id);
    reply.code(204).send();
  });
}
```

- [ ] **Step 6: Write `packages/server/src/settings-routes.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@notreclaim/db';
import type { AppDeps } from './app.js';
import { settingsSchema } from './schemas.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
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
    return deps.repos.settings.upsert(request.userId, {
      ...body,
      workingHours: body.workingHours as unknown as Prisma.InputJsonValue,
    });
  });
}
```

- [ ] **Step 7: Write `packages/server/test/habits.test.ts` and `packages/server/test/settings.test.ts`**

`habits.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const habitBody = { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] };

describe('habit routes', () => {
  it('creates and lists habits', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: habitBody });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/habits', headers: auth });
    expect(list.json()).toHaveLength(1);
  });

  it('404 for a missing habit and 401 without a token', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'GET', url: '/habits/nope', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/habits' })).statusCode).toBe(401);
  });
});
```

`settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const settingsBody = {
  timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000,
};

describe('settings routes', () => {
  it('404 before configured, then upsert + get', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: settingsBody });
    expect(put.statusCode).toBe(200);
    expect(put.json().timezone).toBe('America/New_York');
    const got = await app.inject({ method: 'GET', url: '/settings', headers: auth });
    expect(got.statusCode).toBe(200);
  });
});
```

- [ ] **Step 8: Run the suite.**
Run: `cd packages/server && npx vitest run test/tasks.test.ts test/habits.test.ts test/settings.test.ts`
Expected: PASS (tasks 4, habits 2, settings 1).

- [ ] **Step 9: Commit.**
```bash
git add packages/server/src/task-routes.ts packages/server/src/habit-routes.ts packages/server/src/settings-routes.ts packages/server/test/tasks.test.ts packages/server/test/habits.test.ts packages/server/test/settings.test.ts
git commit -m "feat(server): tasks/habits/settings CRUD routes"
```

---

### Task 5: Schedule routes (read / preview / replan)

**Files:**
- Modify: `packages/server/src/schedule-routes.ts`
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Write `packages/server/test/schedule.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import type { ScheduledBlock, Settings } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'Focus',
    startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0',
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}
function settings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1', userId: 'u1', timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
    horizonDays: 1, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 1800000,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}

describe('schedule routes', () => {
  it('GET /schedule returns persisted blocks in the default range', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/schedule', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('GET /schedule/preview returns desired blocks + unscheduled', async () => {
    const { app } = buildTestApp({
      settings: settings(),
      tasks: [{
        id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1800000,
        dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1800000, maxChunkMs: 1800000,
        category: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
      }],
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/schedule/preview', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('blocks');
    expect(res.json()).toHaveProperty('unscheduled');
    expect(res.json().blocks.length).toBeGreaterThan(0);
  });

  it('POST /schedule/replan invokes reconcile and returns counts', async () => {
    const { app, reconcileCalls } = buildTestApp({ reconcileResult: { created: 2, updated: 1, deleted: 0, pinned: 0, removed: 0 } });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(2);
    expect(reconcileCalls).toHaveLength(1);
    expect(reconcileCalls[0]!.userId).toBe('u1');
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/server && npx vitest run test/schedule.test.ts`
Expected: FAIL — schedule routes are empty registrars.

- [ ] **Step 3: Write `packages/server/src/schedule-routes.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule } from '@notreclaim/core';
import type { AppDeps } from './app.js';
import { rangeQuerySchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/schedule', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const start = query.from ? new Date(query.from) : new Date(deps.now());
    let end: Date;
    if (query.to) {
      end = new Date(query.to);
    } else {
      const settings = await deps.repos.settings.getByUserId(request.userId);
      const horizonDays = settings?.horizonDays ?? 14;
      end = new Date(deps.now() + horizonDays * MS_PER_DAY);
    }
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });

  app.get('/schedule/preview', guard, async (request) => {
    return computeDesiredSchedule(deps.schedulingRepos, request.userId, deps.now());
  });

  app.post('/schedule/replan', guard, async (request) => {
    return deps.reconcile(request.userId, deps.now());
  });
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/server && npx vitest run test/schedule.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add packages/server/src/schedule-routes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): schedule read/preview/replan routes"
```

---

### Task 6: Production entrypoint, exports, full verification

**Files:**
- Create: `packages/server/src/server.ts`, `packages/server/src/index.ts`

- [ ] **Step 1: Create `packages/server/src/index.ts`**
```ts
export { buildApp } from './app.js';
export type { AppDeps } from './app.js';
export { loadServerConfig } from './config.js';
export type { ServerConfig } from './config.js';
export { mapDomainError } from './errors.js';
```

- [ ] **Step 2: Create `packages/server/src/server.ts`** (real wiring; build/typecheck only — not run in tests)
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
  loadGoogleConfig,
} from '@notreclaim/google';
import { buildApp } from './app.js';
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

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: { client, tokens },
    schedulingRepos,
    reconcile: (userId, now) =>
      reconcile({ client, tokens, users, scheduledBlocks, schedulingRepos }, userId, now),
    config: { jwtSecret: serverConfig.jwtSecret, googleRedirectUri: googleConfig.redirectUri },
  });

  await app.listen({ port: serverConfig.port, host: '0.0.0.0' });
  app.log.info(`NotReclaim server listening on :${serverConfig.port}`);
}

void main();
```

- [ ] **Step 3: Type-check + build the server.**
Run: `cd packages/server && npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: zero errors; `dist/index.js`, `dist/server.js` exist. (If `reconcile`'s deps shape differs from the call here, adjust to match the exported `ReconcileDeps`.)

- [ ] **Step 4: Run the server suite.**
Run: `cd packages/server && npx vitest run`
Expected: PASS — errors 1, auth 5, tasks 4, habits 2, settings 1, schedule 3 = 16 tests.

- [ ] **Step 5: Run the whole monorepo (Postgres running).**
Run: `cd /home/nyx-ai/Projects/NotReclaim && npm test`
Expected: all green — scheduler 31, db 34/35, core 27, google 33, server 16 (confirm actual counts; gate is all-green).

- [ ] **Step 6: Commit.**
```bash
git add packages/server/src/server.ts packages/server/src/index.ts
git commit -m "feat(server): production entrypoint and public exports"
```

---

## Self-Review Notes

- **Spec coverage:** deferred fixes — skew (Task 1 Steps 1–4), delete-scoping (Task 1 Steps 5–11) · package scaffold + config + error mapping (Task 2) · `buildApp(deps)` factory + `@fastify/jwt` + `requireAuth` + central error handler + Google Sign-In (Task 3) · tasks/habits/settings CRUD, user-scoped, Zod-validated, 404/409/400 mapping (Task 4) · schedule read/preview/replan (Task 5) · production entrypoint + exports + full verify (Task 6). Non-goals (WebSocket, webhook, timer) absent.
- **Type consistency:** `AppDeps` (app.ts) is consumed identically by every route registrar (`registerXRoutes(app, deps)`); `deps.now()` used in schedule routes; `request.userId` set by `authenticate` and read everywhere; error classes imported as runtime values from their home packages for `mapDomainError`.
- **Auth in tests:** `app.jwt.sign({ sub })` after `await app.ready()` mints test tokens without extra libs; the `now` injection keeps `/schedule/preview` deterministic.
- **Cross-package build order:** Task 1 rebuilds db then google; Task 2 builds all four libraries so the server resolves their types; route tests need no DB (injected fakes). `server.ts` real wiring is typecheck/build-only.
- **Known acceptable nuance:** importing the domain error classes pulls `@notreclaim/db`'s index, which constructs a (lazy, unconnected) `PrismaClient`; harmless in tests since fakes are used and no query runs.
```
