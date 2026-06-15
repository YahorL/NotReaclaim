# Task Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track time spent per task (summed from finished scheduled blocks), show spent/left in the UI, add a "require Start to count" setting, give task blocks a Start button that snaps the block start to the nearest 15 min, discard un-started blocks in manual mode, and make the scheduler stop planning a task once its time is met.

**Architecture:** Timer-free. "Spent" is derived from the durations of a task's *finished* blocks (`end ≤ now`) by a single pure helper `computeSpentMs` in `@notreclaim/core`, used by both the tasks API (display) and the scheduler assembler (so `left` drives planning). A `ScheduledBlock.startedAt` column marks started blocks; in manual mode (`Settings.requireStartToTrack`) only started finished blocks count and un-started past blocks are swept. A `POST /schedule/:id/start` endpoint snaps + pins + marks the block started.

**Tech Stack:** npm-workspaces monorepo — `@notreclaim/db` (Prisma/Postgres), `@notreclaim/core` (pure scheduling), `@notreclaim/server` (Fastify), `@notreclaim/web` (React + React Query + Vite). Vitest everywhere. **Run tests per-package, never from root. Web tests need `TZ=UTC`.**

**Spec:** `docs/superpowers/specs/2026-06-14-notreclaim-time-tracking-design.md`

---

## File structure

**Modify**
- `packages/db/prisma/schema.prisma` — add `Settings.requireStartToTrack`, `ScheduledBlock.startedAt`
- `packages/db/prisma/migrations/20260614120000_time_tracking/migration.sql` — **create** (hand-authored)
- `packages/db/src/repositories/scheduled-block-repository.ts` — add `findById`, `startedAt` to `UpdateScheduledBlockInput`
- `packages/db/src/repositories/settings-repository.ts` — `requireStartToTrack` in `UpsertSettingsInput`
- `packages/core/src/spent.ts` — **create** (`round15`, `computeSpentMs`)
- `packages/core/src/index.ts` — export the two helpers
- `packages/core/src/assemble.ts` — subtract spent from remaining; load past blocks; pinned-coverage to future-only
- `packages/server/src/schemas.ts` — `requireStartToTrack` in `settingsSchema`
- `packages/server/src/app.ts` — add `findById` to the `scheduledBlocks` `Pick`
- `packages/server/src/schedule-routes.ts` — `POST /schedule/:id/start`; discard sweep in `GET /schedule`
- `packages/server/src/task-routes.ts` — attach derived `spentMs` in `GET /tasks` and `GET /tasks/:id`
- `packages/web/src/api/types.ts` — `ScheduledBlock.startedAt`, `Task.spentMs?`, `Settings.requireStartToTrack?`, `SettingsInput.requireStartToTrack?`
- `packages/web/src/api/client.ts` — `startBlock`
- `packages/web/src/api/queries.ts` — `useStartBlockMutation`
- `packages/web/src/test/fakes.tsx` — `startBlock` default in `fakeApiClient`
- `packages/web/src/app/settings/settingsForm.ts` + `SettingsForm.tsx` — the checkbox
- `packages/web/src/app/planner/PlannerTaskPanel.tsx` — spent/left + progress on cards
- `packages/web/src/app/tasks/TaskDrawer.tsx` — spent/left + progress line
- `packages/web/src/app/planner/InteractiveBlock.tsx` — Start button
- `packages/web/src/app/planner/WeekGrid.tsx` — thread `onStartBlock` + `startedAt`
- `packages/web/src/app/shell/TopBar.tsx` — Start button in the next-task widget
- `packages/web/src/app/pages/Planner.tsx` — wire `useStartBlockMutation` into `WeekGrid`

**Test fakes to keep type-correct** (add the new fields/defaults):
- `packages/server/test/fakes.ts` — `fakeScheduledBlockRepo.findById`, `startedAt: null` default; `fakeSettingsRepo` default `requireStartToTrack: false`
- `packages/core/test/fakes.ts` — `makeBlock` `startedAt: null`; `makeSettings` `requireStartToTrack: false`
- `packages/server/test/schedule.test.ts` — `block()`/`settings()` helpers gain the new fields

---

## Preconditions

- [ ] **Branch + Postgres up.** Confirm branch and DB.

```bash
git rev-parse --abbrev-ref HEAD   # expect: feat/time-tracking
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata status || \
  /usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log \
    -o "-p 5432 -k /tmp -c listen_addresses=localhost" start
```

---

## Phase 1 — DB

### Task 1: Schema + migration + generate

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260614120000_time_tracking/migration.sql`

- [ ] **Step 1: Add the two columns to the schema.**

In `schema.prisma`, in `model Settings` add after `taskBufferMs` (line 55):

```prisma
  taskBufferMs        Int      @default(0)
  requireStartToTrack Boolean  @default(false)
```

In `model ScheduledBlock` add after `engineKey` (line 160):

```prisma
  engineKey        String?
  startedAt        DateTime? @db.Timestamptz
```

- [ ] **Step 2: Hand-author the migration SQL** (matches the repo's existing style — see `20260610030001_task_completed_at/migration.sql`).

Create `packages/db/prisma/migrations/20260614120000_time_tracking/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "requireStartToTrack" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScheduledBlock" ADD COLUMN "startedAt" TIMESTAMPTZ;
```

- [ ] **Step 3: Regenerate the Prisma client** (required so `src` type-checks; the test DB is migrated automatically by the db vitest global-setup).

Run: `npm --workspace @notreclaim/db run prisma:generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 4: Apply to the dev DB** (so the running app sees the columns).

Run: `npm --workspace @notreclaim/db run prisma:deploy`
Expected: "1 migration ... applied" (or "No pending migrations" if already applied).

- [ ] **Step 5: Commit.**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260614120000_time_tracking
git commit -m "feat(db): add Settings.requireStartToTrack + ScheduledBlock.startedAt"
```

### Task 2: scheduled-block repo — `findById` + `startedAt`

**Files:**
- Modify: `packages/db/src/repositories/scheduled-block-repository.ts`
- Test: `packages/db/test/repositories/scheduled-block-repository.test.ts`

- [ ] **Step 1: Write failing tests.** Append inside the `describe('ScheduledBlockRepository', …)` block:

```ts
  it('findById returns an owned block and null across users', async () => {
    const a = await users.create({ email: 'fbid-a@example.com' });
    const b = await users.create({ email: 'fbid-b@example.com' });
    const task = await tasks.create(a.id, taskInput());
    const block = await repo.create(a.id, blockInput(task.id));
    expect((await repo.findById(a.id, block.id))?.id).toBe(block.id);
    expect(await repo.findById(b.id, block.id)).toBeNull();
    expect(await repo.findById(a.id, 'missing')).toBeNull();
  });

  it('update can set startedAt', async () => {
    const user = await users.create({ email: 'started@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const block = await repo.create(user.id, blockInput(task.id));
    expect(block.startedAt).toBeNull();
    const updated = await repo.update(user.id, block.id, { startedAt: new Date('2026-01-01T10:07:00.000Z'), pinned: true });
    expect(updated.startedAt?.toISOString()).toBe('2026-01-01T10:07:00.000Z');
  });
```

- [ ] **Step 2: Run — expect FAIL** (`findById` undefined; `startedAt` not assignable).

Run: `npm --workspace @notreclaim/db test -- scheduled-block`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `scheduled-block-repository.ts`, add `startedAt` to `UpdateScheduledBlockInput`:

```ts
export interface UpdateScheduledBlockInput {
  startsAt?: Date;
  endsAt?: Date;
  pinned?: boolean;
  startedAt?: Date | null;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  engineKey?: string | null;
}
```

Add a `findById` method (place it right after `listByUserInRange`):

```ts
    findById(userId: string, id: string): Promise<ScheduledBlock | null> {
      return prisma.scheduledBlock.findFirst({ where: { id, userId } });
    },
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --workspace @notreclaim/db test -- scheduled-block`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/repositories/scheduled-block-repository.ts packages/db/test/repositories/scheduled-block-repository.test.ts
git commit -m "feat(db): scheduled-block findById + startedAt update field"
```

### Task 3: settings repo — `requireStartToTrack`

**Files:**
- Modify: `packages/db/src/repositories/settings-repository.ts`
- Test: `packages/db/test/repositories/settings-repository.test.ts`

- [ ] **Step 1: Write a failing test.** Append inside the settings repo `describe`:

```ts
  it('persists requireStartToTrack through upsert', async () => {
    const user = await users.create({ email: 'rst@example.com' });
    const created = await repo.upsert(user.id, { ...baseInput(), requireStartToTrack: true });
    expect(created.requireStartToTrack).toBe(true);
    const updated = await repo.upsert(user.id, { ...baseInput(), requireStartToTrack: false });
    expect(updated.requireStartToTrack).toBe(false);
  });
```

> If the test file has no `baseInput()`/`users`/`repo` helpers, mirror the names already used at the top of that file (open it first); reuse its existing settings-input factory instead of `baseInput()`.

- [ ] **Step 2: Run — expect FAIL** (field not accepted / undefined).

Run: `npm --workspace @notreclaim/db test -- settings-repository`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `settings-repository.ts`, add to `UpsertSettingsInput`:

```ts
export interface UpsertSettingsInput {
  timezone: string;
  workingHours: Prisma.InputJsonValue;
  horizonDays?: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  meetingBufferMs?: number;
  taskBufferMs?: number;
  requireStartToTrack?: boolean;
}
```

(The `upsert` body already spreads `...data` into both `create` and `update`, so no further change.)

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --workspace @notreclaim/db test -- settings-repository`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/repositories/settings-repository.ts packages/db/test/repositories/settings-repository.test.ts
git commit -m "feat(db): settings upsert accepts requireStartToTrack"
```

---

## Phase 2 — Core

### Task 4: `round15` + `computeSpentMs`

**Files:**
- Create: `packages/core/src/spent.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/spent.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/spent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { round15, computeSpentMs } from '../src/spent.js';
import { makeBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T15:00:00.000Z');
const at = (iso: string) => new Date(`2026-01-05T${iso}:00.000Z`);

describe('round15', () => {
  it('rounds to the nearest 15 minutes', () => {
    expect(round15(Date.parse('2026-01-05T15:10:00.000Z'))).toBe(Date.parse('2026-01-05T15:15:00.000Z'));
    expect(round15(Date.parse('2026-01-05T15:07:00.000Z'))).toBe(Date.parse('2026-01-05T15:00:00.000Z'));
    expect(round15(Date.parse('2026-01-05T15:00:00.000Z'))).toBe(Date.parse('2026-01-05T15:00:00.000Z'));
  });
});

describe('computeSpentMs', () => {
  const finished = makeBlock({ id: 'f', taskId: 't1', startsAt: at('13:00'), endsAt: at('14:00') }); // 1h, ended
  const inProgress = makeBlock({ id: 'p', taskId: 't1', startsAt: at('14:30'), endsAt: at('15:30') }); // not finished
  const otherTask = makeBlock({ id: 'o', taskId: 't2', startsAt: at('09:00'), endsAt: at('10:00') });

  it('auto mode sums finished blocks for the task only', () => {
    expect(computeSpentMs('t1', [finished, inProgress, otherTask], false, NOW)).toBe(3_600_000);
  });

  it('manual mode counts only finished blocks that were started', () => {
    const startedFinished = makeBlock({ id: 's', taskId: 't1', startsAt: at('11:00'), endsAt: at('12:00'), startedAt: at('11:00') });
    expect(computeSpentMs('t1', [finished, startedFinished], true, NOW)).toBe(3_600_000); // only the started one
  });

  it('returns 0 when nothing qualifies', () => {
    expect(computeSpentMs('t1', [inProgress], false, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing). First add `startedAt` to `makeBlock` (next step's file also needed by the test):

In `packages/core/test/fakes.ts`, add to the `makeBlock` return object (after `engineKey: null,`):

```ts
    engineKey: null,
    startedAt: null,
```

And to `makeSettings` return object (after `taskBufferMs: 0,`):

```ts
    taskBufferMs: 0,
    requireStartToTrack: false,
```

Run: `npm --workspace @notreclaim/core test -- spent`
Expected: FAIL ("Cannot find module '../src/spent.js'").

- [ ] **Step 3: Implement `spent.ts`.** Create `packages/core/src/spent.ts`:

```ts
import type { ScheduledBlock } from '@notreclaim/db';

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** Round an epoch-ms instant to the nearest 15 minutes. */
export function round15(ms: number): number {
  return Math.round(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

/**
 * Time spent on a task = sum of its FINISHED blocks' durations (end <= now).
 * Auto mode counts every finished block; manual mode counts only started ones.
 */
export function computeSpentMs(
  taskId: string,
  blocks: ScheduledBlock[],
  requireStartToTrack: boolean,
  now: number,
): number {
  let total = 0;
  for (const b of blocks) {
    if (b.taskId !== taskId) continue;
    if (b.endsAt.getTime() > now) continue; // not finished yet
    if (requireStartToTrack && b.startedAt == null) continue; // manual: only started blocks count
    total += b.endsAt.getTime() - b.startsAt.getTime();
  }
  return total;
}
```

- [ ] **Step 4: Export from the core index.** In `packages/core/src/index.ts` add:

```ts
export { round15, computeSpentMs } from './spent.js';
```

- [ ] **Step 5: Run — expect PASS.**

Run: `npm --workspace @notreclaim/core test -- spent`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/spent.ts packages/core/src/index.ts packages/core/test/spent.test.ts packages/core/test/fakes.ts
git commit -m "feat(core): round15 + computeSpentMs helpers"
```

### Task 5: assemble — subtract spent, future-only pinned coverage

**Files:**
- Modify: `packages/core/src/assemble.ts`
- Test: `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Write failing tests.** Append a new `describe` to `assemble.test.ts`:

```ts
describe('assembleScheduleInput spent', () => {
  const NOW = Date.parse('2026-01-05T12:00:00.000Z'); // Monday noon UTC

  it('subtracts finished-block time from a task remaining (auto mode)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 3_600_000, minChunkMs: 900000, maxChunkMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'done', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'), // finished, 30m
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1_800_000); // 1h - 30m spent
  });

  it('drops a task whose finished blocks already cover its duration', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'done', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('manual mode ignores an un-started finished block (work is re-planned)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ requireStartToTrack: true, workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'missed', taskId: 't1', habitId: null, pinned: false, startedAt: null,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1_800_000); // not reduced
  });

  it('excludes past pinned blocks from the engine pinnedBlocks input', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        blocks: [
          makeBlock({ id: 'past', pinned: true, taskId: 't1', startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
          makeBlock({ id: 'future', pinned: true, taskId: 't1', startsAt: new Date('2026-01-05T14:00:00.000Z'), endsAt: new Date('2026-01-05T14:30:00.000Z') }),
        ],
      }),
      'u1', NOW,
    );
    expect(input.pinnedBlocks.map((b) => b.id)).toEqual(['future']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --workspace @notreclaim/core test -- assemble`
Expected: FAIL on the new `describe` (durationMs not reduced; `past` still in pinnedBlocks).

- [ ] **Step 3: Implement.** In `packages/core/src/assemble.ts`:

Add the import near the top (after the `time-windows` import):

```ts
import { computeSpentMs } from './spent.js';
```

Change the block load to span all history (line 82):

```ts
  const blocks = await repos.scheduledBlocks.listByUserInRange(userId, new Date(0), horizonEnd);
```

Restrict the engine's pinned blocks to current/future (line 83-85):

```ts
  const pinnedBlocks: EngineScheduledBlock[] = blocks
    .filter((b) => b.pinned && b.endsAt.getTime() > now)
    .map(toScheduledBlock);
```

In the task loop, subtract spent (replace the `remaining` line, ~line 100):

```ts
    const spent = computeSpentMs(t.id, blocks, settings.requireStartToTrack, now);
    const remaining = flexible.durationMs - (taskCoverageMs.get(t.id) ?? 0) - spent;
    if (remaining <= 0) continue;
```

(`now` is already a parameter of `assembleScheduleInput`.)

- [ ] **Step 4: Run — expect PASS** (new + existing assemble tests).

Run: `npm --workspace @notreclaim/core test -- assemble`
Expected: PASS.

- [ ] **Step 5: Full core test + build.**

Run: `npm --workspace @notreclaim/core test && npm --workspace @notreclaim/core run build`
Expected: all pass; tsc clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/assemble.ts packages/core/test/assemble.test.ts
git commit -m "feat(core): assemble subtracts spent time and uses future-only pinned coverage"
```

---

## Phase 3 — Server

### Task 6: settings schema passthrough

**Files:**
- Modify: `packages/server/src/schemas.ts`
- Modify (fakes): `packages/server/test/fakes.ts`
- Test: `packages/server/test/settings.test.ts`

- [ ] **Step 1: Keep server fakes type-correct.** In `packages/server/test/fakes.ts`, in `fakeSettingsRepo.upsert` default object add (after `meetingBufferMs: 0, taskBufferMs: 0,`):

```ts
        defaultMinChunkMs: 0, defaultMaxChunkMs: 0, meetingBufferMs: 0, taskBufferMs: 0,
        requireStartToTrack: false,
```

In `fakeScheduledBlockRepo.create` default object add `startedAt: null` (after `engineKey: null,`):

```ts
        pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
```

And add a `findById` method to `fakeScheduledBlockRepo` (after `listByUserInRange`):

```ts
    async findById(userId: string, id: string): Promise<ScheduledBlock | null> {
      return rows.find((b) => b.id === id && b.userId === userId) ?? null;
    },
```

- [ ] **Step 2: Write a failing test.** In `packages/server/test/settings.test.ts`, add:

```ts
  it('PUT /settings round-trips requireStartToTrack', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const put = await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` },
      payload: {
        timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
        defaultMinChunkMs: 1800000, defaultMaxChunkMs: 3600000, requireStartToTrack: true,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().requireStartToTrack).toBe(true);
  });
```

> If `settings.test.ts` already has a PUT payload factory, reuse it and just add `requireStartToTrack: true`.

- [ ] **Step 3: Run — expect FAIL** (field stripped by Zod → returns `false`/undefined).

Run: `npm --workspace @notreclaim/server test -- settings`
Expected: FAIL.

- [ ] **Step 4: Implement.** In `packages/server/src/schemas.ts`, add to `settingsSchema` (after `taskBufferMs`):

```ts
  taskBufferMs: z.number().int().nonnegative().optional(),
  requireStartToTrack: z.boolean().optional(),
```

(`settings-routes.ts` already spreads `...body` into `upsert`, so no route change.)

- [ ] **Step 5: Run — expect PASS.**

Run: `npm --workspace @notreclaim/server test -- settings`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/schemas.ts packages/server/test/fakes.ts packages/server/test/settings.test.ts
git commit -m "feat(server): accept requireStartToTrack on PUT /settings; test fakes for time tracking"
```

### Task 7: `POST /schedule/:id/start`

**Files:**
- Modify: `packages/server/src/app.ts` (add `findById` to the Pick)
- Modify: `packages/server/src/schedule-routes.ts`
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Keep the schedule.test helpers type-correct.** In `packages/server/test/schedule.test.ts`, add `startedAt: null` to the `block()` factory (after `engineKey: 'task:t1:0',`) and `requireStartToTrack: false` to the `settings()` factory (after `meetingBufferMs: 0, taskBufferMs: 0,`).

- [ ] **Step 2: Write failing tests.** Append a new `describe` to `schedule.test.ts`:

```ts
describe('POST /schedule/:id/start', () => {
  const FIXED = Date.parse('2026-01-05T00:00:00.000Z'); // FIXED_NOW from fakes (Monday 00:00 UTC)

  it('late start snaps startsAt to the nearest 15 min, pins, sets startedAt', async () => {
    // FIXED_NOW rounds to 00:00; block 23:50→01:00 spans it so the snap (00:00) lands inside.
    const b = block({ id: 'b1', startsAt: new Date('2026-01-04T23:50:00.000Z'), endsAt: new Date('2026-01-05T01:00:00.000Z') });
    const { app, reconcileCalls } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T00:00:00.000Z'); // snapped to FIXED_NOW
    expect(res.json().pinned).toBe(true);
    expect(res.json().startedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(reconcileCalls.length).toBeGreaterThan(0);
  });

  it('does not move startsAt when the snap falls at/before the block start', async () => {
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T02:00:00.000Z'), endsAt: new Date('2026-01-05T03:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T02:00:00.000Z'); // unchanged
    expect(res.json().pinned).toBe(true);
    expect(res.json().startedAt).toBe(new Date(FIXED).toISOString());
  });

  it('404s an unknown block and 400s a habit block', async () => {
    const habitBlock = block({ id: 'h1', taskId: null, habitId: 'hab1' });
    const { app } = buildTestApp({ blocks: [habitBlock], settings: settings() });
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'POST', url: '/schedule/none/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/schedule/h1/start', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (route 404 / not found).

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: FAIL.

- [ ] **Step 4: Add `findById` to the AppDeps Pick.** In `packages/server/src/app.ts` line 33:

```ts
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'create' | 'delete' | 'findById'>;
```

- [ ] **Step 5: Implement the route.** In `packages/server/src/schedule-routes.ts`, add `round15` to the core import:

```ts
import { computeDesiredSchedule, round15 } from '@notreclaim/core';
```

Add the route after the `PATCH /schedule/:id` handler (before `DELETE`):

```ts
  app.post('/schedule/:id/start', guard, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const blockRow = await deps.repos.scheduledBlocks.findById(request.userId, id);
    if (!blockRow) {
      reply.code(404).send({ code: 'not_found', message: `ScheduledBlock ${id} not found` });
      return;
    }
    if (!blockRow.taskId) {
      reply.code(400).send({ code: 'bad_request', message: 'Only task blocks can be started' });
      return;
    }
    const now = deps.now();
    const snapped = round15(now);
    const data: { pinned: boolean; startedAt: Date; startsAt?: Date } = { pinned: true, startedAt: new Date(now) };
    if (snapped > blockRow.startsAt.getTime() && snapped < blockRow.endsAt.getTime()) {
      data.startsAt = new Date(snapped);
    }
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });
```

- [ ] **Step 6: Run — expect PASS.**

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/server/src/app.ts packages/server/src/schedule-routes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): POST /schedule/:id/start (snap + pin + startedAt)"
```

### Task 8: discard sweep in `GET /schedule`

**Files:**
- Modify: `packages/server/src/schedule-routes.ts`
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Write a failing test.** Append to `schedule.test.ts`:

```ts
describe('GET /schedule discard sweep (manual mode)', () => {
  const wide = '?from=2026-01-01T00:00:00.000Z&to=2026-01-10T00:00:00.000Z';

  it('deletes past un-started task blocks but keeps started and future ones', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), startedAt: null });
    const kept = block({ id: 'kept', startsAt: new Date('2026-01-04T10:00:00.000Z'), endsAt: new Date('2026-01-04T10:30:00.000Z'), startedAt: new Date('2026-01-04T10:00:00.000Z') });
    const future = block({ id: 'future', startsAt: new Date('2026-01-06T09:00:00.000Z'), endsAt: new Date('2026-01-06T09:30:00.000Z'), startedAt: null });
    const { app } = buildTestApp({ blocks: [missed, kept, future], settings: settings({ requireStartToTrack: true }) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    const ids = (res.json() as { id: string }[]).map((b) => b.id).sort();
    expect(ids).toEqual(['future', 'kept']);
  });

  it('keeps un-started past blocks in auto mode', async () => {
    const missed = block({ id: 'missed', startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), startedAt: null });
    const { app } = buildTestApp({ blocks: [missed], settings: settings({ requireStartToTrack: false }) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: `/schedule${wide}`, headers: { authorization: `Bearer ${token}` } });
    expect((res.json() as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (first test returns all three ids).

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: FAIL.

- [ ] **Step 3: Implement the sweep.** In `schedule-routes.ts`, replace the `GET /schedule` handler body with:

```ts
  app.get('/schedule', guard, async (request) => {
    const query = rangeQuerySchema.parse(request.query);
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(request.userId);

    // Manual mode: discard past task blocks that were never started (self-heal on load).
    if (settings?.requireStartToTrack) {
      const past = await deps.repos.scheduledBlocks.listByUserInRange(request.userId, new Date(0), new Date(now));
      for (const b of past) {
        if (b.taskId && b.startedAt == null && b.endsAt.getTime() <= now) {
          await deps.repos.scheduledBlocks.delete(request.userId, b.id);
        }
      }
    }

    const start = query.from ? new Date(query.from) : new Date(now);
    let end: Date;
    if (query.to) {
      end = new Date(query.to);
    } else {
      const horizonDays = settings?.horizonDays ?? 14;
      end = new Date(now + horizonDays * MS_PER_DAY);
    }
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/schedule-routes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): discard un-started past blocks on GET /schedule in manual mode"
```

### Task 9: attach `spentMs` in tasks GET

**Files:**
- Modify: `packages/server/src/task-routes.ts`
- Test: `packages/server/test/tasks.test.ts`

- [ ] **Step 1: Write failing tests.** Append to `tasks.test.ts`:

```ts
import type { ScheduledBlock } from '@notreclaim/db';

describe('GET /tasks spentMs', () => {
  const taskRow = {
    id: 't1', userId: 'u1', title: 'T', priority: 1, sortOrder: 0, durationMs: 3_600_000,
    dueBy: new Date('2026-01-09T17:00:00.000Z'), notBefore: null, minChunkMs: 1, maxChunkMs: 1,
    categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
    createdAt: new Date(0), updatedAt: new Date(0), subtasks: [],
  };
  const finished: ScheduledBlock = {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'T',
    startsAt: new Date('2026-01-04T09:00:00.000Z'), endsAt: new Date('2026-01-04T09:30:00.000Z'), // 30m, finished
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const settingsRow = (requireStartToTrack: boolean) => ({
    id: 's', userId: 'u1', timezone: 'UTC', workingHours: [], horizonDays: 14,
    defaultMinChunkMs: 1, defaultMaxChunkMs: 1, meetingBufferMs: 0, taskBufferMs: 0,
    requireStartToTrack, createdAt: new Date(0), updatedAt: new Date(0),
  });

  it('reports auto-mode spent from finished blocks', async () => {
    const { app } = buildTestApp({ tasks: [taskRow as never], blocks: [finished], settings: settingsRow(false) as never });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()[0].spentMs).toBe(1_800_000);
  });

  it('manual mode counts only started finished blocks', async () => {
    const { app } = buildTestApp({ tasks: [taskRow as never], blocks: [finished], settings: settingsRow(true) as never });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()[0].spentMs).toBe(0); // finished but un-started → not counted
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`spentMs` undefined).

Run: `npm --workspace @notreclaim/server test -- tasks`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `packages/server/src/task-routes.ts`, add the import:

```ts
import { computeSpentMs } from '@notreclaim/core';
```

Add a helper at the top of `registerTaskRoutes` (after `const guard = …`):

```ts
  const attachSpent = async (userId: string, tasks: Array<{ id: string }>) => {
    const now = deps.now();
    const settings = await deps.repos.settings.getByUserId(userId);
    const requireStart = settings?.requireStartToTrack ?? false;
    const blocks = await deps.repos.scheduledBlocks.listByUserInRange(userId, new Date(0), new Date(now));
    return tasks.map((t) => ({ ...t, spentMs: computeSpentMs(t.id, blocks, requireStart, now) }));
  };
```

Change `GET /tasks` to return enriched tasks:

```ts
  app.get('/tasks', guard, async (request) => {
    const query = listTasksQuerySchema.parse(request.query);
    const cutoff = new Date(deps.now() - 30 * 24 * 60 * 60 * 1000);
    await deps.repos.tasks.purgeCompletedBefore(request.userId, cutoff);
    const tasks = await deps.repos.tasks.listByUser(request.userId, query.status ? { status: query.status } : {});
    return attachSpent(request.userId, tasks);
  });
```

And `GET /tasks/:id` (after the not-found guard, replace `return task;`):

```ts
    const [withSpent] = await attachSpent(request.userId, [task]);
    return withSpent;
```

- [ ] **Step 4: Run — expect PASS** (and the rest of tasks.test).

Run: `npm --workspace @notreclaim/server test -- tasks`
Expected: PASS. (If a pre-existing test used `toEqual` on the task list, relax it to `toMatchObject` or add `spentMs` — `spentMs` is additive.)

- [ ] **Step 5: Full server test + build.**

Run: `npm --workspace @notreclaim/server test && npm --workspace @notreclaim/server run build`
Expected: all pass; tsc clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/server/src/task-routes.ts packages/server/test/tasks.test.ts
git commit -m "feat(server): attach derived spentMs to tasks GET responses"
```

---

## Phase 4 — Web API layer

### Task 10: types + client + query mutation

**Files:**
- Modify: `packages/web/src/api/types.ts`, `client.ts`, `queries.ts`, `src/test/fakes.tsx`

- [ ] **Step 1: Types.** In `packages/web/src/api/types.ts`:

In `interface Task` add (after `timeLoggedMs: number;`):

```ts
  timeLoggedMs: number;
  spentMs?: number;
```

In `interface ScheduledBlock` add (after `engineKey: string | null;`):

```ts
  engineKey: string | null;
  startedAt?: string | null;
```

In `interface Settings` add (after `taskBufferMs?: number;`):

```ts
  taskBufferMs?: number;
  requireStartToTrack?: boolean;
```

In `interface SettingsInput` add (after `taskBufferMs?: number;`):

```ts
  taskBufferMs?: number;
  requireStartToTrack?: boolean;
```

- [ ] **Step 2: Client method.** In `packages/web/src/api/client.ts`, add to the `ApiClient` interface (after `createScheduledBlock`):

```ts
  createScheduledBlock(body: CreateScheduledBlockInput): Promise<ScheduledBlock>;
  startBlock(id: string): Promise<ScheduledBlock>;
```

And to the returned implementation object (after `createScheduledBlock: …`):

```ts
    createScheduledBlock: (body) => request('POST', '/schedule', body),
    startBlock: (id) => request('POST', `/schedule/${id}/start`),
```

- [ ] **Step 3: Fake client default.** In `packages/web/src/test/fakes.tsx`, add to the `base` object (after `createScheduledBlock: …`):

```ts
    createScheduledBlock: notImplemented('createScheduledBlock'),
    startBlock: notImplemented('startBlock'),
```

- [ ] **Step 4: Query mutation.** In `packages/web/src/api/queries.ts`, add after `useCreateScheduledBlockMutation`:

```ts
export function useStartBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.startBlock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
    },
  });
}
```

- [ ] **Step 5: Typecheck via build.**

Run: `npm --workspace @notreclaim/web run build`
Expected: tsc + vite build succeed.

- [ ] **Step 6: Commit.**

```bash
git add packages/web/src/api/types.ts packages/web/src/api/client.ts packages/web/src/api/queries.ts packages/web/src/test/fakes.tsx
git commit -m "feat(web): startBlock client + useStartBlockMutation + time-tracking types"
```

---

## Phase 5 — Web UI

### Task 11: settings checkbox

**Files:**
- Modify: `packages/web/src/app/settings/settingsForm.ts`, `SettingsForm.tsx`
- Test: `packages/web/src/app/settings/SettingsForm.test.tsx`

- [ ] **Step 1: Write a failing test.** In `SettingsForm.test.tsx`, add (mirror the file's existing render helper — it renders `<SettingsForm initial={…} onSave={…} />`):

```ts
  it('toggles requireStartToTrack and includes it on save', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={{ ...baseInitial, requireStartToTrack: false }} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('require-start'));
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ requireStartToTrack: true }));
  });
```

> Reuse the file's existing initial-state factory in place of `baseInitial` (open the test to see its name; it builds a `SettingsFormState`). Add `requireStartToTrack: false` to that factory if present.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: FAIL (`require-start` not found).

- [ ] **Step 3: Implement form state.** In `settingsForm.ts`:

Add to `SettingsFormState` (after `taskBufferMs: number;`):

```ts
  taskBufferMs: number;
  requireStartToTrack: boolean;
```

In `toFormState` return (after `taskBufferMs: s.taskBufferMs ?? 0,`):

```ts
    taskBufferMs: s.taskBufferMs ?? 0,
    requireStartToTrack: s.requireStartToTrack ?? false,
```

In `defaultFormState` return (after `taskBufferMs: 0,`):

```ts
    taskBufferMs: 0,
    requireStartToTrack: false,
```

In `toSettingsInput` return (after `taskBufferMs: s.taskBufferMs,`):

```ts
    taskBufferMs: s.taskBufferMs,
    requireStartToTrack: s.requireStartToTrack,
```

- [ ] **Step 4: Implement the checkbox.** In `SettingsForm.tsx`, inside the "Scheduling" `<section>`, just before its closing `</section>` (line 100), add:

```tsx
        <label className="mt-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
          <input
            type="checkbox"
            data-testid="require-start"
            checked={form.requireStartToTrack}
            onChange={(e) => setForm((f) => ({ ...f, requireStartToTrack: e.target.checked }))}
            className="h-4 w-4 accent-indigo"
          />
          Only count time after I press Start
        </label>
```

- [ ] **Step 5: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/web/src/app/settings/settingsForm.ts packages/web/src/app/settings/SettingsForm.tsx packages/web/src/app/settings/SettingsForm.test.tsx
git commit -m "feat(web): settings checkbox for requireStartToTrack"
```

### Task 12: spent/left on panel cards

**Files:**
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx`
- Test: `packages/web/src/app/planner/PlannerTaskPanel.test.tsx`

- [ ] **Step 1: Write a failing test.** In `PlannerTaskPanel.test.tsx`, add:

```ts
  it('shows spent / total on a card', () => {
    renderPanel([task({ id: 'a', title: 'Has progress', durationMs: 7_200_000, spentMs: 3_600_000 })]);
    expect(screen.getByTestId('panel-progress')).toHaveTextContent('1h / 2h');
  });
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/PlannerTaskPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `PlannerTaskPanel.tsx` `TaskCard`, just before the closing `</div>` of the `min-w-0 flex-1` content block (after the `{meta && …}` line, line 59), add:

```tsx
        {meta && <div className="mt-0.5 truncate text-[12px] text-inkSoft">{meta}</div>}
        {(() => {
          const spent = task.spentMs ?? 0;
          const pct = task.durationMs > 0 ? Math.min(100, (spent / task.durationMs) * 100) : 0;
          return (
            <div data-testid="panel-progress" className="mt-1 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-[11px] text-inkSoft">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)}</span>
            </div>
          );
        })()}
```

(`formatDurationShort` is already imported in this file.)

- [ ] **Step 4: Run — expect PASS** (whole file, to confirm no regressions).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/PlannerTaskPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx
git commit -m "feat(web): show spent/total + progress on planner task cards"
```

### Task 13: spent/left in the task drawer

**Files:**
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Test: `packages/web/src/app/tasks/TaskDrawer.test.tsx`

- [ ] **Step 1: Write a failing test.** In `TaskDrawer.test.tsx`, add (reuse the file's task factory; pass `spentMs`):

```ts
  it('renders spent / total / left', () => {
    renderDrawer(makeTask({ durationMs: 7_200_000, spentMs: 1_800_000 }));
    expect(screen.getByTestId('drawer-spent')).toHaveTextContent('30m / 2h · 1h 30m left');
  });
```

> Use the test's existing render helper + task factory names (open the file). If it has no factory, build a `Task` literal with `spentMs: 1_800_000` and `durationMs: 7_200_000`.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/tasks/TaskDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `TaskDrawer.tsx`, add the import:

```ts
import { formatDurationShort } from '../lib/duration';
```

Insert right after `<h4 className="text-[15px] font-bold text-ink">Edit task</h4>` (line 39):

```tsx
      {(() => {
        const spent = task.spentMs ?? 0;
        const left = Math.max(0, task.durationMs - spent);
        const pct = task.durationMs > 0 ? Math.min(100, Math.round((spent / task.durationMs) * 100)) : 0;
        return (
          <div data-testid="drawer-time" className="rounded-[10px] border border-line bg-bg px-3 py-2">
            <div className="flex items-center justify-between text-[12px] font-semibold text-inkSoft">
              <span>Time spent</span>
              <span data-testid="drawer-spent">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)} · {formatDurationShort(left)} left</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/tasks/TaskDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx
git commit -m "feat(web): spent/total/left line in the task drawer"
```

### Task 14: Start button on the planner tile

**Files:**
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx`, `WeekGrid.tsx`
- Test: `packages/web/src/app/planner/InteractiveBlock.test.tsx`

- [ ] **Step 1: Write failing tests.** In `InteractiveBlock.test.tsx`, add (mirror the file's existing render helper that supplies the required props; add `onStart`/`startedAt`):

```ts
  it('renders a Start button and fires onStart without starting a drag', () => {
    const onStart = vi.fn();
    const onCommit = vi.fn();
    renderBlock({ onStart, onCommit, startedAt: null });
    const btn = screen.getByTestId('block-start');
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows a started indicator instead of the button once started', () => {
    renderBlock({ onStart: vi.fn(), startedAt: '2026-01-05T09:00:00.000Z' });
    expect(screen.queryByTestId('block-start')).toBeNull();
    expect(screen.getByTestId('block-started')).toBeInTheDocument();
  });
```

> `renderBlock` = the test's existing helper. If it passes a fixed prop set, extend it to spread overrides (`{ ...defaults, ...over }`) so `onStart`/`startedAt` flow through.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement props.** In `InteractiveBlock.tsx`, add to `InteractiveBlockProps` (after `onDelete?…`):

```ts
  onDelete?: () => void;
  onStart?: () => void;
  startedAt?: string | null;
```

Destructure them (line 33) — add `onStart, startedAt` to the list.

Insert the button right after the title line `<span className="font-medium">{startLabel}</span> {title}` (line 272):

```tsx
      <span className="font-medium">{startLabel}</span> {title}
      {onStart && (startedAt
        ? <span data-testid="block-started" className="ml-1 rounded bg-black/15 px-1 text-[10px] font-semibold">Started</span>
        : (
          <button
            type="button"
            data-testid="block-start"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onStart(); }}
            className="ml-1 rounded bg-black/25 px-1.5 text-[10px] font-bold text-white hover:bg-black/45"
          >
            Start
          </button>
        ))}
```

- [ ] **Step 4: Thread through WeekGrid.** In `WeekGrid.tsx`:

Add to `WeekGridProps` (after `onScheduleTaskAt?…`):

```ts
  onScheduleTaskAt?: (taskId: string, dayStartMs: number, startMin: number) => void;
  onStartBlock?: (id: string) => void;
```

Destructure `onStartBlock` in the props line (line 75).

Add `startedAt` to the `Item` interface (after `taskId: string | null;`):

```ts
  taskId: string | null;
  startedAt: string | null;
```

Set it in `toItems` `fromBlocks` (after `taskId: b.taskId`):

```ts
      eventId: null, taskId: b.taskId, startedAt: b.startedAt ?? null };
```

And for `fromEvents` add `startedAt: null` to that object literal too (so the `Item` type is satisfied).

Pass to `InteractiveBlock` (in the `it.kind !== 'meeting' && blockId` branch, alongside `onDelete=…`):

```tsx
                          onDelete={onDeleteBlock ? () => onDeleteBlock(blockId) : undefined}
                          onStart={onStartBlock && it.taskId ? () => onStartBlock(blockId) : undefined}
                          startedAt={it.startedAt}
```

- [ ] **Step 5: Run — expect PASS** (InteractiveBlock + WeekGrid tests).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx src/app/planner/WeekGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx
git commit -m "feat(web): Start button on planner task tiles"
```

### Task 15: Start button in the next-task widget

**Files:**
- Modify: `packages/web/src/app/shell/TopBar.tsx`
- Test: `packages/web/src/app/shell/TopBar.test.tsx`

- [ ] **Step 1: Write a failing test.** In `TopBar.test.tsx`, add (the file already uses `renderWithProviders` + `fakeApiClient`; provide a future task block via `getSchedule`):

```ts
  it('starts the next task block via the Start button', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: vi.fn(async () => [{
        id: 'nb', userId: 'u1', title: 'Next thing',
        startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z',
        taskId: 't1', habitId: null, pinned: false, engineKey: null, startedAt: null,
      }]),
      startBlock,
    });
    renderWithProviders(<TopBar onNewTask={() => {}} now={() => Date.parse('2026-01-05T14:00:00.000Z')} />, { api });
    await waitFor(() => expect(screen.getByTestId('next-task')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('next-task-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('nb'));
  });
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `TopBar.tsx`:

Add the import:

```ts
import { useScheduleQuery, useStartBlockMutation } from '../../api/queries';
```

Inside the component, after `const scheduleQ = useScheduleQuery();`:

```ts
  const startBlock = useStartBlockMutation();
```

Add the Start button right after the existing `next-task` `<button>` (after line 37, still inside the `{nextBlock && (…)}`). Change the wrapper to a fragment so both render:

```tsx
      {nextBlock && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="next-task"
            onClick={() => void navigate('/')}
            className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[14px] font-semibold text-ink/70 hover:bg-line"
          >
            <Icons.clock size={16} />
            Next: {nextBlock.title} · {relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs)}
          </button>
          {nextBlock.startedAt
            ? <span data-testid="next-task-started" className="text-[13px] font-semibold text-inkSoft">Started</span>
            : (
              <button
                type="button"
                data-testid="next-task-start"
                onClick={() => startBlock.mutate(nextBlock.id)}
                className="rounded-[9px] bg-indigo px-3 py-2 text-[13px] font-bold text-white hover:bg-indigo600"
              >
                Start
              </button>
            )}
        </div>
      )}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/shell/TopBar.tsx packages/web/src/app/shell/TopBar.test.tsx
git commit -m "feat(web): Start button in the next-task topbar widget"
```

### Task 16: wire Start into the Planner page

**Files:**
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Test: `packages/web/src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Write a failing test.** In `Planner.test.tsx`, add (the block fixture has `taskId: 't1'`; add a matching task so the tile + panel render, then click the tile Start):

```ts
  it('starts a block from the planner tile', async () => {
    const startBlock = vi.fn(async () => blocks[0]!);
    const api = makeApi({
      listTasks: vi.fn(async () => [{
        id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 3_600_000,
        dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, notBefore: null,
        status: 'pending', completedAt: null, timeLoggedMs: 0, spentMs: 0, subtasks: [], createdAt: '', updatedAt: '',
      }] as Task[]),
      startBlock,
    });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument());
    fireEvent.click(await screen.findByTestId('block-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('b1'));
  });
```

- [ ] **Step 2: Run — expect FAIL** (no `block-start` rendered / not wired).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/pages/Planner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `Planner.tsx`:

Add `useStartBlockMutation` to the imports from `'../../api/queries'`.

After `const createBlock = useCreateScheduledBlockMutation();`:

```ts
  const startBlock = useStartBlockMutation();
```

Pass to `WeekGrid` (after `onScheduleTaskAt={onScheduleTaskAt}`):

```tsx
          onScheduleTaskAt={onScheduleTaskAt}
          onStartBlock={(id) => startBlock.mutate(id)}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/pages/Planner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): wire Start mutation into the planner grid"
```

---

## Phase 6 — Verify

### Task 17: full suites, build, live check

- [ ] **Step 1: Per-package tests (never from root).**

```bash
npm --workspace @notreclaim/db test
npm --workspace @notreclaim/core test
npm --workspace @notreclaim/server test
(cd packages/web && npm test)   # sets TZ=UTC
```
Expected: all green.

- [ ] **Step 2: Build everything.**

```bash
npm run build
```
Expected: all workspaces compile.

- [ ] **Step 3: Rebuild + restart the API, restart Vite, live-verify.**

```bash
set -a && . ./.env.run && set +a && node packages/server/dist/server.js   # (background) :3000
cd packages/web && setsid nohup npm run dev >/tmp/vite.log 2>&1 < /dev/null & disown   # :5173
```
Then in the browser (auth URL with the demo token), confirm:
- Settings shows "Only count time after I press Start" and it saves.
- A task tile shows a **Start** button; clicking it snaps the block start to the nearest 15 min, pins it, and flips to **Started**.
- The next-task widget shows **Start** and starts the next block.
- Task drawer + panel cards show `spent / total` and a progress bar; as a block finishes, spent grows and the scheduler stops planning once left hits 0.
- With the setting ON, an un-started block that has passed disappears on reload.

- [ ] **Step 4: Update memory** (`project-status.md` + `MEMORY.md`) with a one-line summary of the time-tracking feature and the new `startedAt`/`requireStartToTrack`/`spentMs`/`POST /schedule/:id/start` surfaces.

- [ ] **Step 5: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/time-tracking` to `main`.

---

## Self-review notes (already reconciled)

- **Spec coverage:** spent/left (Tasks 4,9,12,13), setting (Tasks 1,3,6,11), Start+snap (Tasks 2,7,14,15,16), discard sweep (Task 8), scheduler tie-in / stop-at-0 + re-plan missed (Task 5), resize-after-start (works for free — started blocks are pinned & resizable; `computeSpentMs` uses the block's actual start/end; covered by the existing PATCH path + Task 5's future-pinned coverage).
- **Type names:** `requireStartToTrack`, `startedAt`, `spentMs`, `round15`, `computeSpentMs`, `useStartBlockMutation`, `startBlock`, `onStartBlock` used consistently across DB→core→server→web.
- **No silent caps:** the discard sweep deletes only `taskId && startedAt == null && endsAt <= now` blocks, and only in manual mode.
