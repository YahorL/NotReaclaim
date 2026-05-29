# NotReclaim Write-back + Reconcile Implementation Plan (Milestone 3b-ii)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the engine's desired schedule to a dedicated Google calendar and keep DB↔Google in sync via a reconcile loop (drift → compute → keyed in-place diff), with user edits becoming pins.

**Architecture:** `@notreclaim/google` gains a dependency on `@notreclaim/core` and houses the write-back, drift detection, and reconcile orchestrator. The `GoogleClient` interface is extended with write methods so all logic stays testable against the fake. One small `@notreclaim/db` migration adds a diff key (`ScheduledBlock.engineKey`) and the dedicated-calendar id (`User.autoScheduledCalendarId`).

**Tech Stack:** TypeScript (ESM, strict, `.js` import extensions), Prisma/Postgres, Vitest, npm workspaces.

---

## Prerequisites & conventions

- Task 1 (db) needs the running userspace Postgres. Tasks 2–8 (`@notreclaim/google`) need no DB and no Google credentials — all logic is tested against `FakeGoogleClient` + injected fake repos.
- The reconcile tests use a **stateful** in-memory `ScheduledBlock` store shared between `deps.scheduledBlocks` and `schedulingRepos.scheduledBlocks`, so drift mutations are visible to `computeDesiredSchedule` (this mirrors production, where both are the same Prisma-backed repo).
- `now` is injected everywhere; no `Date.now`/`Math.random`.
- The engine echoes pinned blocks with their **DB-uuid id**; fresh placements have `source:id:index` ids — the orchestrator filters on that.

## File Structure

```
packages/db/prisma/schema.prisma                          # MODIFY: User.autoScheduledCalendarId, ScheduledBlock.engineKey + @@unique
packages/db/src/repositories/scheduled-block-repository.ts # MODIFY: engineKey on CreateScheduledBlockInput; add update()
packages/db/src/repositories/user-repository.ts            # MODIFY: autoScheduledCalendarId on UpdateUserInput
packages/db/test/repositories/scheduled-block-repository.test.ts # MODIFY: update + engineKey tests
packages/google/package.json                               # MODIFY: add @notreclaim/core dep
packages/google/src/client.ts                              # MODIFY: GoogleEventWrite, timeMax, write methods
packages/google/src/google-client.ts                       # MODIFY: real adapter write methods + timeMax
packages/google/src/writeback.ts                           # NEW: toGoogleEventWrite
packages/google/src/ensure-calendar.ts                     # NEW: ensureAutoScheduledCalendar
packages/google/src/detect-drift.ts                        # NEW: detectDrift
packages/google/src/reconcile.ts                           # NEW: reconcile orchestrator
packages/google/src/index.ts                               # MODIFY: export new symbols
packages/google/test/fakes.ts                              # MODIFY: write recorders, block store, scheduling repos
packages/google/test/writeback.test.ts                     # NEW
packages/google/test/ensure-calendar.test.ts               # NEW
packages/google/test/detect-drift.test.ts                  # NEW
packages/google/test/reconcile.test.ts                     # NEW
```

---

### Task 1: `@notreclaim/db` — diff key, calendar id, `update`

**Requires Postgres.**

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/repositories/scheduled-block-repository.ts`
- Modify: `packages/db/src/repositories/user-repository.ts`
- Modify: `packages/db/test/repositories/scheduled-block-repository.test.ts`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`.**
(a) Add to the `User` model (after `googleRefreshToken`):
```prisma
  autoScheduledCalendarId String?
```
(b) In the `ScheduledBlock` model, add the `engineKey` field (after `googleCalendarId`) and a unique constraint (after the relations / alongside the existing block — place the `@@unique` at the end of the model body):
```prisma
  engineKey        String?
```
and add this line just before the model's closing brace:
```prisma
  @@unique([userId, engineKey])
```

- [ ] **Step 2: Create and apply the migration.**
Run: `cd packages/db && npx prisma migrate dev --name writeback_reconcile_fields`
Expected: migration created + applied; "Your database is now in sync."

- [ ] **Step 3: Add `autoScheduledCalendarId` to `UpdateUserInput`** in `packages/db/src/repositories/user-repository.ts`:
```ts
export interface UpdateUserInput {
  email?: string;
  googleId?: string | null;
  googleRefreshToken?: string | null;
  autoScheduledCalendarId?: string | null;
}
```

- [ ] **Step 4: Write failing tests.** Append to `packages/db/test/repositories/scheduled-block-repository.test.ts` inside the existing `describe('ScheduledBlockRepository', ...)` block:
```ts
  it('update mutates fields and is user-scoped', async () => {
    const user = await users.create({ email: 'upd@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const block = await repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' }));
    const updated = await repo.update(user.id, block.id, {
      startsAt: new Date('2026-02-01T08:00:00.000Z'),
      endsAt: new Date('2026-02-01T08:30:00.000Z'),
      pinned: true,
      googleEventId: 'gev-1',
    });
    expect(updated.pinned).toBe(true);
    expect(updated.googleEventId).toBe('gev-1');
    expect(updated.startsAt.toISOString()).toBe('2026-02-01T08:00:00.000Z');

    const other = await users.create({ email: 'upd2@example.com' });
    await expect(repo.update(other.id, block.id, { pinned: false })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('enforces unique (userId, engineKey) but allows multiple nulls', async () => {
    const user = await users.create({ email: 'key@example.com' });
    const task = await tasks.create(user.id, taskInput());
    await repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' }));
    await expect(
      repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' })),
    ).rejects.toBeInstanceOf(ConflictError);
    // multiple null engineKeys coexist
    await repo.create(user.id, blockInput(task.id));
    await repo.create(user.id, blockInput(task.id));
  });
```
Note: the test file already imports `NotFoundError`; add `ConflictError` to that import. The existing `blockInput(taskId, over)` factory spreads `over`, so `{ engineKey: ... }` flows through to `create`.

- [ ] **Step 5: Run to verify failure.**
Run: `cd packages/db && npx vitest run test/repositories/scheduled-block-repository.test.ts`
Expected: FAIL — `repo.update is not a function` / `engineKey` not accepted.

- [ ] **Step 6: Edit `packages/db/src/repositories/scheduled-block-repository.ts`.**
(a) Add `engineKey` to `CreateScheduledBlockInput`:
```ts
export interface CreateScheduledBlockInput {
  taskId?: string | null;
  habitId?: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  pinned?: boolean;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  engineKey?: string | null;
}
```
(b) Add an `UpdateScheduledBlockInput` interface (above the factory) and an `update` method (after `setPinned`):
```ts
export interface UpdateScheduledBlockInput {
  startsAt?: Date;
  endsAt?: Date;
  pinned?: boolean;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  engineKey?: string | null;
}
```
```ts
    async update(userId: string, id: string, data: UpdateScheduledBlockInput): Promise<ScheduledBlock> {
      try {
        const result = await prisma.scheduledBlock.updateMany({ where: { id, userId }, data });
        if (result.count === 0) {
          throw new NotFoundError(`ScheduledBlock ${id} not found for user`);
        }
        return await prisma.scheduledBlock.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },
```
(c) Export the new type from the factory's `export type` line at the bottom (it already exports `ScheduledBlockRepository`, `CreateScheduledBlockInput`):
```ts
export type ScheduledBlockRepository = ReturnType<typeof createScheduledBlockRepository>;
```
(no change needed to that line; the new `UpdateScheduledBlockInput` is exported by its own `export interface`).

Confirm the file imports `translatePrismaError` (it already imports `NotFoundError, translatePrismaError` from `../errors.js`).

- [ ] **Step 7: Export `UpdateScheduledBlockInput` from `packages/db/src/index.ts`.** Update the scheduled-block type export line to include it:
```ts
export type { ScheduledBlockRepository, CreateScheduledBlockInput, UpdateScheduledBlockInput } from './repositories/scheduled-block-repository.js';
```

- [ ] **Step 8: Run tests + rebuild db.**
Run: `cd packages/db && npx vitest run test/repositories/scheduled-block-repository.test.ts && npm run build`
Expected: tests pass (the 2 new + existing); build clean.

- [ ] **Step 9: Commit.**
```bash
git add packages/db/prisma packages/db/src/repositories/scheduled-block-repository.ts packages/db/src/repositories/user-repository.ts packages/db/src/index.ts packages/db/test/repositories/scheduled-block-repository.test.ts
git commit -m "feat(db): add ScheduledBlock.engineKey + update, User.autoScheduledCalendarId"
```

---

### Task 2: Extend `GoogleClient` write surface (+ fake)

**Files:**
- Modify: `packages/google/package.json` (add core dep)
- Modify: `packages/google/src/client.ts`
- Modify: `packages/google/test/fakes.ts`

- [ ] **Step 1: Add the core dependency to `packages/google/package.json`.** In `dependencies`, add:
```json
    "@notreclaim/core": "*",
```
(keep `@notreclaim/db` and `google-auth-library`).

- [ ] **Step 2: Extend `packages/google/src/client.ts`.**
(a) Add `timeMax` to `ListEventsArgs`:
```ts
export interface ListEventsArgs {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  timeMin?: string;
  timeMax?: string;
}
```
(b) Add a write payload type (after `ListEventsResult`):
```ts
export interface GoogleEventWrite {
  summary: string;
  startDateTime: string; // RFC3339
  endDateTime: string;   // RFC3339
}
```
(c) Add the write methods to the `GoogleClient` interface (after `listEvents`):
```ts
  createCalendar(accessToken: string, summary: string): Promise<{ calendarId: string }>;
  insertEvent(accessToken: string, calendarId: string, event: GoogleEventWrite): Promise<{ googleEventId: string }>;
  updateEvent(accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, googleEventId: string): Promise<void>;
```

- [ ] **Step 3: Extend `FakeGoogleClient` and `makeUser` in `packages/google/test/fakes.ts`.**
(a) In `makeUser`, add `autoScheduledCalendarId: null,` to the returned object (the `User` type now requires it).
(b) Add these fields + methods to the `FakeGoogleClient` class (add the import of `GoogleEventWrite` to the existing type import from `../src/client.js`):
```ts
  createdCalendars: string[] = [];
  createCalendarResult = { calendarId: 'cal-auto' };
  insertedEvents: Array<{ calendarId: string; event: GoogleEventWrite }> = [];
  updatedEvents: Array<{ calendarId: string; googleEventId: string; event: GoogleEventWrite }> = [];
  deletedEvents: Array<{ calendarId: string; googleEventId: string }> = [];
  private insertCount = 0;

  async createCalendar(_accessToken: string, summary: string): Promise<{ calendarId: string }> {
    this.createdCalendars.push(summary);
    return this.createCalendarResult;
  }

  async insertEvent(_accessToken: string, calendarId: string, event: GoogleEventWrite): Promise<{ googleEventId: string }> {
    this.insertCount += 1;
    this.insertedEvents.push({ calendarId, event });
    return { googleEventId: `g-evt-${this.insertCount}` };
  }

  async updateEvent(_accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void> {
    this.updatedEvents.push({ calendarId, googleEventId, event });
  }

  async deleteEvent(_accessToken: string, calendarId: string, googleEventId: string): Promise<void> {
    this.deletedEvents.push({ calendarId, googleEventId });
  }
```

- [ ] **Step 4: Install + build deps + typecheck.**
Run: `npm install`
Then: `npm run build -w @notreclaim/scheduler && npm run build -w @notreclaim/db && npm run build -w @notreclaim/core`
Then: `cd packages/google && npx tsc -p tsconfig.json --noEmit`
Expected: deps linked; core built; google typechecks (the fake now implements the full interface; existing tests still compile).

- [ ] **Step 5: Run existing google tests (ensure no regression).**
Run: `cd packages/google && npx vitest run`
Expected: the existing 17 tests still pass.

- [ ] **Step 6: Commit.**
```bash
git add packages/google/package.json packages/google/src/client.ts packages/google/test/fakes.ts package-lock.json
git commit -m "feat(google): extend GoogleClient with calendar/event write methods"
```

---

### Task 3: `toGoogleEventWrite`

**Files:**
- Create: `packages/google/src/writeback.ts`
- Test: `packages/google/test/writeback.test.ts`

- [ ] **Step 1: Write the failing test `packages/google/test/writeback.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { toGoogleEventWrite } from '../src/writeback.js';

describe('toGoogleEventWrite', () => {
  it('maps an engine block to a Google event write payload (ISO times)', () => {
    expect(
      toGoogleEventWrite({
        id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Focus',
        start: Date.parse('2026-01-05T09:00:00.000Z'), end: Date.parse('2026-01-05T09:30:00.000Z'),
      }),
    ).toEqual({
      summary: 'Focus',
      startDateTime: '2026-01-05T09:00:00.000Z',
      endDateTime: '2026-01-05T09:30:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/writeback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/google/src/writeback.ts`**
```ts
import type { ScheduledBlock as EngineScheduledBlock } from '@notreclaim/scheduler';
import type { GoogleEventWrite } from './client.js';

/** Map an engine ScheduledBlock to a Google event write payload. */
export function toGoogleEventWrite(block: EngineScheduledBlock): GoogleEventWrite {
  return {
    summary: block.title,
    startDateTime: new Date(block.start).toISOString(),
    endDateTime: new Date(block.end).toISOString(),
  };
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/writeback.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit.**
```bash
git add packages/google/src/writeback.ts packages/google/test/writeback.test.ts
git commit -m "feat(google): add toGoogleEventWrite mapper"
```

---

### Task 4: `ensureAutoScheduledCalendar`

**Files:**
- Create: `packages/google/src/ensure-calendar.ts`
- Test: `packages/google/test/ensure-calendar.test.ts`

- [ ] **Step 1: Write the failing test `packages/google/test/ensure-calendar.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { ensureAutoScheduledCalendar } from '../src/ensure-calendar.js';
import { FakeGoogleClient, fakeUserRepo, makeUser } from './fakes.js';

describe('ensureAutoScheduledCalendar', () => {
  it('creates and persists the calendar when the user has none', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: null })]);
    const id = await ensureAutoScheduledCalendar({ client, users }, 'u1', 'access');
    expect(id).toBe('cal-auto');
    expect(client.createdCalendars).toEqual(['NotReclaim']);
    expect((await users.findById('u1'))?.autoScheduledCalendarId).toBe('cal-auto');
  });

  it('reuses the stored calendar id and does not create one', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-existing' })]);
    const id = await ensureAutoScheduledCalendar({ client, users }, 'u1', 'access');
    expect(id).toBe('cal-existing');
    expect(client.createdCalendars).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/ensure-calendar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/google/src/ensure-calendar.ts`**
```ts
import type { UserRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';

export interface EnsureCalendarDeps {
  client: Pick<GoogleClient, 'createCalendar'>;
  users: Pick<UserRepository, 'findById' | 'update'>;
}

const AUTO_CALENDAR_SUMMARY = 'NotReclaim';

/** Return the user's Auto-scheduled calendar id, creating + persisting it if absent. */
export async function ensureAutoScheduledCalendar(
  deps: EnsureCalendarDeps,
  userId: string,
  accessToken: string,
): Promise<string> {
  const user = await deps.users.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.autoScheduledCalendarId) return user.autoScheduledCalendarId;

  const { calendarId } = await deps.client.createCalendar(accessToken, AUTO_CALENDAR_SUMMARY);
  await deps.users.update(userId, { autoScheduledCalendarId: calendarId });
  return calendarId;
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/ensure-calendar.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add packages/google/src/ensure-calendar.ts packages/google/test/ensure-calendar.test.ts
git commit -m "feat(google): add ensureAutoScheduledCalendar"
```

---

### Task 5: `detectDrift` (+ stateful block store fake)

**Files:**
- Modify: `packages/google/test/fakes.ts` (add block store)
- Create: `packages/google/src/detect-drift.ts`
- Test: `packages/google/test/detect-drift.test.ts`

- [ ] **Step 1: Add a stateful block store to `packages/google/test/fakes.ts`.** Append (add `ScheduledBlock`, `CreateScheduledBlockInput`, `UpdateScheduledBlockInput` to the existing `import type { ... } from '@notreclaim/db'`):
```ts
export function makeScheduledBlock(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'blk1',
    userId: 'u1',
    taskId: 't1',
    habitId: null,
    title: 'Focus',
    startsAt: new Date('2026-01-05T09:00:00.000Z'),
    endsAt: new Date('2026-01-05T09:30:00.000Z'),
    pinned: false,
    googleEventId: null,
    googleCalendarId: null,
    engineKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

/** Stateful in-memory ScheduledBlock repository (reflects mutations). */
export function fakeScheduledBlockStore(seed: ScheduledBlock[] = []) {
  let blocks = [...seed];
  let counter = seed.length;
  return {
    async listByUserInRange(): Promise<ScheduledBlock[]> {
      return [...blocks];
    },
    async create(userId: string, data: CreateScheduledBlockInput): Promise<ScheduledBlock> {
      counter += 1;
      const block = makeScheduledBlock({
        id: `blk-${counter}`,
        userId,
        taskId: data.taskId ?? null,
        habitId: data.habitId ?? null,
        title: data.title,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        pinned: data.pinned ?? false,
        googleEventId: data.googleEventId ?? null,
        googleCalendarId: data.googleCalendarId ?? null,
        engineKey: data.engineKey ?? null,
      });
      blocks.push(block);
      return block;
    },
    async update(_userId: string, id: string, data: UpdateScheduledBlockInput): Promise<ScheduledBlock> {
      const block = blocks.find((b) => b.id === id);
      if (!block) throw new Error(`block ${id} not found`);
      Object.assign(block, data);
      return block;
    },
    async delete(_userId: string, id: string): Promise<void> {
      blocks = blocks.filter((b) => b.id !== id);
    },
    all(): ScheduledBlock[] {
      return [...blocks];
    },
  };
}
```

- [ ] **Step 2: Write the failing test `packages/google/test/detect-drift.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { detectDrift } from '../src/detect-drift.js';
import { FakeGoogleClient, fakeScheduledBlockStore, makeScheduledBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const HORIZON_END = NOW + 24 * 60 * 60 * 1000;

const gEvent = (id: string, start: string, end: string, status = 'confirmed') => ({
  id, status, summary: id, start: { dateTime: start }, end: { dateTime: end },
});

describe('detectDrift', () => {
  it('pins a block when the user moved its Google event', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0',
        startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T11:00:00.000Z', '2026-01-05T11:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toEqual({ pinned: 1, removed: 0 });
    const b = store.all()[0]!;
    expect(b.pinned).toBe(true);
    expect(b.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('removes a block when its Google event is gone', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0' }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toEqual({ pinned: 0, removed: 1 });
    expect(store.all()).toHaveLength(0);
  });

  it('leaves an unchanged block alone', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0',
        startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toEqual({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.pinned).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/detect-drift.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/google/src/detect-drift.ts`**
```ts
import type { ScheduledBlockRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';

export interface DriftDeps {
  client: Pick<GoogleClient, 'listEvents'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'delete'>;
}

/** Reconcile user edits to our Auto-scheduled events: moves -> pin, deletes -> remove. */
export async function detectDrift(
  deps: DriftDeps,
  userId: string,
  calendarId: string,
  accessToken: string,
  now: number,
  horizonEnd: number,
): Promise<{ pinned: number; removed: number }> {
  const res = await deps.client.listEvents({
    accessToken,
    calendarId,
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(horizonEnd).toISOString(),
  });
  const byId = new Map(res.events.map((e) => [e.id, e]));

  const blocks = await deps.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
  let pinned = 0;
  let removed = 0;

  for (const block of blocks) {
    if (!block.googleEventId) continue;
    const event = byId.get(block.googleEventId);

    if (!event || event.status === 'cancelled') {
      await deps.scheduledBlocks.delete(userId, block.id);
      removed += 1;
      continue;
    }
    if (!event.start?.dateTime || !event.end?.dateTime) continue;

    const eventStart = new Date(event.start.dateTime).getTime();
    const eventEnd = new Date(event.end.dateTime).getTime();
    if (eventStart !== block.startsAt.getTime() || eventEnd !== block.endsAt.getTime()) {
      await deps.scheduledBlocks.update(userId, block.id, {
        startsAt: new Date(eventStart),
        endsAt: new Date(eventEnd),
        pinned: true,
      });
      pinned += 1;
    }
  }

  return { pinned, removed };
}
```

- [ ] **Step 5: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/detect-drift.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**
```bash
git add packages/google/src/detect-drift.ts packages/google/test/fakes.ts packages/google/test/detect-drift.test.ts
git commit -m "feat(google): add detectDrift (moves pin, deletes remove)"
```

---

### Task 6: `reconcile` orchestrator (+ scheduling-repos fake)

**Files:**
- Modify: `packages/google/test/fakes.ts` (add scheduling repos + settings/task builders)
- Create: `packages/google/src/reconcile.ts`
- Test: `packages/google/test/reconcile.test.ts`

- [ ] **Step 1: Add scheduling-repos fakes to `packages/google/test/fakes.ts`.** Append (add `Settings`, `Task` to the `@notreclaim/db` type import; add `SchedulingRepositories` import from `@notreclaim/core`):
```ts
import type { Settings, Task } from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1',
    userId: 'u1',
    timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
    horizonDays: 1,
    defaultMinChunkMs: 1800000,
    defaultMaxChunkMs: 1800000,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    userId: 'u1',
    title: 'Focus',
    priority: 1,
    durationMs: 1800000,
    dueBy: new Date('2026-01-05T17:00:00.000Z'),
    minChunkMs: 1800000,
    maxChunkMs: 1800000,
    category: null,
    status: 'pending',
    timeLoggedMs: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

/** Build SchedulingRepositories for reconcile tests, sharing one block store. */
export function fakeSchedulingRepos(opts: {
  settings: Settings | null;
  tasks?: Task[];
  blockStore: ReturnType<typeof fakeScheduledBlockStore>;
}): SchedulingRepositories {
  return {
    settings: { getByUserId: async () => opts.settings },
    calendarEvents: { listByUserInRange: async () => [] },
    tasks: { listByUser: async () => opts.tasks ?? [] },
    habits: { listByUser: async () => [] },
    scheduledBlocks: { listByUserInRange: async () => opts.blockStore.all() },
  };
}
```

- [ ] **Step 2: Write the failing test `packages/google/test/reconcile.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/reconcile.js';
import {
  FakeGoogleClient,
  fakeUserRepo,
  fakeScheduledBlockStore,
  fakeSchedulingRepos,
  fakeTokenProvider,
  makeUser,
  makeSettings,
  makeTask,
  makeScheduledBlock,
} from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

function buildDeps(opts: {
  store: ReturnType<typeof fakeScheduledBlockStore>;
  tasks?: ReturnType<typeof makeTask>[];
  client: FakeGoogleClient;
  user?: ReturnType<typeof makeUser>;
}) {
  const users = fakeUserRepo([opts.user ?? makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-auto' })]);
  return {
    client: opts.client,
    tokens: fakeTokenProvider(),
    users,
    scheduledBlocks: opts.store,
    schedulingRepos: fakeSchedulingRepos({ settings: makeSettings(), tasks: opts.tasks, blockStore: opts.store }),
  };
}

// Build the Google event list the Auto-scheduled calendar would currently return,
// derived from the blocks the store has written.
function googleEventsFromStore(store: ReturnType<typeof fakeScheduledBlockStore>) {
  return store.all()
    .filter((b) => b.googleEventId)
    .map((b) => ({
      id: b.googleEventId!, status: 'confirmed', summary: b.title,
      start: { dateTime: b.startsAt.toISOString() }, end: { dateTime: b.endsAt.toISOString() },
    }));
}

describe('reconcile', () => {
  it('inserts a Google event and creates a DB block for a new desired placement', async () => {
    const store = fakeScheduledBlockStore();
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }]; // drift read: nothing yet
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.created).toBe(1);
    expect(client.insertedEvents).toHaveLength(1);
    const block = store.all()[0]!;
    expect(block.engineKey).toBe('task:t1:0');
    expect(block.googleEventId).toBe('g-evt-1');
    expect(block.googleCalendarId).toBe('cal-auto');
  });

  it('is idempotent: a second identical run makes zero Google writes', async () => {
    const store = fakeScheduledBlockStore();
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    await reconcile(deps, 'u1', NOW);

    // second run: Google now reports the event we created; reset recorders.
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    client.insertedEvents = [];
    client.updatedEvents = [];
    client.deletedEvents = [];

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
  });

  it('deletes the Google event and DB block for a placement no longer desired', async () => {
    // Seed an existing engine block whose task no longer schedules anything (no tasks).
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', engineKey: 'task:gone:0', googleEventId: 'g1', googleCalendarId: 'cal-auto', pinned: false }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }]; // drift: event present, unchanged
    const deps = buildDeps({ store, tasks: [], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.deleted).toBe(1);
    expect(client.deletedEvents).toEqual([{ calendarId: 'cal-auto', googleEventId: 'g1' }]);
    expect(store.all()).toHaveLength(0);
  });

  it('leaves a pinned block alone (no delete, still present)', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', engineKey: null, googleEventId: 'g1', googleCalendarId: 'cal-auto', pinned: true }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const deps = buildDeps({ store, tasks: [], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.deleted).toBe(0);
    expect(client.deletedEvents).toHaveLength(0);
    expect(store.all().some((b) => b.id === 'b1')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/google/src/reconcile.ts`**
```ts
import type { ScheduledBlockRepository, UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  toScheduledBlockInput,
  SettingsRequiredError,
  type SchedulingRepositories,
} from '@notreclaim/core';
import type { GoogleClient } from './client.js';
import type { AccessTokenProvider } from './sync.js';
import { ensureAutoScheduledCalendar } from './ensure-calendar.js';
import { detectDrift } from './detect-drift.js';
import { toGoogleEventWrite } from './writeback.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReconcileDeps {
  client: GoogleClient;
  tokens: AccessTokenProvider;
  users: Pick<UserRepository, 'findById' | 'update'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>;
  schedulingRepos: SchedulingRepositories;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  pinned: number;
  removed: number;
}

/** Detect drift, recompute the desired schedule, and apply a keyed in-place diff to Google + DB. */
export async function reconcile(deps: ReconcileDeps, userId: string, now: number): Promise<ReconcileResult> {
  const accessToken = await deps.tokens.getAccessToken(userId, now);
  const calendarId = await ensureAutoScheduledCalendar(
    { client: deps.client, users: deps.users },
    userId,
    accessToken,
  );

  const settings = await deps.schedulingRepos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);
  const horizonEnd = now + settings.horizonDays * MS_PER_DAY;

  const { pinned, removed } = await detectDrift(
    { client: deps.client, scheduledBlocks: deps.scheduledBlocks },
    userId,
    calendarId,
    accessToken,
    now,
    horizonEnd,
  );

  const desired = await computeDesiredSchedule(deps.schedulingRepos, userId, now);

  const existing = await deps.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
  const pinnedIds = new Set(existing.filter((b) => b.pinned).map((b) => b.id));
  const existingByKey = new Map(
    existing.filter((b) => !b.pinned && b.engineKey).map((b) => [b.engineKey as string, b]),
  );

  const desiredNew = desired.blocks.filter((b) => !pinnedIds.has(b.id));

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const seenKeys = new Set<string>();

  for (const block of desiredNew) {
    seenKeys.add(block.id);
    const match = existingByKey.get(block.id);
    if (match) {
      if (match.startsAt.getTime() !== block.start || match.endsAt.getTime() !== block.end) {
        await deps.client.updateEvent(accessToken, calendarId, match.googleEventId as string, toGoogleEventWrite(block));
        await deps.scheduledBlocks.update(userId, match.id, {
          startsAt: new Date(block.start),
          endsAt: new Date(block.end),
        });
        updated += 1;
      }
      continue;
    }
    const { googleEventId } = await deps.client.insertEvent(accessToken, calendarId, toGoogleEventWrite(block));
    await deps.scheduledBlocks.create(userId, {
      ...toScheduledBlockInput(block),
      engineKey: block.id,
      googleEventId,
      googleCalendarId: calendarId,
    });
    created += 1;
  }

  for (const [key, block] of existingByKey) {
    if (seenKeys.has(key)) continue;
    if (block.googleEventId) {
      await deps.client.deleteEvent(accessToken, calendarId, block.googleEventId);
    }
    await deps.scheduledBlocks.delete(userId, block.id);
    deleted += 1;
  }

  return { created, updated, deleted, pinned, removed };
}
```

- [ ] **Step 5: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**
```bash
git add packages/google/src/reconcile.ts packages/google/test/fakes.ts packages/google/test/reconcile.test.ts
git commit -m "feat(google): add reconcile orchestrator (drift, compute, keyed diff)"
```

---

### Task 7: Real adapter write methods

**Files:**
- Modify: `packages/google/src/google-client.ts`

Thin real methods; verified by build/typecheck (no live network).

- [ ] **Step 1: Edit `listEvents` in `packages/google/src/google-client.ts`** to accept and apply `timeMax`. Change the destructure to include `timeMax` and add, right after the `timeMin` branch (inside the `else if (timeMin)` is wrong — `timeMax` is independent), insert after the `if (syncToken) {...} else if (timeMin) {...}` block:
```ts
      if (timeMax && !syncToken) url.searchParams.set('timeMax', timeMax);
```
and update the parameter list `async listEvents({ accessToken, calendarId, syncToken, pageToken, timeMin, timeMax }: ListEventsArgs)`.

- [ ] **Step 2: Add the four write methods** to the object returned by `createGoogleClient`, after `listEvents`:
```ts
    async createCalendar(accessToken, summary) {
      const res = await fetch(`${CALENDAR_API}/calendars`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
      const data = (await res.json()) as { id: string };
      return { calendarId: data.id };
    },

    async insertEvent(accessToken, calendarId, event) {
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: event.summary,
          start: { dateTime: event.startDateTime },
          end: { dateTime: event.endDateTime },
        }),
      });
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
      const data = (await res.json()) as { id: string };
      return { googleEventId: data.id };
    },

    async updateEvent(accessToken, calendarId, googleEventId, event) {
      const res = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: event.summary,
            start: { dateTime: event.startDateTime },
            end: { dateTime: event.endDateTime },
          }),
        },
      );
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
    },

    async deleteEvent(accessToken, calendarId, googleEventId) {
      const res = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.status === 404 || res.status === 410) return; // already gone — idempotent
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
    },
```

- [ ] **Step 3: Type-check + build.**
Run: `cd packages/google && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit.**
```bash
git add packages/google/src/google-client.ts
git commit -m "feat(google): implement calendar/event write methods in the real adapter"
```

---

### Task 8: Public exports and full verification

**Files:**
- Modify: `packages/google/src/index.ts`

- [ ] **Step 1: Add to `packages/google/src/index.ts`:**
```ts
export type { GoogleEventWrite } from './client.js';
export { toGoogleEventWrite } from './writeback.js';
export { ensureAutoScheduledCalendar } from './ensure-calendar.js';
export type { EnsureCalendarDeps } from './ensure-calendar.js';
export { detectDrift } from './detect-drift.js';
export type { DriftDeps } from './detect-drift.js';
export { reconcile } from './reconcile.js';
export type { ReconcileDeps, ReconcileResult } from './reconcile.js';
```

- [ ] **Step 2: Run the full google suite.**
Run: `cd packages/google && npx vitest run`
Expected: PASS — prior 17 + writeback 1 + ensure-calendar 2 + detect-drift 3 + reconcile 4 = 27 tests.

- [ ] **Step 3: Build + typecheck the script.**
Run: `cd packages/google && npm run build && npm run typecheck:scripts`
Expected: clean; `dist/index.js` + `dist/index.d.ts` exist.

- [ ] **Step 4: Run the whole monorepo suite (Postgres running).**
Run: `cd /home/nyx-ai/Projects/NotReclaim && npm test`
Expected: scheduler 28, db 34, core 22, google 27 — all pass.

- [ ] **Step 5: Commit.**
```bash
git add packages/google/src/index.ts
git commit -m "feat(google): export write-back + reconcile surface"
```

---

## Self-Review Notes

- **Spec coverage:** `User.autoScheduledCalendarId` + `ScheduledBlock.engineKey` (unique) + `update` + `engineKey` on create (Task 1) · `GoogleClient` write methods + `timeMax` + fake (Task 2) · `toGoogleEventWrite` (Task 3) · `ensureAutoScheduledCalendar` create-or-reuse (Task 4) · `detectDrift` moves→pin / deletes→remove (Task 5) · `reconcile` drift→compute→keyed diff with Google-before-DB ordering, pinned-echo filtering, idempotency (Task 6) · real adapter write methods incl. 404/410-tolerant delete (Task 7) · exports + full verify (Task 8). Non-goals (HTTP/webhook/timer, suppression, multi-calendar) absent.
- **Type consistency:** `GoogleEventWrite` defined in Task 2, used by `toGoogleEventWrite` (3), the fake (2), reconcile (6), and the real adapter (7). `engineKey`/`autoScheduledCalendarId`/`UpdateScheduledBlockInput` from Task 1 are used by the store fake (5) and reconcile (6). `reconcile` consumes `computeDesiredSchedule`/`toScheduledBlockInput`/`SchedulingRepositories`/`SettingsRequiredError` from `@notreclaim/core` and `AccessTokenProvider` from `./sync.js`.
- **Shared-store invariant:** reconcile tests pass ONE `fakeScheduledBlockStore` as both `deps.scheduledBlocks` and `schedulingRepos.scheduledBlocks`, so drift mutations are visible to compute — matching production (same Prisma repo).
- **No placeholders; determinism:** `now` injected throughout; the only randomness remains the AES IV from 3b-i (untouched here).
- **Cross-package build order:** Task 1 rebuilds db; Task 2 builds core (new google→core dep). Whole-suite (Task 8) expects db at 34 (32 prior + 2 new repo tests) and google at 27 (17 prior + 10 new). The gate is "all green" — confirm actual counts at run time rather than treating these as magic numbers.
```
