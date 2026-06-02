# "Schedule after" (not-before constraint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the New Task modal's dead "Schedule after" field a real per-task **not-before** constraint — the scheduler won't place a task before that time.

**Architecture:** Add a nullable `Task.notBefore` column. In `@notreclaim/core` `assemble`, clip the task's `allowedWindows` (from Milestone C) to `[notBefore, horizonEnd]` via `intersectIntervals` — **no `@notreclaim/scheduler` engine change**. Thread `notBefore` through the db repo, server schema/handlers, web DTOs, and the New Task modal + edit drawer (a `datetime-local`; empty = "Now"/null).

**Tech Stack:** TypeScript ESM (strict, `noUncheckedIndexedAccess`); Prisma + Postgres; Fastify; React + Vite + Tailwind v3 + TanStack Query; vitest + @testing-library/react@16 + jsdom.

**Conventions (every task):** Backend imports use explicit `.js` extensions; `packages/web` imports are EXTENSIONLESS and NEVER `import React`. Tailwind v3 literal utility classes. DI + injected `now` (no `Date.now()` in pure modules). Per-package test run: `npm test -w @notreclaim/<pkg>`. Web tests pin `TZ=UTC`; web build = `tsc -p tsconfig.json && vite build`. `@notreclaim/db` tests need userspace Postgres (`/tmp:5432`). Do NOT commit `seed-dev.mjs` / `.env.run` / `.env.test` / `design_handoff_notreclaim/` / `review/` / `.claude/`.

**Sequencing note:** Task 1 adds `Task.notBefore` to the generated Prisma type, so the core/server **test fakes** that build a full `Task` object stop typechecking until their task adds `notBefore: null` (Task 2 fixes core, Task 3 fixes server). The per-task gate is that task's **own package** tests. The **web** package is unaffected by the Prisma change (its `Task` DTO is hand-written and the new field is optional), so web stays green until Tasks 4–5 add the field intentionally. Task 5 ends with a full-monorepo verification.

**Branch:** `feat/schedule-after` (spec committed at `76a2a56`).

---

## File Structure

- `packages/db/prisma/schema.prisma` — add `Task.notBefore DateTime? @db.Timestamptz`.
- `packages/db/prisma/migrations/<ts>_task_not_before/` — generated migration.
- `packages/db/src/repositories/task-repository.ts` — `notBefore?: Date | null` on both inputs.
- `packages/db/test/repositories/task-repository.test.ts` — round-trip test.
- `packages/core/src/assemble.ts` — `intersectIntervals` import + clip windows to `notBefore`.
- `packages/core/test/fakes.ts` (`makeTask`) + `assemble.test.ts` — `notBefore: null` + tests.
- `packages/server/src/schemas.ts` — `createTaskSchema.notBefore`.
- `packages/server/src/task-routes.ts` — `notBefore` → `Date` in POST/PATCH.
- `packages/server/test/fakes.ts` (`fakeTaskRepo`) + `tasks.test.ts` — `notBefore: null` + tests.
- `packages/web/src/api/types.ts` — `Task.notBefore?`, `CreateTaskInput.notBefore?`.
- `packages/web/src/app/shell/{newTaskForm.ts,NewTaskModal.tsx}` (+ tests) — modal field.
- `packages/web/src/app/tasks/{taskForm.ts,TaskDrawer.tsx}` (+ tests) — drawer field.

---

## Task 1: DB — `Task.notBefore` column + repository

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/repositories/task-repository.ts:4-24`
- Modify: `packages/db/test/repositories/task-repository.test.ts`

- [ ] **Step 1: Add the column to the schema**

In `model Task`, add (e.g. right after `dueBy DateTime @db.Timestamptz`):

```prisma
  notBefore    DateTime?  @db.Timestamptz
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd packages/db
set -a; . ./.env.test; set +a                                   # loads TEST_DATABASE_URL
export DATABASE_URL="$TEST_DATABASE_URL"
export SHADOW_DATABASE_URL="${SHADOW_DATABASE_URL:-${TEST_DATABASE_URL%/*}/notreclaim_shadow}"
npx prisma migrate dev --name task_not_before
```

Expected: `prisma/migrations/<timestamp>_task_not_before/migration.sql` containing
`ALTER TABLE "Task" ADD COLUMN "notBefore" TIMESTAMPTZ;`, applied, and `prisma generate` run (the
client's `Task` now has `notBefore: Date | null`). The `notreclaim_shadow` DB already exists from the
categories milestone. **Fallback if `migrate dev` cannot use the shadow DB:** create the file manually —
`mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_task_not_before` is not available (no `date` in pure
steps); instead author `prisma/migrations/20260601010000_task_not_before/migration.sql` with the single
`ALTER TABLE` line above, then `DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate resolve --applied 20260601010000_task_not_before`,
apply the SQL with `psql "$TEST_DATABASE_URL" -c 'ALTER TABLE "Task" ADD COLUMN "notBefore" TIMESTAMPTZ;'`,
then `npx prisma generate`.

- [ ] **Step 3: Write the failing repository test**

Append to `packages/db/test/repositories/task-repository.test.ts` (reuse the file's existing `users` /
`repo` consts — they are `createUserRepository(prisma)` / `createTaskRepository(prisma)`; match the
file's existing create-task field shape):

```ts
it('round-trips notBefore (set and clear)', async () => {
  const user = await users.create({ email: 'nb@example.com' });
  const created = await repo.create(user.id, {
    title: 'T', priority: 1, durationMs: 1, dueBy: new Date('2026-01-09T00:00:00.000Z'),
    minChunkMs: 1, maxChunkMs: 1, notBefore: new Date('2026-01-06T13:00:00.000Z'),
  });
  expect(created.notBefore?.toISOString()).toBe('2026-01-06T13:00:00.000Z');
  const cleared = await repo.update(user.id, created.id, { notBefore: null });
  expect(cleared.notBefore).toBeNull();
});
```

- [ ] **Step 4: Run it (fails until the repo input types accept `notBefore`)**

Run: `npm test -w @notreclaim/db -- task-repository`
Expected: FAIL — `notBefore` not an accepted input property (TS) / not persisted.

- [ ] **Step 5: Add `notBefore` to the repository inputs**

In `packages/db/src/repositories/task-repository.ts`, add `notBefore?: Date | null;` to BOTH
`CreateTaskInput` (after `maxChunkMs`) and `UpdateTaskInput` (after `maxChunkMs`). The `create`/`update`
methods already spread their `data`, so no method-body change is needed.

- [ ] **Step 6: Run the tests**

Run: `npm test -w @notreclaim/db`
Expected: PASS (all db tests, including the new round-trip).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): Task.notBefore column + repository input"
```

---

## Task 2: Core — `assemble` clips windows to `notBefore`

**Files:**
- Modify: `packages/core/src/assemble.ts`
- Modify: `packages/core/test/fakes.ts` (`makeTask`)
- Modify: `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Fix the fake + write the failing tests**

In `packages/core/test/fakes.ts`, add `notBefore: null,` to the `makeTask` return object (after
`maxChunkMs`/`categoryId`) — the regenerated Prisma `Task` now requires it.

Append to `packages/core/test/assemble.test.ts` (reuse its imports of `assembleScheduleInput`,
`fakeRepos`, `makeSettings`, `makeTask`, `makeCategory`):

```ts
describe('assembleScheduleInput notBefore', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  const settings = makeSettings({ workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as never }); // Mon 09:00–17:00

  it('clips a task\'s windows to start no earlier than notBefore', async () => {
    const t = makeTask({ id: 't1', notBefore: new Date('2026-01-05T13:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    const win = input.tasks.find((x) => x.id === 't1')!.allowedWindows!;
    expect(win.every((w) => w.start >= Date.parse('2026-01-05T13:00:00.000Z'))).toBe(true);
    expect(win.some((w) => w.start === Date.parse('2026-01-05T13:00:00.000Z'))).toBe(true);
  });

  it('is a no-op when notBefore is in the past', async () => {
    const t = makeTask({ id: 't2', notBefore: new Date('2026-01-01T00:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    const win = input.tasks.find((x) => x.id === 't2')!.allowedWindows!;
    expect(win.some((w) => w.start === Date.parse('2026-01-05T09:00:00.000Z'))).toBe(true);
  });

  it('yields no windows when notBefore is beyond the horizon', async () => {
    const t = makeTask({ id: 't3', notBefore: new Date('2026-02-01T00:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    expect(input.tasks.find((x) => x.id === 't3')!.allowedWindows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/core -- assemble`
Expected: FAIL — windows are not clipped (notBefore ignored).

- [ ] **Step 3: Implement the clip**

In `packages/core/src/assemble.ts`:

Change the scheduler value import to add `intersectIntervals`:

```ts
import { mergeIntervals, intersectIntervals } from '@notreclaim/scheduler';
```

In the tasks loop, after `allowedWindows` is resolved and before the `tasks.push`, clip it when
`notBefore` is set:

```ts
    let allowedWindows = resolvedId ? expandedByCategoryId.get(resolvedId)! : workingWindows;
    if (t.notBefore) {
      allowedWindows = intersectIntervals(allowedWindows, [{ start: t.notBefore.getTime(), end: horizonEnd.getTime() }]);
    }
    tasks.push({ ...flexible, durationMs: remaining, allowedWindows });
```

(`allowedWindows` becomes `let`; `horizonEnd` is the existing `new Date(now + horizonDays * MS_PER_DAY)`.)

- [ ] **Step 4: Run the tests**

Run: `npm test -w @notreclaim/core`
Expected: PASS (all core tests; the existing assemble tests are unaffected — null `notBefore` skips the clip).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): clip task allowedWindows to notBefore in assemble"
```

---

## Task 3: Server — schema + handler conversion

**Files:**
- Modify: `packages/server/src/schemas.ts`
- Modify: `packages/server/src/task-routes.ts`
- Modify: `packages/server/test/fakes.ts` (`fakeTaskRepo`)
- Modify: `packages/server/test/tasks.test.ts`

- [ ] **Step 1: Fix the fake + write the failing tests**

In `packages/server/test/fakes.ts`, add `notBefore: null,` to `fakeTaskRepo`'s `make` object literal
(after `maxChunkMs`/`categoryId`) — the Prisma `Task` now requires it.

Append to `packages/server/test/tasks.test.ts` (reuse its `buildTestApp`, `tokenFor`, and valid
task-payload shape):

```ts
it('persists notBefore on create and clears it on update', async () => {
  const { app } = buildTestApp();
  const token = await tokenFor(app);
  const auth = { authorization: `Bearer ${token}` };
  const payload = { title: 'T', priority: 1, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000, notBefore: '2026-01-06T13:00:00.000Z' };
  const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth, payload });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ notBefore: '2026-01-06T13:00:00.000Z' });
  const id = (res.json() as { id: string }).id;
  const patch = await app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: auth, payload: { notBefore: null } });
  expect(patch.statusCode).toBe(200);
  expect(patch.json()).toMatchObject({ notBefore: null });
});

it('rejects a non-datetime notBefore with 400', async () => {
  const { app } = buildTestApp();
  const token = await tokenFor(app);
  const res = await app.inject({
    method: 'POST', url: '/tasks',
    headers: { authorization: `Bearer ${token}` },
    payload: { title: 'T', priority: 1, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000, notBefore: 'not-a-date' },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @notreclaim/server -- tasks`
Expected: FAIL — `notBefore` not persisted/echoed (schema strips it; handler ignores it).

- [ ] **Step 3: Add the schema field**

In `packages/server/src/schemas.ts`, add to `createTaskSchema` (after `categoryId`):

```ts
  notBefore: z.string().datetime().nullable().optional(),
```

(`updateTaskSchema = createTaskSchema.partial().extend({...})` inherits it.)

- [ ] **Step 4: Convert in the route handlers**

In `packages/server/src/task-routes.ts`:

POST handler — change the create call to convert `notBefore`:

```ts
    const body = createTaskSchema.parse(request.body);
    const task = await deps.repos.tasks.create(request.userId, {
      ...body,
      dueBy: new Date(body.dueBy),
      notBefore: body.notBefore ? new Date(body.notBefore) : null,
    });
```

PATCH handler — pull `notBefore` out and convert only when present (so an absent key leaves it
unchanged, while explicit `null` clears it):

```ts
    const { dueBy: dueByStr, notBefore: nbStr, ...rest } = updateTaskSchema.parse(request.body);
    const data = {
      ...rest,
      ...(dueByStr ? { dueBy: new Date(dueByStr) } : {}),
      ...(nbStr !== undefined ? { notBefore: nbStr === null ? null : new Date(nbStr) } : {}),
    };
    const task = await deps.repos.tasks.update(request.userId, id, data);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w @notreclaim/server`
Expected: PASS (all server tests, including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): accept + convert task notBefore on create/update"
```

---

## Task 4: Web — New Task modal "Schedule after" field

**Files:**
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/app/shell/newTaskForm.ts`
- Modify: `packages/web/src/app/shell/NewTaskModal.tsx:132-137`
- Modify: `packages/web/src/app/shell/newTaskForm.test.ts`
- Modify: `packages/web/src/app/shell/NewTaskModal.test.tsx`

- [ ] **Step 1: Add the DTO fields**

In `packages/web/src/api/types.ts`:
- add `notBefore?: string | null;` to `interface Task` (after `dueBy`). **Optional** — a read-only
  nullable field, so existing `Task` test fixtures need no change.
- add `notBefore?: string | null;` to `interface CreateTaskInput` (after `dueBy`).

- [ ] **Step 2: Failing form test**

Append to `packages/web/src/app/shell/newTaskForm.test.ts` (reuse its `defaultNewTaskForm` /
`toCreateTaskInput` imports):

```ts
it('round-trips notBeforeLocal to notBefore (set and empty→null)', () => {
  const base = defaultNewTaskForm(Date.parse('2026-01-05T00:00:00.000Z'));
  expect(toCreateTaskInput({ ...base, title: 'X' }).notBefore).toBeNull();
  const out = toCreateTaskInput({ ...base, title: 'X', notBeforeLocal: '2026-01-06T13:00' });
  expect(out.notBefore).toBe(new Date('2026-01-06T13:00').toISOString());
});
```

- [ ] **Step 3: Update `newTaskForm.ts`**

In `packages/web/src/app/shell/newTaskForm.ts`:
- add `notBeforeLocal: string;` to `interface NewTaskFormState` (after `dueByLocal`).
- add `notBeforeLocal: '',` to the object returned by `defaultNewTaskForm`.
- in `toCreateTaskInput`, add to the returned object:

```ts
    notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null,
```

(`localInputToIso` is already imported.)

- [ ] **Step 4: Run the form test**

Run: `npm test -w @notreclaim/web -- shell/newTaskForm`
Expected: PASS.

- [ ] **Step 5: Failing modal test**

Append to `packages/web/src/app/shell/NewTaskModal.test.tsx` (reuse its `renderWithProviders` /
`fakeApiClient` / `vi` / `fireEvent` / `screen` / `waitFor` imports; mirror the existing create test's
`getSettings` + `listCategories` stubs so the modal can submit):

```tsx
it('submits notBefore from the Schedule-after field', async () => {
  const createTask = vi.fn().mockResolvedValue({ id: 't1' });
  const api = fakeApiClient({
    getSettings: vi.fn().mockResolvedValue({ id: 's', userId: 'u', timezone: 'UTC', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 7200000, createdAt: '', updatedAt: '' }),
    listCategories: vi.fn().mockResolvedValue([{ id: 'cat-def', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]),
    createTask,
  } as never);
  renderWithProviders(<NewTaskModal onClose={() => {}} now={() => Date.parse('2026-01-05T00:00:00.000Z')} />, { api });

  fireEvent.change(await screen.findByPlaceholderText(/task name/i), { target: { value: 'Write' } });
  fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: '2026-01-06T13:00' } });
  await waitFor(() => expect(screen.getByTestId('category-select')).toHaveValue('cat-def'));
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ notBefore: new Date('2026-01-06T13:00').toISOString() })));
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm test -w @notreclaim/web -- NewTaskModal`
Expected: FAIL — `schedule-after` testid not found (still the static "Now" span).

- [ ] **Step 7: Wire the modal field**

In `packages/web/src/app/shell/NewTaskModal.tsx`, replace the dead "Schedule after" field (currently
`<Field label="Schedule after"><span className="text-[18px] font-bold text-[#aeb2c0]">Now</span></Field>`)
with a real input mirroring the Due-date field:

```tsx
          <Field label="Schedule after">
            <input type="datetime-local" data-testid="schedule-after" value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} className="text-[16px] font-bold text-ink outline-none" />
          </Field>
```

- [ ] **Step 8: Run the web suite + build**

Run: `npm test -w @notreclaim/web` (ALL pass) then `npm run build -w @notreclaim/web` (clean).
Expected: green (the optional `Task.notBefore` DTO field doesn't break existing fixtures).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/app/shell
git commit -m "feat(web): functional Schedule-after field in the New Task modal"
```

---

## Task 5: Web — edit drawer "Schedule after" + verification

**Files:**
- Modify: `packages/web/src/app/tasks/taskForm.ts`
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Modify: `packages/web/src/app/tasks/taskForm.test.ts`
- Modify: `packages/web/src/app/tasks/TaskDrawer.test.tsx`

- [ ] **Step 1: Failing form test**

Append to `packages/web/src/app/tasks/taskForm.test.ts` (reuse the file's task factory / `toFormState`
/ `toUpdateInput`):

```ts
it('round-trips notBefore through the edit form', () => {
  const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: null, notBefore: '2026-01-06T13:00:00.000Z', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
  const state = toFormState(task as never);
  expect(state.notBeforeLocal).not.toBe('');
  expect(toUpdateInput(state).notBefore).toBe(new Date(state.notBeforeLocal).toISOString());
  expect(toUpdateInput({ ...state, notBeforeLocal: '' }).notBefore).toBeNull();
});
```

- [ ] **Step 2: Update `taskForm.ts`**

In `packages/web/src/app/tasks/taskForm.ts`:
- add `notBeforeLocal: string;` to `interface TaskFormState` (after `dueByLocal`).
- in `toFormState`, add: `notBeforeLocal: t.notBefore ? isoToLocalInput(t.notBefore) : '',`
- in `toUpdateInput`, add: `notBefore: s.notBeforeLocal ? localInputToIso(s.notBeforeLocal) : null,`
- in `defaultQuickAddInput`, add `notBefore: null,` to the returned object (quick-add has no constraint).

(`isoToLocalInput`/`localInputToIso` are already imported.)

- [ ] **Step 3: Run the form test**

Run: `npm test -w @notreclaim/web -- tasks/taskForm`
Expected: PASS.

- [ ] **Step 4: Failing drawer test**

Append to `packages/web/src/app/tasks/TaskDrawer.test.tsx` (reuse the file's `task()` factory,
`renderWithProviders`, `fakeApiClient` with a `listCategories` stub, `vi`/`fireEvent`/`screen`/`waitFor`):

```tsx
it('renders Schedule-after and saves notBefore', async () => {
  const onSave = vi.fn();
  const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
  renderWithProviders(<TaskDrawer task={task({ notBefore: null }) as never} onSave={onSave} onCancel={() => {}} />, { api });
  fireEvent.change(await screen.findByTestId('schedule-after'), { target: { value: '2026-01-06T13:00' } });
  fireEvent.click(screen.getByTestId('save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notBefore: new Date('2026-01-06T13:00').toISOString() })));
});
```

(If the file's `task()` factory doesn't accept `notBefore`, pass a plain literal with `notBefore: null`
matching the existing dropdown test's task shape.)

- [ ] **Step 5: Run to verify failure**

Run: `npm test -w @notreclaim/web -- TaskDrawer`
Expected: FAIL — `schedule-after` testid not present in the drawer.

- [ ] **Step 6: Add the drawer field**

In `packages/web/src/app/tasks/TaskDrawer.tsx`, add a "Schedule after" field next to the "Due by"
field (reuse the existing `labelCls`/`ctlCls`):

```tsx
      <div className="mb-2">
        <label className={labelCls}>Schedule after</label>
        <input type="datetime-local" data-testid="schedule-after" className={ctlCls} value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} />
      </div>
```

- [ ] **Step 7: Run tasks tests, then full web suite + build**

Run: `npm test -w @notreclaim/web -- tasks` (PASS), then `npm test -w @notreclaim/web` (ALL pass), then
`npm run build -w @notreclaim/web` (clean).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/tasks
git commit -m "feat(web): Schedule-after field in the task edit drawer"
```

- [ ] **Step 9: Full-monorepo verification**

Confirm Postgres up (`pg_isready -h /tmp -p 5432`), then:

```bash
for p in scheduler core db google server web; do echo "== $p =="; npm test -w @notreclaim/$p 2>&1 | grep -E "Test Files|Tests "; done
```

Expected: every package green (scheduler unchanged; core/db/server gained tests; google unchanged; web
gained tests). Then dispatch a final whole-branch review over `git diff main...feat/schedule-after`
(data flow: modal/drawer `datetime-local` → `notBefore` → server `Date` → assemble window clip → engine
confinement; conventions; no engine change; backward-compat) and proceed to
`superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

- **Spec goals → tasks:** nullable `Task.notBefore` (T1) ✓; engine never places before it via assemble
  window clip (T2) ✓; modal field empty=null (T4) ✓; drawer field (T5) ✓; hard constraint / At-risk =
  emergent from the clip (T2 beyond-horizon test) ✓; backward-compatible null (T2 no-op test) ✓.
- **No scheduler-engine change:** confirmed — only `assemble` + DTO/UI/server plumbing. `@notreclaim/scheduler` is untouched.
- **Type consistency:** `notBefore` is `Date | null` in the db repo inputs; `string` (ISO) `.nullable().optional()`
  in the server zod schema; `string | null | undefined` (optional) in the web DTOs; `notBeforeLocal: string`
  (`'' ⇄ null`) in both form states; converted via `localInputToIso`/`isoToLocalInput`.
- **Deliberate choices:** web `Task.notBefore` is **optional** (read-only nullable DTO field) to avoid a
  fixture sweep — backend (Prisma + zod) stays authoritative. The core/server fakes that build a Prisma
  `Task` add `notBefore: null` (T2/T3). `notBefore` is NOT validated against `dueBy` (an impossible
  combination surfaces in the At-risk panel), per the spec.
