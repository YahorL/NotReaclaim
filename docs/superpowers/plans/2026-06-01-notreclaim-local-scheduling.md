# Decouple Scheduling/Persistence from Google — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NotReclaim schedule AND persist a committed plan with no Google account; keep Google as an optional sync layer with identical behavior when connected.

**Architecture:** Lift the Google-free keyed `ScheduledBlock` diff out of `@notreclaim/google` `reconcile` into `@notreclaim/core` (`applyDesiredSchedule`, parameterized by an optional `ScheduleMirror`). `planLocally` runs compute+apply with no mirror. The server routes each re-plan to Google `reconcile` when the user has a refresh token, else `planLocally`. The Planner dedupes the proposed overlay against now-populated committed blocks.

**Tech Stack:** TS ESM strict (`noUncheckedIndexedAccess`); vitest; DI + injected `now`; `FakeGoogleClient` (no real Google); `@notreclaim/db` repo tests hit Postgres.

**Conventions (every task):** explicit `.js` import extensions in backend packages (core/google/server/db); EXTENSIONLESS + no `import React` in `packages/web`; per-package test scripts. **No DB migration** — `ScheduledBlock.googleEventId`/`googleCalendarId` are already `String?` and `@@unique([userId, engineKey])` exists.

**Grounding (verified signatures):**
- `@notreclaim/scheduler` engine block: `{ id, sourceType:'task'|'habit', sourceId, title, start:number, end:number, ... }`; `ScheduleResult { blocks, unscheduled }`.
- `@notreclaim/db` `ScheduledBlockRepository`: `listByUserInRange(userId, start:Date, end:Date)`, `create(userId, CreateScheduledBlockInput)`, `update(userId, id, UpdateScheduledBlockInput)`, `delete(userId, id)`. `CreateScheduledBlockInput` has optional `googleEventId?/googleCalendarId?/engineKey?` (nullable). `DbScheduledBlock` (Prisma `ScheduledBlock`) has `startsAt/endsAt:Date`, `pinned`, `engineKey:string|null`, `googleEventId:string|null`.
- `@notreclaim/core`: `toScheduledBlockInput(block)`, `computeDesiredSchedule(repos,userId,now)`, `SchedulingRepositories`, `SettingsRequiredError`.
- `@notreclaim/google`: `GoogleClient.insertEvent(at,calId,write)→{googleEventId}`, `updateEvent(at,calId,id,write)`, `deleteEvent(at,calId,id)`; `toGoogleEventWrite(block)`; `detectDrift(...)→{pinned,removed}`; `ReconcileDeps`/`ReconcileResult`.
- `@notreclaim/server` `AppDeps.reconcile: (userId,now)=>Promise<ReconcileResult>` is used by `POST /schedule/replan` (`schedule-routes.ts`) and the after-mutation hook (`app.ts` → `replanAfterMutation`). `server.ts` builds `reconcileBound` and a `users` repo (`createUserRepository`); `users.findById(userId)` returns Prisma `User` with `googleRefreshToken:string|null`.

---

## File Structure

- Create `packages/core/src/apply.ts` (+ `apply.test.ts`): `ScheduleMirror`, `applyDesiredSchedule`, `planLocally`. Export from `packages/core/src/index.ts`.
- Modify `packages/google/src/reconcile.ts`: delegate the diff to `applyDesiredSchedule` via a `googleMirror`.
- Create `packages/server/src/replan-router.ts` (+ `test/replan-router.test.ts`): `makeReplan`. Modify `packages/server/src/server.ts` to wire it.
- Modify `packages/web/src/app/pages/Planner.tsx` (+ `Planner.test.tsx`): dedupe proposed overlay vs committed `engineKey`s.

---

## Task 1: core `applyDesiredSchedule` + `ScheduleMirror` + `planLocally`

**Files:**
- Create: `packages/core/src/apply.ts`
- Create: `packages/core/src/apply.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/core/src/apply.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { ScheduledBlock as DbScheduledBlock } from '@notreclaim/db';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { applyDesiredSchedule, type ScheduleMirror } from './apply.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const HORIZON = NOW + 24 * 60 * 60 * 1000;

function dbBlock(over: Partial<DbScheduledBlock> = {}): DbScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'A',
    startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T10:00:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0',
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  } as DbScheduledBlock;
}
const desired = (blocks: ScheduleResult['blocks']): ScheduleResult => ({ blocks, unscheduled: [] });
const eBlock = (over: Partial<ScheduleResult['blocks'][number]> = {}) => ({
  id: 'task:t1:0', sourceType: 'task' as const, sourceId: 't1', title: 'A',
  start: Date.parse('2026-01-05T09:00:00.000Z'), end: Date.parse('2026-01-05T10:00:00.000Z'), ...over,
});

function fakeRepo(seed: DbScheduledBlock[] = []) {
  let rows = [...seed];
  let n = seed.length;
  return {
    rows: () => rows,
    listByUserInRange: vi.fn(async (_u: string, s: Date, e: Date) => rows.filter((b) => b.startsAt < e && b.endsAt > s)),
    create: vi.fn(async (userId: string, data: Record<string, unknown>) => {
      const row = dbBlock({ id: `new-${++n}`, userId, ...data } as Partial<DbScheduledBlock>);
      rows.push(row); return row;
    }),
    update: vi.fn(async (_u: string, id: string, data: Record<string, unknown>) => {
      const row = rows.find((r) => r.id === id)!; Object.assign(row, data); return row;
    }),
    delete: vi.fn(async (_u: string, id: string) => { rows = rows.filter((r) => r.id !== id); }),
  };
}

describe('applyDesiredSchedule (local, no mirror)', () => {
  it('creates a new block with null google fields and engineKey set', async () => {
    const repo = fakeRepo([]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({
      engineKey: 'task:t1:0', googleEventId: null, googleCalendarId: null, title: 'A',
    }));
  });

  it('updates a keyed block whose times changed', async () => {
    const repo = fakeRepo([dbBlock()]);
    const moved = eBlock({ start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z') });
    const res = await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
  });

  it('deletes a keyed block no longer desired, and leaves pinned blocks untouched', async () => {
    const repo = fakeRepo([dbBlock(), dbBlock({ id: 'b2', engineKey: 'task:t9:0' }), dbBlock({ id: 'p1', pinned: true, engineKey: null })]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 1 }); // b2 removed; b1 unchanged; p1 pinned untouched
    expect(repo.delete).toHaveBeenCalledWith('u1', 'b2');
    expect(repo.delete).not.toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('applyDesiredSchedule (with mirror)', () => {
  it('calls the mirror and stores the returned google ids on create', async () => {
    const repo = fakeRepo([]);
    const mirror: ScheduleMirror = {
      create: vi.fn(async () => ({ googleEventId: 'g1', googleCalendarId: 'cal1' })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(mirror.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({ googleEventId: 'g1', googleCalendarId: 'cal1' }));
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found).**

Run: `npm test -w @notreclaim/core -- src/apply.test.ts`

- [ ] **Step 3: Implement `packages/core/src/apply.ts`** (the diff is lifted verbatim from `@notreclaim/google` reconcile, parameterized by an optional mirror)

```ts
import type { ScheduledBlock as DbScheduledBlock, ScheduledBlockRepository } from '@notreclaim/db';
import type { ScheduledBlock as EngineScheduledBlock, ScheduleResult } from '@notreclaim/scheduler';
import { toScheduledBlockInput } from './bridge.js';
import { computeDesiredSchedule } from './compute.js';
import { SettingsRequiredError } from './errors.js';
import type { SchedulingRepositories } from './assemble.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Side-effect adapter: mirror committed blocks to an external calendar (e.g. Google). */
export interface ScheduleMirror {
  create(block: EngineScheduledBlock): Promise<{ googleEventId: string; googleCalendarId: string }>;
  update(block: EngineScheduledBlock, existing: DbScheduledBlock): Promise<void>;
  delete(existing: DbScheduledBlock): Promise<void>;
}

type BlocksRepo = Pick<ScheduledBlockRepository, 'listByUserInRange' | 'create' | 'update' | 'delete'>;

export interface ApplyScheduleOptions {
  now: number;
  horizonEnd: number;
  mirror?: ScheduleMirror;
}

export interface ApplyCounts { created: number; updated: number; deleted: number }

/** Apply a desired schedule to the DB as a keyed (engineKey) in-place diff. With a mirror, also writes the external calendar. Without one, blocks persist with null google fields. */
export async function applyDesiredSchedule(
  scheduledBlocks: BlocksRepo,
  userId: string,
  desired: ScheduleResult,
  opts: ApplyScheduleOptions,
): Promise<ApplyCounts> {
  const { now, horizonEnd, mirror } = opts;
  const existing = await scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
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
        await mirror?.update(block, match);
        await scheduledBlocks.update(userId, match.id, { startsAt: new Date(block.start), endsAt: new Date(block.end) });
        updated += 1;
      }
      continue;
    }
    const ids = mirror ? await mirror.create(block) : null;
    await scheduledBlocks.create(userId, {
      ...toScheduledBlockInput(block),
      engineKey: block.id,
      googleEventId: ids?.googleEventId ?? null,
      googleCalendarId: ids?.googleCalendarId ?? null,
    });
    created += 1;
  }

  for (const [key, block] of existingByKey) {
    if (seenKeys.has(key)) continue;
    await mirror?.delete(block);
    await scheduledBlocks.delete(userId, block.id);
    deleted += 1;
  }

  return { created, updated, deleted };
}

export interface LocalPlanResult { created: number; updated: number; deleted: number; pinned: number; removed: number }

/** Compute the desired schedule and persist it to the DB with no external sync (no Google). */
export async function planLocally(
  repos: SchedulingRepositories,
  scheduledBlocks: BlocksRepo,
  userId: string,
  now: number,
): Promise<LocalPlanResult> {
  const settings = await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);
  const horizonEnd = now + settings.horizonDays * MS_PER_DAY;
  const desired = await computeDesiredSchedule(repos, userId, now);
  const { created, updated, deleted } = await applyDesiredSchedule(scheduledBlocks, userId, desired, { now, horizonEnd });
  return { created, updated, deleted, pinned: 0, removed: 0 };
}
```

- [ ] **Step 4: Add a `planLocally` test to `apply.test.ts`** (uses a fake scheduling-repo surface)

```ts
import { planLocally } from './apply.js';
import { SettingsRequiredError } from './errors.js';

describe('planLocally', () => {
  const settings = {
    id: 's1', userId: 'u1', timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
    horizonDays: 1, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 1_800_000,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const task = {
    id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1_800_000,
    dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1_800_000, maxChunkMs: 1_800_000,
    category: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
  function repos(over: Record<string, unknown> = {}) {
    return {
      settings: { getByUserId: async () => settings },
      calendarEvents: { listByUserInRange: async () => [] },
      tasks: { listByUser: async () => [task] },
      habits: { listByUser: async () => [] },
      scheduledBlocks: { listByUserInRange: async () => [] },
      ...over,
    } as never;
  }

  it('persists the computed schedule with no mirror and returns the {…,pinned:0,removed:0} shape', async () => {
    const blocks = fakeRepo([]);
    const res = await planLocally(repos(), blocks, 'u1', NOW);
    expect(res.pinned).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.created).toBeGreaterThan(0);
    expect(blocks.rows().every((b) => b.googleEventId === null)).toBe(true);
  });

  it('throws SettingsRequiredError when settings are missing', async () => {
    const blocks = fakeRepo([]);
    await expect(planLocally(repos({ settings: { getByUserId: async () => null } }), blocks, 'u1', NOW))
      .rejects.toBeInstanceOf(SettingsRequiredError);
  });
});
```

- [ ] **Step 5: Export from `packages/core/src/index.ts`** (append):

```ts
export { applyDesiredSchedule, planLocally } from './apply.js';
export type { ScheduleMirror, ApplyScheduleOptions, ApplyCounts, LocalPlanResult } from './apply.js';
```

- [ ] **Step 6: Run the core tests + build**

Run: `npm test -w @notreclaim/core -- src/apply.test.ts` (expect PASS), then `npm test -w @notreclaim/core` (all pass), then `npm run build -w @notreclaim/core` (clean).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/apply.ts packages/core/src/apply.test.ts packages/core/src/index.ts
git commit -m "feat(core): applyDesiredSchedule (+ optional mirror) and planLocally"
```

---

## Task 2: refactor `@notreclaim/google` `reconcile` to delegate the diff

**Files:**
- Modify: `packages/google/src/reconcile.ts`

- [ ] **Step 1: Rewrite the body of `reconcile` in `packages/google/src/reconcile.ts`** to build a `ScheduleMirror` and delegate to `applyDesiredSchedule`. Keep the `ReconcileDeps`/`ReconcileResult` exports and the imports for `ensureAutoScheduledCalendar`/`detectDrift`/`toGoogleEventWrite` unchanged. Replace the hand-rolled diff loop (and its `computeDesiredSchedule`/`existing`/`existingByKey` bookkeeping) with:

```ts
import type { ScheduledBlockRepository, UserRepository } from '@notreclaim/db';
import {
  computeDesiredSchedule,
  applyDesiredSchedule,
  SettingsRequiredError,
  type ScheduleMirror,
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

/** Detect drift, recompute the desired schedule, and apply a keyed diff to Google + DB. */
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

  const mirror: ScheduleMirror = {
    create: async (block) => {
      const { googleEventId } = await deps.client.insertEvent(accessToken, calendarId, toGoogleEventWrite(block));
      return { googleEventId, googleCalendarId: calendarId };
    },
    update: async (block, existing) => {
      await deps.client.updateEvent(accessToken, calendarId, existing.googleEventId as string, toGoogleEventWrite(block));
    },
    delete: async (existing) => {
      if (existing.googleEventId) await deps.client.deleteEvent(accessToken, calendarId, existing.googleEventId);
    },
  };

  const { created, updated, deleted } = await applyDesiredSchedule(
    deps.scheduledBlocks, userId, desired, { now, horizonEnd, mirror },
  );

  return { created, updated, deleted, pinned, removed };
}
```

This preserves the exact external behavior (insert→create, update→update, delete→delete, in the same order, with the same `googleEventId` guard on delete).

- [ ] **Step 2: Run the google tests** — they should stay green (behavior identical).

Run: `npm test -w @notreclaim/google`
Expected: ALL PASS. If a test asserts an internal detail that legitimately changed, adapt the assertion minimally **without changing observable behavior**; if a test fails on observable behavior, the refactor diverged — fix the code, not the test.

- [ ] **Step 3: Build google**

Run: `npm run build -w @notreclaim/google` (clean).

- [ ] **Step 4: Commit**

```bash
git add packages/google/src/reconcile.ts
git commit -m "refactor(google): reconcile delegates the keyed diff to core applyDesiredSchedule"
```

---

## Task 3: server `makeReplan` router + wiring

**Files:**
- Create: `packages/server/src/replan-router.ts`
- Create: `packages/server/test/replan-router.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing test `packages/server/test/replan-router.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeReplan } from '../src/replan-router.js';

const COUNTS = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 };
const NOW = 1_700_000_000_000;

describe('makeReplan', () => {
  it('routes to Google reconcile when the user is connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => true });
    await replan('u1', NOW);
    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(planLocally).not.toHaveBeenCalled();
  });

  it('routes to local planning when the user is not connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => false });
    await replan('u1', NOW);
    expect(planLocally).toHaveBeenCalledWith('u1', NOW);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found).**

Run: `npm test -w @notreclaim/server -- test/replan-router.test.ts`

- [ ] **Step 3: Implement `packages/server/src/replan-router.ts`**

```ts
import type { ReconcileResult } from '@notreclaim/google';

export interface ReplanRouterDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  planLocally: (userId: string, now: number) => Promise<ReconcileResult>;
  isConnected: (userId: string) => Promise<boolean>;
}

/** Re-plan a user's schedule: Google reconcile when connected, else local persist. */
export function makeReplan(deps: ReplanRouterDeps): (userId: string, now: number) => Promise<ReconcileResult> {
  return async (userId, now) => ((await deps.isConnected(userId)) ? deps.reconcile(userId, now) : deps.planLocally(userId, now));
}
```

- [ ] **Step 4: Run the test — expect PASS (2 tests).**

Run: `npm test -w @notreclaim/server -- test/replan-router.test.ts`

- [ ] **Step 5: Wire it in `packages/server/src/server.ts`.** Add the import, build `planLocally`/`isConnected`/`makeReplan`, and pass the composed re-plan as the existing `reconcile` dep (its semantics are now "re-plan hook"; the field name is kept to avoid churning the route/app/tests — the only production caller difference is that it now branches).

Add to the imports from `@notreclaim/core`:
```ts
import { planLocally } from '@notreclaim/core';
```
Add to the `@notreclaim/server` local imports:
```ts
import { makeReplan } from './replan-router.js';
```
After `reconcileBound`/`syncBound` are defined, add:
```ts
  const planLocallyBound = (userId: string, now: number) => planLocally(schedulingRepos, scheduledBlocks, userId, now);
  const isConnected = async (userId: string): Promise<boolean> => {
    const user = await users.findById(userId);
    return user?.googleRefreshToken != null;
  };
  const replan = makeReplan({ reconcile: reconcileBound, planLocally: planLocallyBound, isConnected });
```
Change the `buildApp({ ... })` call to pass `reconcile: replan` (was `reconcile: reconcileBound`). Leave the poll's `pollAndReplan({ ..., reconcile: reconcileBound, ... })` unchanged (the poll only runs for already-connected users via `listConnectedIds`).

- [ ] **Step 6: Run the full server suite + build**

Run: `npm test -w @notreclaim/server` (ALL PASS — existing schedule/tasks/habits/settings tests still pass; they inject a fake `reconcile` hook via `buildTestApp`, which is unaffected). Run: `npm run build -w @notreclaim/server` (clean — `planLocally` + `makeReplan` typecheck against the real repos in `server.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/replan-router.ts packages/server/test/replan-router.test.ts packages/server/src/server.ts
git commit -m "feat(server): re-plan locally without Google; reconcile only when connected"
```

---

## Task 4: web — dedupe the proposed overlay against committed blocks

**Files:**
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Modify: `packages/web/src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Add a failing test to `packages/web/src/app/pages/Planner.test.tsx`** (inside the existing `describe('Planner', …)`)

```tsx
  it('does not draw a proposed ghost for a block already committed (same engineKey)', async () => {
    const committed: ScheduledBlock[] = [{
      id: 'b1', userId: 'u1', title: 'Committed task',
      startsAt: '2026-01-07T13:00:00.000Z', endsAt: '2026-01-07T14:00:00.000Z',
      taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0',
    }];
    const proposed: PreviewBlock[] = [
      { id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Committed task',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
      { id: 'task:t2:0', sourceType: 'task', sourceId: 't2', title: 'Only proposed',
        start: Date.parse('2026-01-07T15:00:00.000Z'), end: Date.parse('2026-01-07T16:00:00.000Z') },
    ];
    const api = makeApi({
      getSchedule: vi.fn(async () => committed),
      getSchedulePreview: vi.fn(async () => ({ blocks: proposed, unscheduled: [] })),
    });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Committed task')).toBeInTheDocument());
    // the committed block renders solid (data-proposed=false); no proposed ghost duplicates it
    const dupes = screen.getAllByText('Committed task');
    expect(dupes).toHaveLength(1);
    // the not-yet-committed proposed block still shows as a ghost
    const ghost = screen.getByText('Only proposed').closest('[data-testid="event-block"]');
    expect(ghost).toHaveAttribute('data-proposed', 'true');
  });
```

- [ ] **Step 2: Run it — expect FAIL** (today both the committed solid block and the matching proposed ghost render, so "Committed task" appears twice).

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`

- [ ] **Step 3: Dedupe in `packages/web/src/app/pages/Planner.tsx`.** Replace the `proposed={preview.data?.blocks ?? []}` prop on `<WeekGrid>` with a filtered list that drops proposed blocks whose `id` (engineKey) matches a committed block's `engineKey`. Add, before the `return`:

```tsx
  const committedKeys = useMemo(
    () => new Set((schedule.data ?? []).map((b) => b.engineKey).filter((k): k is string => k != null)),
    [schedule.data],
  );
  const proposedGhosts = useMemo(
    () => (preview.data?.blocks ?? []).filter((b) => !committedKeys.has(b.id)),
    [preview.data, committedKeys],
  );
```
and pass `proposed={proposedGhosts}` to `<WeekGrid>` (instead of `preview.data?.blocks ?? []`). `useMemo` is already imported in `Planner.tsx`.

- [ ] **Step 4: Run the Planner test — expect PASS.** Then the full web suite.

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx` (PASS), then `npm test -w @notreclaim/web` (all pass — the existing proposed-overlay tests use empty `getSchedule`, so no committed keys → ghosts unaffected). Then `npm run build -w @notreclaim/web` (clean).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): hide proposed ghosts that are already committed (dedupe overlay)"
```

---

## Task 5: full verification

- [ ] **Step 1: Run every package suite** (Postgres up for `@notreclaim/db`; start only if needed:
`/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start`)

```bash
npm test -w @notreclaim/scheduler
npm test -w @notreclaim/core
npm test -w @notreclaim/google
npm test -w @notreclaim/db
npm test -w @notreclaim/server
npm test -w @notreclaim/web
```
Expected: all PASS.

- [ ] **Step 2: Build the web client** (typechecks tests): `npm run build -w @notreclaim/web` — clean.

- [ ] **Step 3: (optional sanity) confirm the local path end-to-end** against the running dev DB if convenient: a no-Google user's `POST /schedule/replan` returns `200` with counts and `GET /schedule` then returns persisted blocks. Not required for the task; the unit/integration tests cover it.

---

## Notes for the implementer

- The `applyDesiredSchedule` diff is a **verbatim lift** of the existing reconcile loop — preserve it exactly (including the `desiredNew = blocks.filter(b => !pinnedIds.has(b.id))` line) so Google behavior is identical.
- `AppDeps.reconcile` keeps its name deliberately (to avoid churning the route/app/`buildTestApp`/4 server test files); it now holds the branching re-plan hook. Do **not** rename it in this plan.
- No DB migration — `googleEventId`/`googleCalendarId` are already nullable.
- Stage only the files listed per task; never stage `seed-dev.mjs`, `.env.run`, `design_handoff_notreclaim/`, `review/`, `.claude/`.
```
