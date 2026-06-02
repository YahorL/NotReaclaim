# Scheduling Buffers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two configurable scheduling buffers — a padding kept free around meetings, and a minimum break between consecutive auto-scheduled task/habit blocks.

**Architecture:** `meetingBufferMs` pads each calendar `FixedEvent` in `@notreclaim/core` `assemble` (the engine already subtracts `fixedEvents` from free time — no engine change). `taskBufferMs` is a small engine change: `ScheduleInput.blockBufferMs` threaded `schedule() → scheduleTask/scheduleHabit → placeItem`, which reserves `[start, end+gap]` of free time after each placed block. Two `Int @default(0)` Settings columns drive both; the Settings form exposes them as minute inputs.

**Tech Stack:** TypeScript ESM (strict, `noUncheckedIndexedAccess`); Prisma + Postgres; Fastify; React + Vite + Tailwind v3 + TanStack Query; vitest + @testing-library/react@16 + jsdom.

**Conventions (every task):** Backend imports use explicit `.js` extensions; `packages/web` imports are EXTENSIONLESS and NEVER `import React`. Tailwind v3 literal utility classes. DI + injected `now`. Per-package test run: `npm test -w @notreclaim/<pkg>`. Web tests pin `TZ=UTC`; web build = `tsc -p tsconfig.json && vite build`. `@notreclaim/db` tests need userspace Postgres (`/tmp:5432`). Do NOT commit `seed-dev.mjs` / `.env.run` / `.env.test` / `design_handoff_notreclaim/` / `review/` / `.claude/`.

**Sequencing note:** Task 2 adds the two columns to the generated Prisma `Settings` type, so the core/server **test fakes** that build a full `Settings` object (`makeSettings`, `fakeSettingsRepo`) stop typechecking until their task adds the fields (Task 3 fixes core, Task 4 fixes server). The web `Settings`/`SettingsInput` DTOs add the fields as **optional**, so web fixtures need no change; web stays green until Task 5 adds the form. Per-task gate is that task's own package; Task 6 runs the full monorepo. Task 1 (engine) is independent of Prisma and green on its own.

**Branch:** `feat/buffers` (spec committed at `b2494ac`).

---

## File Structure

- `packages/scheduler/src/types.ts` — `ScheduleInput.blockBufferMs?`.
- `packages/scheduler/src/placement.ts` — `placeItem` `gapMs` reservation.
- `packages/scheduler/src/items.ts` — `scheduleTask`/`scheduleHabit` thread `gapMs`.
- `packages/scheduler/src/schedule.ts` — pass `input.blockBufferMs ?? 0`.
- `packages/scheduler/test/{placement,items,schedule}.test.ts` — gap tests.
- `packages/db/prisma/schema.prisma` + migration — two `Int @default(0)` columns.
- `packages/db/src/repositories/settings-repository.ts` — `UpsertSettingsInput` two fields.
- `packages/db/test/repositories/settings-repository.test.ts` — round-trip test.
- `packages/core/src/assemble.ts` — pad meetings + set `blockBufferMs`.
- `packages/core/test/fakes.ts` (`makeSettings`) + `assemble.test.ts` — fields + tests.
- `packages/server/src/schemas.ts` — `settingsSchema` two fields.
- `packages/server/test/fakes.ts` (`fakeSettingsRepo`) + `settings.test.ts` — fields + tests.
- `packages/web/src/api/types.ts` — `Settings`/`SettingsInput` optional fields.
- `packages/web/src/app/settings/{settingsForm.ts,SettingsForm.tsx}` (+ tests) — state + inputs.

---

## Task 1: Engine — `blockBufferMs` gap in `placeItem`

**Files:**
- Modify: `packages/scheduler/src/types.ts`
- Modify: `packages/scheduler/src/placement.ts`
- Modify: `packages/scheduler/src/items.ts`
- Modify: `packages/scheduler/src/schedule.ts:53-56`
- Modify: `packages/scheduler/test/placement.test.ts`, `items.test.ts`, `schedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/scheduler/test/placement.test.ts` (it imports `placeItem`):
```ts
describe('placeItem gapMs', () => {
  it('reserves the gap after each placement so the next chunk starts gap later', () => {
    const res = placeItem([{ start: 0, end: 100 }], [20, 20], 100, undefined, 10);
    expect(res.placements).toEqual([{ start: 0, end: 20 }, { start: 30, end: 50 }]);
  });
  it('is unchanged when gapMs is 0 / omitted (regression)', () => {
    const res = placeItem([{ start: 0, end: 100 }], [20, 20], 100);
    expect(res.placements).toEqual([{ start: 0, end: 20 }, { start: 20, end: 40 }]);
  });
});
```

Append to `packages/scheduler/test/items.test.ts` (it imports `scheduleTask`):
```ts
describe('scheduleTask gapMs', () => {
  it('threads the gap so a task\'s own chunks are spaced', () => {
    const res = scheduleTask([{ start: 0, end: 100 }], { id: 't', title: 'T', priority: 1, durationMs: 40, dueBy: 100, minChunkMs: 20, maxChunkMs: 20 }, 10);
    expect(res.blocks.map((b) => [b.start, b.end])).toEqual([[0, 20], [30, 50]]);
  });
});
```

Append to `packages/scheduler/test/schedule.test.ts` (it imports `schedule`):
```ts
describe('blockBufferMs', () => {
  it('spaces two consecutive tasks by the buffer', () => {
    const mk = (id: string) => ({ id, title: id, priority: 1, durationMs: 20, dueBy: 100, minChunkMs: 20, maxChunkMs: 20 });
    const res = schedule({ workingWindows: [{ start: 0, end: 100 }], fixedEvents: [], pinnedBlocks: [], tasks: [mk('a'), mk('b')], habits: [], blockBufferMs: 10 });
    const a = res.blocks.find((b) => b.sourceId === 'a')!;
    const b = res.blocks.find((b) => b.sourceId === 'b')!;
    expect(b.start - a.end).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/scheduler`
Expected: FAIL — `placeItem`'s 5th arg ignored / `scheduleTask` arity / `blockBufferMs` not used.

- [ ] **Step 3: Add the `ScheduleInput` field**

In `packages/scheduler/src/types.ts`, inside `interface ScheduleInput` (after `habits: Habit[];`), add:
```ts
  /** Minimum free gap (ms) reserved after each placed task/habit block. Default 0. */
  blockBufferMs?: number;
```

- [ ] **Step 4: Reserve the gap in `placeItem`**

In `packages/scheduler/src/placement.ts`, change the `placeItem` signature to accept `gapMs` and pad the subtraction:
```ts
export function placeItem(
  free: Interval[],
  chunkSizes: number[],
  deadline: number,
  candidateWindows?: Interval[],
  gapMs = 0,
): PlaceItemResult {
```
and change the subtraction line (currently `remainingFree = subtractIntervals(remainingFree, [placement]);`) to:
```ts
    remainingFree = subtractIntervals(remainingFree, [{ start: placement.start, end: placement.end + gapMs }]);
```
(The `placement` pushed to `placements` is still `[start, start+size]` — only the free-time consumption is padded. `gapMs = 0` → identical to today.)

- [ ] **Step 5: Thread `gapMs` through `items.ts`**

In `packages/scheduler/src/items.ts`:
- `scheduleTask(free: Interval[], task: FlexibleTask, gapMs = 0): ScheduleItemResult` — change the `placeItem` call to `placeItem(free, chunkSizes, task.dueBy, task.allowedWindows, gapMs)`.
- `scheduleHabit(free: Interval[], habit: Habit, gapMs = 0): ScheduleItemResult` — pass `gapMs` to **both** `placeItem` calls: `placeItem(remainingFree, [habit.chunkMs], period.end, primaryWindow, gapMs)` and the fallback `placeItem(remainingFree, [habit.chunkMs], period.end, bound, gapMs)`.

- [ ] **Step 6: Pass the buffer in `schedule.ts`**

In `packages/scheduler/src/schedule.ts`, change the loop body (lines ~53-56) to:
```ts
    const gapMs = input.blockBufferMs ?? 0;
    const res =
      item.kind === 'task'
        ? scheduleTask(free, item.task, gapMs)
        : scheduleHabit(free, item.habit, gapMs);
```
(Hoist `const gapMs = input.blockBufferMs ?? 0;` above the `for` loop if preferred — either is fine; keep it inside or just before the loop.)

- [ ] **Step 7: Run the tests**

Run: `npm test -w @notreclaim/scheduler`
Expected: PASS (all scheduler tests, including the new gap tests; existing tests unaffected — default 0).

- [ ] **Step 8: Commit**

```bash
git add packages/scheduler
git commit -m "feat(scheduler): blockBufferMs reserves a gap after each placed block"
```

---

## Task 2: DB — `Settings.meetingBufferMs` / `taskBufferMs`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/repositories/settings-repository.ts:4-10`
- Modify: `packages/db/test/repositories/settings-repository.test.ts`

- [ ] **Step 1: Add the columns**

In `model Settings` (after `defaultMaxChunkMs Int`), add:
```prisma
  meetingBufferMs   Int      @default(0)
  taskBufferMs      Int      @default(0)
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd packages/db
set -a; . ./.env.test; set +a
export DATABASE_URL="$TEST_DATABASE_URL"
export SHADOW_DATABASE_URL="${SHADOW_DATABASE_URL:-${TEST_DATABASE_URL%/*}/notreclaim_shadow}"
npx prisma migrate dev --name settings_buffers
```
Expected: `prisma/migrations/<timestamp>_settings_buffers/migration.sql` with two `ALTER TABLE "Settings" ADD COLUMN ... INTEGER NOT NULL DEFAULT 0;` lines, applied, client regenerated.
**Fallback (proven in milestones C/D) if `migrate dev` can't use the shadow DB:** author `prisma/migrations/20260601020000_settings_buffers/migration.sql`:
```sql
ALTER TABLE "Settings" ADD COLUMN "meetingBufferMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "taskBufferMs" INTEGER NOT NULL DEFAULT 0;
```
then:
```bash
psql "$TEST_DATABASE_URL" -c 'ALTER TABLE "Settings" ADD COLUMN "meetingBufferMs" INTEGER NOT NULL DEFAULT 0; ALTER TABLE "Settings" ADD COLUMN "taskBufferMs" INTEGER NOT NULL DEFAULT 0;'
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate resolve --applied 20260601020000_settings_buffers
npx prisma generate
```
The committed migration.sql must be valid forward DDL replayable by `migrate deploy`.

- [ ] **Step 3: Write the failing repository test**

Append to `packages/db/test/repositories/settings-repository.test.ts` (reuse its `users`, `repo`, and the existing `settingsInput()` helper):
```ts
it('round-trips buffer settings and defaults them to 0 when omitted', async () => {
  const user = await users.create({ email: 'buf@example.com' });
  const withBuffers = await repo.upsert(user.id, { ...settingsInput(), meetingBufferMs: 900000, taskBufferMs: 600000 });
  expect(withBuffers).toMatchObject({ meetingBufferMs: 900000, taskBufferMs: 600000 });
  const user2 = await users.create({ email: 'buf2@example.com' });
  const defaults = await repo.upsert(user2.id, settingsInput());
  expect(defaults).toMatchObject({ meetingBufferMs: 0, taskBufferMs: 0 });
});
```

- [ ] **Step 4: Run it**

Run: `npm test -w @notreclaim/db -- settings-repository`
Expected: FAIL — `meetingBufferMs`/`taskBufferMs` not accepted by `UpsertSettingsInput`.

- [ ] **Step 5: Extend `UpsertSettingsInput`**

In `packages/db/src/repositories/settings-repository.ts`, add to `interface UpsertSettingsInput` (after `defaultMaxChunkMs: number;`):
```ts
  meetingBufferMs?: number;
  taskBufferMs?: number;
```
The `upsert` create/update already spread `...data`, so the fields thread through; omitted → Prisma `@default(0)`.

- [ ] **Step 6: Run the tests**

Run: `npm test -w @notreclaim/db`
Expected: PASS (all db tests incl. the new round-trip).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): Settings.meetingBufferMs + taskBufferMs columns"
```

---

## Task 3: Core — `assemble` meeting pad + `blockBufferMs`

**Files:**
- Modify: `packages/core/src/assemble.ts:75`
- Modify: `packages/core/test/fakes.ts` (`makeSettings`)
- Modify: `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Fix the fake + write failing tests**

In `packages/core/test/fakes.ts`, add `meetingBufferMs: 0,` and `taskBufferMs: 0,` to the `makeSettings` return object (after `defaultMaxChunkMs`) — the regenerated Prisma `Settings` now requires them.

Append to `packages/core/test/assemble.test.ts` (reuse `assembleScheduleInput`, `fakeRepos`, `makeSettings`, `makeEvent`, `makeCategory`):
```ts
describe('assembleScheduleInput buffers', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  const settings = (over = {}) => makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never, ...over });
  // makeEvent default: 2026-01-05T10:00–11:00Z

  it('pads meeting FixedEvents by meetingBufferMs', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings({ meetingBufferMs: 15 * 60_000 }), categories: [makeCategory()], events: [makeEvent()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.fixedEvents[0]).toMatchObject({
      start: Date.parse('2026-01-05T09:45:00.000Z'),
      end: Date.parse('2026-01-05T11:15:00.000Z'),
    });
  });

  it('sets blockBufferMs from settings.taskBufferMs', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings({ taskBufferMs: 10 * 60_000 }), categories: [makeCategory()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.blockBufferMs).toBe(10 * 60_000);
  });

  it('defaults to no padding / 0 buffer (backward compatible)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings(), categories: [makeCategory()], events: [makeEvent()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.fixedEvents[0]).toMatchObject({
      start: Date.parse('2026-01-05T10:00:00.000Z'),
      end: Date.parse('2026-01-05T11:00:00.000Z'),
    });
    expect(input.blockBufferMs).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/core -- assemble`
Expected: FAIL — events not padded / `blockBufferMs` undefined.

- [ ] **Step 3: Implement the pad + buffer**

In `packages/core/src/assemble.ts`, replace the `fixedEvents` build (line 75, `const fixedEvents: FixedEvent[] = events.map(toFixedEvent);`) with:
```ts
  const meetingBufferMs = settings.meetingBufferMs ?? 0;
  const fixedEvents: FixedEvent[] = events.map((e) => {
    const fe = toFixedEvent(e);
    return meetingBufferMs > 0 ? { id: fe.id, start: fe.start - meetingBufferMs, end: fe.end + meetingBufferMs } : fe;
  });
```
and change the return statement to include `blockBufferMs`:
```ts
  return { workingWindows: envelope, fixedEvents, pinnedBlocks, tasks, habits, blockBufferMs: settings.taskBufferMs ?? 0 };
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @notreclaim/core`
Expected: PASS (all core tests; existing assemble tests unaffected — default-0 settings yield unpadded events + `blockBufferMs: 0`).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): assemble pads meetings by meetingBufferMs + sets blockBufferMs"
```

---

## Task 4: Server — `settingsSchema` buffer fields

**Files:**
- Modify: `packages/server/src/schemas.ts:38-50`
- Modify: `packages/server/test/fakes.ts` (`fakeSettingsRepo`)
- Modify: `packages/server/test/settings.test.ts`

- [ ] **Step 1: Fix the fake + write failing tests**

In `packages/server/test/fakes.ts`, add `meetingBufferMs: 0,` and `taskBufferMs: 0,` to the `fakeSettingsRepo` `upsert` base `Settings` literal (before the `...data` spread) — the regenerated Prisma `Settings` requires them; `...data` then overrides with any provided values.

Append to `packages/server/test/settings.test.ts` (reuse `buildTestApp`, `tokenFor`, and the existing valid settings payload shape):
```ts
it('persists buffer settings', async () => {
  const { app } = buildTestApp();
  const token = await tokenFor(app);
  const res = await app.inject({
    method: 'PUT', url: '/settings',
    headers: { authorization: `Bearer ${token}` },
    payload: { timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000, meetingBufferMs: 900000, taskBufferMs: 600000 },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ meetingBufferMs: 900000, taskBufferMs: 600000 });
});

it('rejects a negative buffer with 400', async () => {
  const { app } = buildTestApp();
  const token = await tokenFor(app);
  const res = await app.inject({
    method: 'PUT', url: '/settings',
    headers: { authorization: `Bearer ${token}` },
    payload: { timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000, meetingBufferMs: -1 },
  });
  expect(res.statusCode).toBe(400);
});
```
(First READ `settings.test.ts` to match its existing valid-payload field shape.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/server -- settings`
Expected: FAIL — `meetingBufferMs`/`taskBufferMs` stripped by the schema / not echoed.

- [ ] **Step 3: Add the schema fields**

In `packages/server/src/schemas.ts`, add to `settingsSchema` (after `defaultMaxChunkMs: z.number().int().positive(),`):
```ts
  meetingBufferMs: z.number().int().nonnegative().optional(),
  taskBufferMs: z.number().int().nonnegative().optional(),
```
The `PUT /settings` handler already spreads `...body` into the upsert, so no handler change is needed.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @notreclaim/server`
Expected: PASS (all server tests incl. the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): settingsSchema accepts meetingBufferMs + taskBufferMs"
```

---

## Task 5: Web — Settings form buffer inputs

**Files:**
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/app/settings/settingsForm.ts`
- Modify: `packages/web/src/app/settings/SettingsForm.tsx`
- Modify: `packages/web/src/app/settings/settingsForm.test.ts`
- Modify: `packages/web/src/app/settings/SettingsForm.test.tsx`

- [ ] **Step 1: Add the DTO fields (`api/types.ts`)**

- add `meetingBufferMs?: number;` and `taskBufferMs?: number;` to `interface Settings` (after `defaultMaxChunkMs`). **OPTIONAL** — avoids touching existing `Settings` test fixtures; `settingsForm` reads them with `?? 0`.
- add `meetingBufferMs?: number;` and `taskBufferMs?: number;` to `interface SettingsInput` (after `defaultMaxChunkMs`).

- [ ] **Step 2: Failing form test — append to `packages/web/src/app/settings/settingsForm.test.ts`**

(reuse its `toFormState`/`defaultFormState`/`validateSettingsForm`/`toSettingsInput` imports and a `Settings`-literal helper if present)
```ts
it('round-trips buffer fields and rejects a negative buffer', () => {
  const base = defaultFormState('UTC');
  expect(base.meetingBufferMs).toBe(0);
  expect(base.taskBufferMs).toBe(0);
  const out = toSettingsInput({ ...base, meetingBufferMs: 900000, taskBufferMs: 600000 });
  expect(out).toMatchObject({ meetingBufferMs: 900000, taskBufferMs: 600000 });
  expect(validateSettingsForm({ ...base, meetingBufferMs: -60000 }).ok).toBe(false);
});
```

- [ ] **Step 3: Update `settingsForm.ts`**

In `packages/web/src/app/settings/settingsForm.ts`:
- `interface SettingsFormState`: add `meetingBufferMs: number;` and `taskBufferMs: number;` (both ms).
- `toFormState`: add `meetingBufferMs: s.meetingBufferMs ?? 0,` and `taskBufferMs: s.taskBufferMs ?? 0,`.
- `defaultFormState`: add `meetingBufferMs: 0,` and `taskBufferMs: 0,`.
- `interface SettingsFormErrors`: add `meetingBufferMs?: string;` and `taskBufferMs?: string;`.
- `validateSettingsForm`: add, before the `return`:
  ```ts
  if (!Number.isInteger(s.meetingBufferMs) || s.meetingBufferMs < 0) errors.meetingBufferMs = 'Buffer must be a non-negative number of minutes';
  if (!Number.isInteger(s.taskBufferMs) || s.taskBufferMs < 0) errors.taskBufferMs = 'Buffer must be a non-negative number of minutes';
  ```
- `toSettingsInput`: add `meetingBufferMs: s.meetingBufferMs,` and `taskBufferMs: s.taskBufferMs,` to the returned object.

- [ ] **Step 4: Run the form test**

Run: `npm test -w @notreclaim/web -- settings/settingsForm`
Expected: PASS.

- [ ] **Step 5: Failing form-component test — append to `packages/web/src/app/settings/SettingsForm.test.tsx`**

(reuse its render helper + `initial` builder; mirror how it tests the horizon input)
```tsx
it('renders and edits the buffer inputs (minutes ⇄ ms)', () => {
  const onSave = vi.fn();
  renderSettingsForm({ onSave }); // or the file's existing render helper with a default initial
  const meeting = screen.getByTestId('meeting-buffer');
  fireEvent.change(meeting, { target: { value: '15' } });
  const task = screen.getByTestId('task-buffer');
  fireEvent.change(task, { target: { value: '5' } });
  fireEvent.click(screen.getByTestId('save'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ meetingBufferMs: 900000, taskBufferMs: 300000 }));
});
```
(If the file has no `renderSettingsForm` helper, render `<SettingsForm initial={defaultFormState('UTC')} onSave={onSave} />` directly, importing `defaultFormState` and the testing-library helpers the file already uses.)

- [ ] **Step 6: Run to verify failure**

Run: `npm test -w @notreclaim/web -- settings/SettingsForm`
Expected: FAIL — `meeting-buffer`/`task-buffer` testids not found.

- [ ] **Step 7: Add the inputs — `SettingsForm.tsx`**

In the **Scheduling** `<section>` (after the "Default max chunk" `<div>`), add:
```tsx
        <div className="mb-2">
          <label className={labelCls}>Buffer around meetings (min)</label>
          <input type="number" data-testid="meeting-buffer" className={`${ctlCls} w-20`} value={Math.round(form.meetingBufferMs / 60000)} onChange={(e) => setForm((f) => ({ ...f, meetingBufferMs: Number(e.target.value) * 60000 }))} />
          {errors.meetingBufferMs && <p data-testid="err-meetingBufferMs" className={errCls}>{errors.meetingBufferMs}</p>}
        </div>
        <div className="mb-2">
          <label className={labelCls}>Break between tasks (min)</label>
          <input type="number" data-testid="task-buffer" className={`${ctlCls} w-20`} value={Math.round(form.taskBufferMs / 60000)} onChange={(e) => setForm((f) => ({ ...f, taskBufferMs: Number(e.target.value) * 60000 }))} />
          {errors.taskBufferMs && <p data-testid="err-taskBufferMs" className={errCls}>{errors.taskBufferMs}</p>}
        </div>
```
(`labelCls`/`ctlCls`/`errCls` already exist in the component.)

- [ ] **Step 8: Run the web suite + build**

Run: `npm test -w @notreclaim/web` (ALL pass) then `npm run build -w @notreclaim/web` (clean).
Expected: green (optional `Settings` DTO fields don't disturb existing fixtures).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/app/settings
git commit -m "feat(web): meeting + task buffer inputs in Settings"
```

---

## Task 6: Verification

**Files:** none.

- [ ] **Step 1: Full web suite + build**

Run: `npm test -w @notreclaim/web` then `npm run build -w @notreclaim/web` → all pass, clean.

- [ ] **Step 2: Full monorepo (Postgres up)**

```bash
pg_isready -h /tmp -p 5432
for p in scheduler core db google server web; do echo "== $p =="; npm test -w @notreclaim/$p 2>&1 | grep -E "Test Files|Tests "; done
```
Expected: every package green (scheduler/core/db/server/web gained tests; google unchanged).

- [ ] **Step 3: Whole-branch review**

Dispatch a final reviewer over `git diff main...feat/buffers` (data flow: Settings minutes→ms → `meetingBufferMs` pads meeting `FixedEvent`s in assemble; `taskBufferMs` → `ScheduleInput.blockBufferMs` → `placeItem` gap-after; conventions; engine default-0 = no-op; backward-compat; migration replay) and proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

- **Spec goals → tasks:** `meetingBufferMs` pad (T3) ✓; `taskBufferMs` gap via engine (T1 + assemble sets `blockBufferMs` T3) ✓; two `Int @default(0)` columns (T2) ✓; server schema (T4) ✓; web minute inputs in Scheduling (T5) ✓; meetings render unpadded (no Planner change — buffer is assemble-only) ✓.
- **Type consistency:** buffers are **ms** everywhere (db `Int`, server zod `int`, web DTO `number`, form-state `number`); only the two `<input>` widgets show/write minutes (`/60000`, `*60000`). Engine field is `blockBufferMs?: number` (ms); `placeItem` param `gapMs = 0`; `scheduleTask`/`scheduleHabit` param `gapMs = 0`.
- **Deliberate choices:** web `Settings`/`SettingsInput` buffer fields are **optional** (avoid a fixture sweep; backend Prisma/zod authoritative). Core `makeSettings` (T3) + server `fakeSettingsRepo` (T4) add `…: 0` because they build a Prisma `Settings` (required after the migration). Default 0 everywhere = byte-for-byte today's scheduling. The meeting buffer is a no-op locally without Google (no meetings) — documented; the task gap is observable on the proposed schedule.
- **No engine change for the meeting buffer** (assemble pad only); the only engine change is the `blockBufferMs`/`gapMs` gap-after, default 0.
