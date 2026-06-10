# Review 2 M-D: Click-to-Create on the Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an empty planner slot opens a Reclaim-style popover to create either a **Task pinned at that slot** or a real **calendar Event** (stored locally, written back to the user's primary Google Calendar when connected).

**Architecture:** DB: `CalendarEvent.googleCalendarId/googleEventId` become nullable (local events) + repo `create`/`setGoogleIds`. Server: `POST /calendar/events` (local create → best-effort Google `insertEvent` into `'primary'` → reflow) and `POST /schedule` (pinned `ScheduledBlock` for an owned task → reflow; engine already honors pinned coverage, `engineKey` stays null). Web: two new mutations + a `CreatePopover` (Task|Event toggle, title, ±15-min duration stepper) opened by clicking a `WeekGrid` day column; the Task path chains `createTask` (min=max=duration, dueBy = clicked-day 23:59, priority 4) → `POST /schedule`. Engine/core untouched.

**Tech Stack:** Prisma 5/Postgres, Fastify + zod, FakeGoogleClient-style fakes (server tests), React + TanStack Query + Tailwind, vitest.

**Branch:** `feat/review2-md-click-create` off `main`. Spec: `docs/superpowers/specs/2026-06-09-notreclaim-review-2-design.md` (§M-D).

**Established facts (verified):** `GoogleClient.insertEvent(accessToken, calendarId, {summary,startDateTime,endDateTime}) → {googleEventId}`; `TokenService.getAccessToken(userId, now)` throws for non-connected users (→ best-effort try/catch needs no separate isConnected); inbound sync uses calendarId literal `'primary'` and upserts by `(userId, googleCalendarId, googleEventId)` so written-back events dedupe; `ScheduledBlockRepository.create(userId, data)` exists; `AppDeps.repos.scheduledBlocks` is `Pick<…,'listByUserInRange'|'update'>` (must widen with `'create'`); `AppDeps.google` Picks are `getConsentUrl`/`connectFromCode` (must widen with `insertEvent`/`getAccessToken`); zod errors → 400 via `mapDomainError`; db repo tests run against real Postgres (`test/repositories/*.test.ts`, per-test truncation via `setup-each.ts`).

---

### Task 1: Branch + DB — nullable google ids, `create`, `setGoogleIds` (TDD, real Postgres)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (CalendarEvent google fields → `String?`)
- Create: `packages/db/prisma/migrations/20260610000000_local_calendar_events/migration.sql`
- Modify: `packages/db/src/repositories/calendar-event-repository.ts`
- Test: `packages/db/test/repositories/calendar-event-repository.test.ts`

- [ ] **Step 1: Branch**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git checkout -b feat/review2-md-click-create main
```

- [ ] **Step 2: Failing repo tests** — append to the existing `describe('CalendarEventRepository', …)` in `calendar-event-repository.test.ts` (file already has `users`, `repo`, `event()` helpers):

```ts
  it('creates a local event with null google ids', async () => {
    const user = await users.create({ email: 'c5@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    expect(created.googleCalendarId).toBeNull();
    expect(created.googleEventId).toBeNull();
    const listed = await repo.listByUserInRange(user.id, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-04T00:00:00.000Z'));
    expect(listed.map((e) => e.id)).toContain(created.id);
  });

  it('setGoogleIds attaches write-back ids scoped to the user', async () => {
    const user = await users.create({ email: 'c6@example.com' });
    const other = await users.create({ email: 'c7@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    await expect(repo.setGoogleIds(other.id, created.id, 'primary', 'g-x')).rejects.toThrow();
    const updated = await repo.setGoogleIds(user.id, created.id, 'primary', 'g-x');
    expect(updated.googleCalendarId).toBe('primary');
    expect(updated.googleEventId).toBe('g-x');
  });
```

- [ ] **Step 3: Run to verify failure** — `cd packages/db && npm test` (Postgres must be running; `.env.test` points at `notreclaim_test`). Expected: the two new tests fail (`repo.create is not a function`).

- [ ] **Step 4: Implement**

`schema.prisma` — in `model CalendarEvent`: `googleCalendarId String?` and `googleEventId String?` (keep the `@@unique`). Migration SQL (`prisma/migrations/20260610000000_local_calendar_events/migration.sql`):

```sql
ALTER TABLE "CalendarEvent" ALTER COLUMN "googleCalendarId" DROP NOT NULL;
ALTER TABLE "CalendarEvent" ALTER COLUMN "googleEventId" DROP NOT NULL;
```

Apply + regenerate: `cd packages/db && npx prisma migrate deploy && npx prisma generate` (migrate deploy runs against `.env` dev DB; the test DB is migrated by the test global-setup — check `test/global-setup.ts` and follow its mechanism if it deploys migrations itself).

Repo additions in `calendar-event-repository.ts`:

```ts
export interface CreateCalendarEventInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
}
```

and inside the returned object:

```ts
    /** A locally created event (no Google ids until written back). */
    create(userId: string, data: CreateCalendarEventInput): Promise<CalendarEvent> {
      return prisma.calendarEvent.create({ data: { userId, ...data } });
    },

    /** Attach Google ids after a successful write-back. Throws NotFound for other users' events. */
    async setGoogleIds(userId: string, id: string, googleCalendarId: string, googleEventId: string): Promise<CalendarEvent> {
      try {
        return await prisma.calendarEvent.update({ where: { id, userId }, data: { googleCalendarId, googleEventId } });
      } catch (e) {
        throwIfNotFound(e, `CalendarEvent ${id}`);
        throw e;
      }
    },
```

Use the same not-found mapping idiom the OTHER repos in this directory use (read `scheduled-block-repository.ts` `update()` and copy its catch pattern exactly — if it uses a helper, reuse it; if inline, inline the same).

- [ ] **Step 5: Run to verify pass** — `cd packages/db && npm test` (all green, 45 + 2 = 47).

- [ ] **Step 6: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260610000000_local_calendar_events packages/db/src/repositories/calendar-event-repository.ts packages/db/test/repositories/calendar-event-repository.test.ts
git commit -m "feat(db): local calendar events — nullable google ids + create/setGoogleIds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server — `POST /calendar/events` with best-effort Google write-back (TDD)

**Files:**
- Modify: `packages/server/src/schemas.ts`, `packages/server/src/app.ts` (AppDeps Picks), `packages/server/src/calendar-routes.ts`
- Modify: `packages/server/test/fakes.ts` (fakeCalendarEventRepo create/setGoogleIds; buildTestApp google deps + option)
- Test: `packages/server/test/calendar.test.ts`

Build the server workspace dep first so the widened db types are visible: `cd packages/db && npm run build`.

- [ ] **Step 1: Failing tests** — append to `packages/server/test/calendar.test.ts`:

```ts
describe('POST /calendar/events', () => {
  const body = { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' };

  it('creates a local event (null google ids), reflows, returns 201', async () => {
    const { app, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Standup');
    expect(res.json().googleEventId).toBeNull();
    expect(reconcileCalls.length).toBeGreaterThan(0); // afterMutation reflow fired
  });

  it('writes back to the primary Google calendar when connected', async () => {
    const inserted: Array<{ calendarId: string; summary: string }> = [];
    const { app } = buildTestApp({
      accessToken: 'at-1',
      insertEvent: async (_t, calendarId, ev) => { inserted.push({ calendarId, summary: ev.summary }); return { googleEventId: 'g-new' }; },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(inserted).toEqual([{ calendarId: 'primary', summary: 'Standup' }]);
    expect(res.json().googleEventId).toBe('g-new');
    expect(res.json().googleCalendarId).toBe('primary');
  });

  it('stays local when the write-back fails', async () => {
    const { app } = buildTestApp({
      accessToken: 'at-1',
      insertEvent: async () => { throw new Error('google down'); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().googleEventId).toBeNull();
  });

  it('rejects an inverted range with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: { ...body, endsAt: '2026-01-06T08:00:00.000Z' } });
    expect(res.statusCode).toBe(400);
  });
});
```

(`tokenFor`/`buildTestApp` already exported by fakes. The new `accessToken`/`insertEvent` TestAppOptions are added in Step 3. Check whether `buildTestApp` currently returns `reconcileCalls`; if not, expose it — it already tracks them internally.)

- [ ] **Step 2: Run to verify failure** — `cd packages/server && npx vitest run test/calendar.test.ts` → new tests fail (404 route, TS errors for the new options).

- [ ] **Step 3: Implement**

`schemas.ts`:

```ts
export const createCalendarEventSchema = z
  .object({ title: z.string().min(1), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((b) => Date.parse(b.startsAt) < Date.parse(b.endsAt), { message: 'startsAt must be before endsAt' });
```

`app.ts` AppDeps widening (types only):

```ts
    calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange' | 'create' | 'setGoogleIds'>;
  …
  google: {
    client: Pick<GoogleClient, 'getConsentUrl' | 'insertEvent'>;
    tokens: Pick<TokenService, 'connectFromCode' | 'getAccessToken'>;
  };
```

and pass `afterMutation` to `registerCalendarRoutes(app, deps, afterMutation)`.

`calendar-routes.ts` — add (PRIMARY constant `'primary'`; signature gains `afterMutation: AfterMutation`):

```ts
  app.post('/calendar/events', guard, async (request, reply) => {
    const body = createCalendarEventSchema.parse(request.body);
    let event = await deps.repos.calendarEvents.create(request.userId, {
      title: body.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt),
    });
    // Best-effort Google write-back: connected users get the event mirrored to their
    // primary calendar; failures (or no Google account) leave the local row authoritative.
    try {
      const accessToken = await deps.google.tokens.getAccessToken(request.userId, deps.now());
      const { googleEventId } = await deps.google.client.insertEvent(accessToken, PRIMARY, {
        summary: body.title, startDateTime: body.startsAt, endDateTime: body.endsAt,
      });
      event = await deps.repos.calendarEvents.setGoogleIds(request.userId, event.id, PRIMARY, googleEventId);
    } catch { /* not connected or Google failure — local row stands */ }
    afterMutation(request.userId);
    reply.code(201);
    return event;
  });
```

`test/fakes.ts`:
- `fakeCalendarEventRepo(seed)` gains `create` (push a row with `id: 'cal-N'`, null google ids, `createdAt/updatedAt: new Date(0)`) and `setGoogleIds` (find by id+userId, NotFoundError if missing, assign, return) — make `seed` a mutable `let rows = [...seed]` like the other fakes.
- `TestAppOptions` gains `accessToken?: string` and `insertEvent?: GoogleClient['insertEvent']`.
- `buildTestApp` google deps become:

```ts
    google: {
      client: {
        getConsentUrl: () => 'https://consent.example/auth',
        insertEvent: opts.insertEvent ?? (async () => { throw new Error('not connected'); }),
      },
      tokens: {
        connectFromCode: async () => …(unchanged)…,
        getAccessToken: async () => {
          if (!opts.accessToken) throw new Error('not connected');
          return opts.accessToken;
        },
      },
    },
```

- Ensure `buildTestApp` returns `reconcileCalls` (it tracks them already; export if missing).

- [ ] **Step 4: Run to verify pass** — `cd packages/server && npm test` (all server tests; the existing suite must stay green — the widened Picks are satisfied by the real repos in `server.ts`, verify `npm run build` compiles too: `cd packages/server && npm run build`).

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/server/src/schemas.ts packages/server/src/app.ts packages/server/src/calendar-routes.ts packages/server/test/fakes.ts packages/server/test/calendar.test.ts
git commit -m "feat(server): POST /calendar/events — local event + best-effort Google write-back

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Server — `POST /schedule` pinned block (TDD)

**Files:**
- Modify: `packages/server/src/schemas.ts`, `packages/server/src/app.ts` (one Pick), `packages/server/src/schedule-routes.ts`
- Modify: `packages/server/test/fakes.ts` (fakeScheduledBlockRepo `create`)
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Failing tests** — append to `packages/server/test/schedule.test.ts` (it already imports `buildTestApp`/`tokenFor`; reuse its existing task-seeding idiom — read the file first):

```ts
describe('POST /schedule', () => {
  const seedTask = { id: 'task-1', userId: 'u1', title: 'Deep work', priority: 2, durationMs: 3_600_000,
    dueBy: new Date('2026-01-09T17:00:00.000Z'), minChunkMs: 3_600_000, maxChunkMs: 3_600_000, categoryId: null,
    notBefore: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0), subtasks: [] };
  const body = { taskId: 'task-1', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z' };

  it('creates a pinned block for an owned task, reflows, 201', async () => {
    const { app, reconcileCalls } = buildTestApp({ tasks: [seedTask as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ taskId: 'task-1', title: 'Deep work', pinned: true, engineKey: null });
    expect(reconcileCalls.length).toBeGreaterThan(0);
  });

  it('404s for a task that is not yours', async () => {
    const { app } = buildTestApp({ tasks: [{ ...seedTask, userId: 'someone-else' } as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it('400s an inverted range', async () => {
    const { app } = buildTestApp({ tasks: [seedTask as never] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule', headers: { authorization: `Bearer ${token}` }, payload: { ...body, endsAt: '2026-01-06T08:00:00.000Z' } });
    expect(res.statusCode).toBe(400);
  });
});
```

(Adjust `tokenFor` usage / seeded userId to match how the existing tests in this file authenticate — the fake JWT sub is `u1`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/schedule.test.ts` → 404-route/TS failures.

- [ ] **Step 3: Implement**

`schemas.ts`:

```ts
export const createScheduledBlockSchema = z
  .object({ taskId: z.string().min(1), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((b) => Date.parse(b.startsAt) < Date.parse(b.endsAt), { message: 'startsAt must be before endsAt' });
```

`app.ts`: `scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'create'>;`

`schedule-routes.ts` — add:

```ts
  app.post('/schedule', guard, async (request, reply) => {
    const body = createScheduledBlockSchema.parse(request.body);
    const task = await deps.repos.tasks.findById(request.userId, body.taskId);
    if (!task) {
      reply.code(404).send({ code: 'not_found', message: `Task ${body.taskId} not found` });
      return;
    }
    const block = await deps.repos.scheduledBlocks.create(request.userId, {
      taskId: task.id, title: task.title, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), pinned: true,
    });
    afterMutation(request.userId);
    reply.code(201);
    return block;
  });
```

(Check `CreateScheduledBlockInput` in the db repo for exact field names; `engineKey` omitted → null. The pinned block is honored by `assemble` as fixed coverage and skipped by `applyDesiredSchedule`'s keyed diff — no engine change.)

`test/fakes.ts` `fakeScheduledBlockRepo` gains:

```ts
    async create(userId: string, data: Record<string, unknown>): Promise<ScheduledBlock> {
      const row = {
        id: `block-${rows.length + 1}`, userId, taskId: null, habitId: null, title: '',
        pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null,
        createdAt: new Date(0), updatedAt: new Date(0), ...data,
      } as ScheduledBlock;
      rows.push(row); return row;
    },
```

- [ ] **Step 4: Run to verify pass** — `cd packages/server && npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/server/src/schemas.ts packages/server/src/app.ts packages/server/src/schedule-routes.ts packages/server/test/fakes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): POST /schedule — pin a task block at a chosen slot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Web API layer — DTOs, client methods, mutation hooks (TDD)

**Files:**
- Modify: `packages/web/src/api/types.ts`, `packages/web/src/api/client.ts`, `packages/web/src/api/queries.ts`, `packages/web/src/test/fakes.tsx` (fakeApiClient gains the two methods)
- Test: `packages/web/src/api/queries.test.tsx`

- [ ] **Step 1: Failing tests** — append to `queries.test.tsx`:

```tsx
describe('useCreateCalendarEventMutation', () => {
  it('posts the event and invalidates calendar events + schedule', async () => {
    const createCalendarEvent = vi.fn(async () => ({ id: 'e1' }));
    const api = fakeApiClient({ createCalendarEvent } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ title: 'Standup', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createCalendarEvent).toHaveBeenCalledWith({ title: 'Standup', startsAt: 'S', endsAt: 'E' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.calendarEventsRoot });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
  });
});

describe('useCreateScheduledBlockMutation', () => {
  it('posts the pinned block and invalidates the schedule', async () => {
    const createScheduledBlock = vi.fn(async () => ({ id: 'b9' }));
    const api = fakeApiClient({ createScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createScheduledBlock).toHaveBeenCalledWith({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.scheduleRoot });
  });
});
```

(Extend the import list from './queries' with the two new hooks.)

- [ ] **Step 2: Verify failure** — `TZ=UTC npx vitest run src/api/queries.test.tsx` → compile errors (hooks/methods missing).

- [ ] **Step 3: Implement**

`types.ts` — add:

```ts
export interface CreateCalendarEventInput { title: string; startsAt: string; endsAt: string; }
export interface CreateScheduledBlockInput { taskId: string; startsAt: string; endsAt: string; }
```

`client.ts` — add to the ApiClient interface and implementation (mirror neighbors):

```ts
    createCalendarEvent: (body) => request('POST', '/calendar/events', body),
    createScheduledBlock: (body) => request('POST', '/schedule', body),
```

with interface entries `createCalendarEvent(body: CreateCalendarEventInput): Promise<CalendarEvent>;` and `createScheduledBlock(body: CreateScheduledBlockInput): Promise<ScheduledBlock>;`.

`queries.ts` — add:

```ts
export function useCreateCalendarEventMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCalendarEventInput) => api.createCalendarEvent(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.calendarEventsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useCreateScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScheduledBlockInput) => api.createScheduledBlock(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}
```

`test/fakes.tsx` — add `createCalendarEvent: notImplemented('createCalendarEvent'),` and `createScheduledBlock: notImplemented('createScheduledBlock'),` to the base fake.

- [ ] **Step 4: Verify pass** — `TZ=UTC npx vitest run src/api/ && npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/api/types.ts packages/web/src/api/client.ts packages/web/src/api/queries.ts packages/web/src/test/fakes.tsx packages/web/src/api/queries.test.tsx
git commit -m "feat(web): createCalendarEvent + createScheduledBlock API mutations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Web — CreatePopover + WeekGrid click wiring (TDD)

**Files:**
- Create: `packages/web/src/app/planner/CreatePopover.tsx`
- Create: `packages/web/src/app/planner/CreatePopover.test.tsx`
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` + `WeekGrid.test.tsx`
- Modify: `packages/web/src/app/planner/weekModel.ts` + test (one helper)

Behavior: clicking empty space in a day column opens the popover at the clicked slot (start snapped to 15 min, clamped to 06:00–21:45); Task|Event segmented toggle; autofocus title; DurationStepper (default 30 min); live `HH:MM – HH:MM` slot label; Create disabled on empty title/pending; Esc or outside click closes. Event → `useCreateCalendarEventMutation`. Task → `useCreateTaskMutation` (durationMs=minChunkMs=maxChunkMs=duration, priority 4, dueBy clicked-day 23:59 local, no categoryId) then `useCreateScheduledBlockMutation({taskId, startsAt, endsAt})`; close on final success; surface ApiError text. Clicks on existing blocks must NOT open it (guard: target inside `[data-testid="event-block"]`).

- [ ] **Step 1: weekModel helper (TDD micro-cycle)** — test then implement:

```ts
describe('snapClickToSlot', () => {
  it('maps a clicked offset fraction to a snapped, clamped start minute', () => {
    expect(snapClickToSlot(0)).toBe(WINDOW_START_MIN);              // top of the window
    expect(snapClickToSlot(0.5)).toBe(840);                          // 14:00 (06:00 + 480min)
    expect(snapClickToSlot(0.99)).toBe(WINDOW_END_MIN - 15);        // clamped so a 15-min slot fits
    expect(snapClickToSlot(-0.2)).toBe(WINDOW_START_MIN);
  });
});
```

```ts
/** Map a click's fractional position within a day column (0..1) to a snapped start minute with room for a 15-min slot. */
export function snapClickToSlot(fraction: number): number {
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  const min = snapMinutes(WINDOW_START_MIN + fraction * span);
  return Math.min(WINDOW_END_MIN - 15, Math.max(WINDOW_START_MIN, min));
}
```

- [ ] **Step 2: CreatePopover (TDD)** — `CreatePopover.test.tsx` (renderWithProviders + fakeApiClient):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { CreatePopover } from './CreatePopover';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight, TZ=UTC
const baseProps = { dayStartMs: DAY, startMin: 540, topPct: 18.75, onClose: vi.fn() }; // 09:00

describe('CreatePopover', () => {
  it('shows the snapped slot label and defaults to a 30-min event', () => {
    renderWithProviders(<CreatePopover {...baseProps} />, { api: fakeApiClient() });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    expect(screen.getByTestId('slot-label').textContent).toMatch(/09:00.*09:30/);
  });

  it('creates an event and closes', async () => {
    const onClose = vi.fn();
    const createCalendarEvent = vi.fn(async () => ({ id: 'e1' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ createCalendarEvent } as never) });
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Standup' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledWith({
      title: 'Standup', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates a task pinned at the slot (min=max=duration, dueBy end of day, priority 4)', async () => {
    const onClose = vi.fn();
    const createTask = vi.fn(async () => ({ id: 't-9' }));
    const createScheduledBlock = vi.fn(async () => ({ id: 'b-9' }));
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient({ createTask, createScheduledBlock } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Deep work' } });
    fireEvent.click(screen.getByRole('button', { name: 'increase slot' })); // 30 → 45 min
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deep work', durationMs: 2_700_000, minChunkMs: 2_700_000, maxChunkMs: 2_700_000, priority: 4,
      dueBy: new Date(DAY + (23 * 60 + 59) * 60_000).toISOString(),
    })));
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't-9', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:45:00.000Z',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('disables Create on an empty title and closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient() });
    expect(screen.getByTestId('create-submit')).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

`CreatePopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useCreateCalendarEventMutation, useCreateScheduledBlockMutation } from '../../api/queries';
import { DurationStepper } from '../components/DurationStepper';

const iso = (ms: number): string => new Date(ms).toISOString();
const fmt = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface CreatePopoverProps {
  dayStartMs: number;
  startMin: number;   // snapped minute-of-day for the slot start
  topPct: number;     // vertical anchor within the column (%)
  onClose: () => void;
}

type Mode = 'event' | 'task';

export function CreatePopover({ dayStartMs, startMin, topPct, onClose }: CreatePopoverProps) {
  const [mode, setMode] = useState<Mode>('event');
  const [title, setTitle] = useState('');
  const [durationMs, setDurationMs] = useState(30 * 60_000);
  const ref = useRef<HTMLDivElement>(null);
  const createTaskM = useCreateTaskMutation();
  const createEventM = useCreateCalendarEventMutation();
  const createBlockM = useCreateScheduledBlockMutation();

  const startMs = dayStartMs + startMin * 60_000;
  const endMs = startMs + durationMs;
  const pending = createTaskM.isPending || createEventM.isPending || createBlockM.isPending;
  const apiError = [createTaskM.error, createEventM.error, createBlockM.error].find((e) => e instanceof ApiError) as ApiError | undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const submit = () => {
    if (!title.trim() || pending) return;
    if (mode === 'event') {
      createEventM.mutate({ title: title.trim(), startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose });
    } else {
      const dueBy = iso(dayStartMs + (23 * 60 + 59) * 60_000);
      createTaskM.mutate(
        { title: title.trim(), durationMs, minChunkMs: durationMs, maxChunkMs: durationMs, priority: 4, dueBy },
        { onSuccess: (task) => createBlockM.mutate({ taskId: task.id, startsAt: iso(startMs), endsAt: iso(endMs) }, { onSuccess: onClose }) },
      );
    }
  };

  const tabCls = (active: boolean) =>
    `flex-1 rounded-[8px] px-2 py-1 text-[13px] font-bold ${active ? 'bg-indigo text-white' : 'text-inkSoft hover:bg-bg'}`;

  return (
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-1 right-1 z-40 animate-pop rounded-[14px] border border-line bg-card p-3 shadow-pop"
      style={{ top: `${Math.min(topPct, 78)}%` }}
    >
      <div className="mb-2 flex gap-1 rounded-[10px] bg-bg p-1">
        <button type="button" data-testid="mode-event" onClick={() => setMode('event')} className={tabCls(mode === 'event')}>Event</button>
        <button type="button" data-testid="mode-task" onClick={() => setMode('task')} className={tabCls(mode === 'task')}>Task</button>
      </div>
      <input
        autoFocus
        data-testid="create-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={mode === 'event' ? 'Event name…' : 'Task name…'}
        className="mb-2 w-full rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5 text-[14px] font-semibold outline-none focus:border-indigo"
      />
      <div className="mb-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5">
        <DurationStepper label="slot" size={20} valueMs={durationMs} onChange={setDurationMs} />
      </div>
      <p data-testid="slot-label" className="mb-2 text-[12px] font-semibold text-inkSoft">{fmt(startMs)} – {fmt(endMs)}</p>
      {apiError && <p data-testid="create-error" className="mb-2 text-[11px] text-crit">{apiError.message}</p>}
      <button
        type="button"
        data-testid="create-submit"
        disabled={!title.trim() || pending}
        onClick={submit}
        className="w-full rounded-[20px] bg-indigo py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
      >
        Create {mode === 'event' ? 'event' : 'task'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: WeekGrid wiring (TDD)** — failing tests in `WeekGrid.test.tsx` first. The file's existing `renderGrid` helper renders WeekGrid BARE (no providers) — leave it and all existing tests untouched. Append a NEW describe that renders with providers (the popover mounts mutation hooks), reusing the module-level `days`/`block`/`event` fixtures:

```tsx
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

function renderGridWithProviders(props: Partial<WeekGridProps> = {}) {
  return renderWithProviders(
    <WeekGrid
      days={days} nowMs={WED_NOON} weekLabel="Jan 5 – 11"
      blocks={[block()]} events={[event()]} replanPending={false}
      onPrev={vi.fn()} onToday={vi.fn()} onNext={vi.fn()} onReplan={vi.fn()} onCommit={vi.fn()}
      {...props}
    />,
    { api: fakeApiClient() },
  );
}

describe('WeekGrid click-to-create', () => {
  it('clicking empty column space opens the popover at the snapped slot', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    // jsdom: rect height 0 → fraction 0 → slot starts at the 06:00 window top
    expect(screen.getByTestId('slot-label').textContent).toMatch(/06:00/);
  });

  it('clicking an existing block does not open the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getAllByTestId('event-block')[0]!);
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });

  it('Escape closes the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });
});
```

Implementation in `WeekGrid.tsx`:
1. `import { useState } from 'react';` + import `CreatePopover` and `snapClickToSlot`, `WINDOW_START_MIN, WINDOW_END_MIN` from weekModel.
2. State: `const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);`
3. On each day-column div add:

```tsx
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-testid="event-block"],[data-testid="create-popover"]')) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
                    setCreating({ dayIndex: i, startMin: snapClickToSlot(fraction) });
                  }}
```

4. Inside the column (after the now-line), render when `creating?.dayIndex === i`:

```tsx
                  {creating?.dayIndex === i && (
                    <CreatePopover
                      dayStartMs={d}
                      startMin={creating.startMin}
                      topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                      onClose={() => setCreating(null)}
                    />
                  )}
```

NOTE: WeekGrid's existing tests render it WITHOUT providers — they stay green because the popover (and its hooks) only mounts after a click. Put the new click tests in a separate `describe` using `renderWithProviders`.

- [ ] **Step 4: Run all planner + api tests, full web suite, typecheck**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/planner/ src/api/ && npm test && npx tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/CreatePopover.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): click-to-create popover on the planner (task pinned at slot / calendar event)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full suite + migration on dev DB + live verification + merge

- [ ] **Step 1:** `cd /home/nyx-ai/Projects/NotReclaim && npm test` — all workspaces green (455 baseline + ~13 new ≈ 468).
- [ ] **Step 2:** `npm run build` (all workspaces) and apply the migration to the dev DB: `cd packages/db && npx prisma migrate deploy`. Restart the running API server so it picks up the new dist (kill + relaunch with `.env.run` sourced).
- [ ] **Step 3:** Live verify via curl with the demo token THROUGH the vite proxy: `POST /calendar/events` (expect 201, null google ids), `POST /schedule` with a real taskId (expect 201 pinned), `GET /schedule` shows the pinned block. Then in the browser: click an empty planner slot → popover → create an Event and a Task; both render; schedule reflows around the event.
- [ ] **Step 4:** Merge `feat/review2-md-click-create` into main (suite green on main, delete branch).
- [ ] **Step 5 (Review-2 item 2):** Seed 3–4 demo tasks with FUTURE dueBy/notBefore via the API so scheduling is visible, and trigger a replan.
