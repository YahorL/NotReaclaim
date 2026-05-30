# Planner Week-View (Milestone 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the user's schedule as a 7-day week-view calendar grid in `packages/web` — Google meetings + auto-scheduled task/habit blocks (color-coded, pinned marked), an at-risk panel, a manual re-plan button, and live WebSocket refresh — backed by a small new read-only `GET /calendar/events` server endpoint.

**Architecture:** Add one guarded read route on the server (reuses the existing `CalendarEvent` repo). On the client: correct the preview DTO, add a `CalendarEvent` DTO + client method, centralize query keys (single source of truth shared with realtime invalidation), wire a global 401→sign-out interceptor, and build the Planner from a pure `weekModel` (all date math, DI'd) plus presentational components (`EventBlock`, `AtRiskPanel`, `WeekGrid`) and an integrating `Planner` page.

**Tech Stack:** TypeScript ESM strict; Fastify (server); React 18 + Vite + Tailwind + TanStack Query v5 + React Router v6 (web); Vitest + @testing-library/react + jsdom. Backend imports use explicit `.js`; web imports are extensionless. Determinism via injected `now` + `TZ=UTC` pinned in the web test script.

**Conventions reminder:** No `Date.now()`/`Math.random()` in pure code (`weekModel.ts` takes `now`/inputs as arguments). Tests use injected fakes — no real network or Google. The web `build` script (`tsc -p tsconfig.json && vite build`) typechecks test files, so keep test types clean.

---

## File Structure

**Server (`packages/server`):**
- Modify `src/app.ts` — add `calendarEvents` to `AppDeps.repos`; register calendar routes.
- Create `src/calendar-routes.ts` — `GET /calendar/events`.
- Modify `src/server.ts` — pass the existing `calendarEvents` repo into `repos`.
- Modify `test/fakes.ts` — `fakeCalendarEventRepo`, `TestAppOptions.calendarEvents`, wire it.
- Create `test/calendar.test.ts` — route tests.

**Web (`packages/web`):**
- Modify `src/api/types.ts` — fix `SchedulePreview`/`UnscheduledItem`, add `PreviewBlock` + `CalendarEvent`.
- Modify `src/api/client.ts` — add `getCalendarEvents`.
- Modify `src/test/fakes.tsx` — add `getCalendarEvents` to the fake base.
- Modify `src/api/client.test.ts` — test `getCalendarEvents`.
- Create `src/api/queries.ts` — `queryKeys` (source of truth) + thin hooks.
- Create `src/api/queries.test.tsx` — hook tests.
- Create `src/api/queryClient.ts` — `createQueryClient({ onUnauthorized })`.
- Create `src/api/queryClient.test.ts` — 401 interceptor tests.
- Modify `src/main.tsx` — use `createQueryClient` with the sign-out handler.
- Modify `src/realtime/events.ts` + `src/realtime/events.test.ts` — import `queryKeys`; `sync.completed` also invalidates calendar events.
- Create `src/app/planner/weekModel.ts` + `weekModel.test.ts` — pure date/layout math.
- Create `src/app/planner/EventBlock.tsx` + `EventBlock.test.tsx`.
- Create `src/app/planner/AtRiskPanel.tsx` + `AtRiskPanel.test.tsx`.
- Create `src/app/planner/WeekGrid.tsx` + `WeekGrid.test.tsx`.
- Modify `src/app/pages/Planner.tsx` — replace placeholder with the integrating page.
- Create `src/app/pages/Planner.test.tsx` — integration tests.
- Modify `src/app/App.tsx` — import `Planner` from its (unchanged) path (no change if already `./pages/Planner`).
- Modify `package.json` — `test` script gains `TZ=UTC`.
- Modify `vite.config.ts` — proxy `/calendar` to the API.

---

## Task 1: Server — `GET /calendar/events`

**Files:**
- Modify: `packages/server/test/fakes.ts`
- Create: `packages/server/test/calendar.test.ts`
- Create: `packages/server/src/calendar-routes.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Add a calendar-event fake + option to `test/fakes.ts`**

At the top, extend the db type import to include `CalendarEvent`:

```ts
import type { Settings, Task, Habit, ScheduledBlock, CalendarEvent, User } from '@notreclaim/db';
```

Add this factory after `fakeScheduledBlockRepo` (around line 96):

```ts
export function fakeCalendarEventRepo(seed: CalendarEvent[] = []) {
  return {
    async listByUserInRange(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
      return seed.filter(
        (e) => e.userId === userId && e.startsAt < end && e.endsAt > start,
      );
    },
  };
}
```

Add `calendarEvents?: CalendarEvent[];` to `TestAppOptions` (after `blocks?`):

```ts
  blocks?: ScheduledBlock[];
  calendarEvents?: CalendarEvent[];
```

In `buildTestApp`, construct the repo once and reuse it for both `repos` and `schedulingRepos`. Replace the `scheduledBlocks` construction + the `schedulingRepos` default + the `buildApp({ repos: ... })` line:

```ts
  const scheduledBlocks = fakeScheduledBlockRepo(opts.blocks ?? []);
  const calendarEvents = fakeCalendarEventRepo(opts.calendarEvents ?? []);
  const reconcileCalls: Array<{ userId: string; now: number }> = [];

  const events = createEventBus();
  const emitted: ServerEvent[] = [];
  events.subscribe((e) => emitted.push(e));

  const schedulingRepos: SchedulingRepositories = opts.schedulingReposOverride ?? {
    settings,
    calendarEvents,
    tasks,
    habits,
    scheduledBlocks,
  };

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks, calendarEvents },
```

(Leave the rest of `buildApp({...})` unchanged.)

- [ ] **Step 2: Write the failing route test `test/calendar.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Settings } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', userId: 'u1', googleCalendarId: 'primary', googleEventId: 'g1',
    title: 'Standup',
    startsAt: new Date('2026-01-05T10:00:00.000Z'),
    endsAt: new Date('2026-01-05T10:30:00.000Z'),
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}
function settings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1', userId: 'u1', timezone: 'utc', workingHours: [] as unknown as Settings['workingHours'],
    horizonDays: 14, defaultMinChunkMs: 0, defaultMaxChunkMs: 0,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}

describe('calendar routes', () => {
  it('requires authentication', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/calendar/events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns events in the default now->horizon range', async () => {
    // FIXED_NOW is 2026-01-05; in-range event vs one beyond the 14-day horizon.
    const { app } = buildTestApp({
      settings: settings(),
      calendarEvents: [
        event(),
        event({ id: 'e2', googleEventId: 'g2', title: 'Later',
          startsAt: new Date('2026-02-01T10:00:00.000Z'), endsAt: new Date('2026-02-01T11:00:00.000Z') }),
      ],
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/calendar/events', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CalendarEvent[];
    expect(body).toHaveLength(1);
    expect(body[0]!.title).toBe('Standup');
  });

  it('honors explicit from/to', async () => {
    const { app } = buildTestApp({
      settings: settings(),
      calendarEvents: [event({ startsAt: new Date('2026-01-09T10:00:00.000Z'), endsAt: new Date('2026-01-09T10:30:00.000Z') })],
    });
    const token = await tokenFor(app);
    const inRange = await app.inject({ method: 'GET',
      url: '/calendar/events?from=2026-01-08T00:00:00.000Z&to=2026-01-10T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` } });
    expect((inRange.json() as CalendarEvent[])).toHaveLength(1);

    const outOfRange = await app.inject({ method: 'GET',
      url: '/calendar/events?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` } });
    expect((outOfRange.json() as CalendarEvent[])).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @notreclaim/server -- test/calendar.test.ts`
Expected: FAIL — the `/calendar/events` route is not registered (404), and `repos.calendarEvents` is not yet on `AppDeps`.

- [ ] **Step 4: Add `calendarEvents` to `AppDeps.repos` in `src/app.ts`**

Add `CalendarEventRepository` to the db type import (it's already exported from `@notreclaim/db`):

```ts
// in the existing `import type { ... } from '@notreclaim/db';`
CalendarEventRepository,
```

Extend the `repos` block of `AppDeps` (after `scheduledBlocks`):

```ts
  repos: {
    settings: SettingsRepository;
    tasks: TaskRepository;
    habits: HabitRepository;
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
    calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>;
  };
```

- [ ] **Step 5: Create `src/calendar-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { rangeQuerySchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerCalendarRoutes(app: FastifyInstance, deps: AppDeps): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/calendar/events', guard, async (request) => {
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
    return deps.repos.calendarEvents.listByUserInRange(request.userId, start, end);
  });
}
```

- [ ] **Step 6: Register the route in `src/app.ts`**

Add the import next to the other route imports:

```ts
import { registerCalendarRoutes } from './calendar-routes.js';
```

Register it right after `registerScheduleRoutes(app, deps);`:

```ts
  registerScheduleRoutes(app, deps);
  registerCalendarRoutes(app, deps);
```

- [ ] **Step 7: Wire the repo in `src/server.ts`**

`calendarEvents` is already constructed (`const calendarEvents = createCalendarEventRepository(prisma);`). Add it to the `repos` object passed to `buildApp`:

```ts
    repos: { settings, tasks, habits, scheduledBlocks, calendarEvents },
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -w @notreclaim/server -- test/calendar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run the full server suite + typecheck**

Run: `npm test -w @notreclaim/server && npm run build -w @notreclaim/server`
Expected: all server tests pass; build/typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/calendar-routes.ts packages/server/src/app.ts packages/server/src/server.ts packages/server/test/fakes.ts packages/server/test/calendar.test.ts
git commit -m "feat(server): add read-only GET /calendar/events route"
```

---

## Task 2: Web — preview DTO fix + `CalendarEvent` DTO + `getCalendarEvents` client method

**Files:**
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/test/fakes.tsx`
- Modify: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Correct/extend the DTOs in `src/api/types.ts`**

Replace the existing `UnscheduledItem` and `SchedulePreview` definitions (lines ~66–76) with the engine-accurate shapes, and add `PreviewBlock` + `CalendarEvent`:

```ts
export interface PreviewBlock {
  id: string;                 // e.g. "task:<id>:0"
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  start: number;              // epoch ms
  end: number;                // epoch ms
}

export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
  remainingMs: number;        // work time that could not be placed
}

export interface SchedulePreview {
  blocks: PreviewBlock[];
  unscheduled: UnscheduledItem[];
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  startsAt: string;           // ISO
  endsAt: string;             // ISO
  googleCalendarId: string;
  googleEventId: string;
}
```

(The persisted `ScheduledBlock` interface is already correct — leave it unchanged.)

- [ ] **Step 2: Write the failing client test in `src/api/client.test.ts`**

Add this test inside the `describe('createApiClient', ...)` block:

```ts
  it('getCalendarEvents builds the range query string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 'e1', title: 'Standup' }]));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await api.getCalendarEvents('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');

    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calls[0][0]).toBe('/calendar/events?from=2026-01-05T00%3A00%3A00.000Z&to=2026-01-12T00%3A00%3A00.000Z');
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/api/client.test.ts`
Expected: FAIL — `api.getCalendarEvents is not a function`.

- [ ] **Step 4: Add `getCalendarEvents` to `src/api/client.ts`**

Extend the type import (line 1–4) to include `CalendarEvent`:

```ts
import type {
  Task, Habit, Settings, ScheduledBlock, SchedulePreview, ReconcileResult, CalendarEvent,
  TaskStatus, CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput,
} from './types';
```

Add to the `ApiClient` interface (after `getSchedule`):

```ts
  getCalendarEvents(from?: string, to?: string): Promise<CalendarEvent[]>;
```

Add to the returned object (after the `getSchedule` impl), mirroring it:

```ts
    getCalendarEvents: (from, to) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      return request('GET', `/calendar/events${qs ? `?${qs}` : ''}`);
    },
```

- [ ] **Step 5: Add `getCalendarEvents` to the fake base in `src/test/fakes.tsx`**

In `fakeApiClient`'s `base` object, after `getSchedule`:

```ts
    getCalendarEvents: notImplemented('getCalendarEvents'),
```

- [ ] **Step 6: Run the client test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/api/client.ts packages/web/src/test/fakes.tsx packages/web/src/api/client.test.ts
git commit -m "feat(web): correct preview DTO, add CalendarEvent DTO + getCalendarEvents client method"
```

---

## Task 3: Web — `api/queries.ts` (query-key source of truth + hooks)

**Files:**
- Create: `packages/web/src/api/queries.ts`
- Create: `packages/web/src/api/queries.test.tsx`

- [ ] **Step 1: Write the failing hook test `src/api/queries.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { queryKeys, useScheduleQuery, useReplanMutation } from './queries';

function wrap(api = fakeApiClient(), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  return { Wrapper, qc };
}

describe('queryKeys', () => {
  it('roots are stable prefixes', () => {
    expect(queryKeys.scheduleRoot).toEqual(['schedule']);
    expect(queryKeys.calendarEventsRoot).toEqual(['calendarEvents']);
    expect(queryKeys.tasksRoot).toEqual(['tasks']);
    expect(queryKeys.schedule('a', 'b')).toEqual(['schedule', { from: 'a', to: 'b' }]);
    expect(queryKeys.schedulePreview()).toEqual(['schedule', 'preview']);
  });
});

describe('useScheduleQuery', () => {
  it('calls getSchedule with the range and returns data', async () => {
    const getSchedule = vi.fn(async () => [{ id: 'b1' }]);
    const api = fakeApiClient({ getSchedule } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useScheduleQuery('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSchedule).toHaveBeenCalledWith('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');
    expect(result.current.data).toEqual([{ id: 'b1' }]);
  });
});

describe('useReplanMutation', () => {
  it('calls replan and invalidates the schedule prefix on success', async () => {
    const replan = vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 }));
    const api = fakeApiClient({ replan } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useReplanMutation(), { wrapper: Wrapper });
    result.current.mutate();
    await waitFor(() => expect(replan).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: FAIL — `Cannot find module './queries'`.

- [ ] **Step 3: Create `src/api/queries.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiProvider';

export const queryKeys = {
  scheduleRoot: ['schedule'] as const,
  schedule: (from?: string, to?: string) => ['schedule', { from, to }] as const,
  schedulePreview: () => ['schedule', 'preview'] as const,
  calendarEventsRoot: ['calendarEvents'] as const,
  calendarEvents: (from?: string, to?: string) => ['calendarEvents', { from, to }] as const,
  tasksRoot: ['tasks'] as const,
  tasks: (status?: string) => ['tasks', { status }] as const,
};

export function useScheduleQuery(from?: string, to?: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.schedule(from, to), queryFn: () => api.getSchedule(from, to) });
}

export function useCalendarEventsQuery(from?: string, to?: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.calendarEvents(from, to), queryFn: () => api.getCalendarEvents(from, to) });
}

export function useSchedulePreviewQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.schedulePreview(), queryFn: () => api.getSchedulePreview() });
}

export function useReplanMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.replan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/queries.ts packages/web/src/api/queries.test.tsx
git commit -m "feat(web): centralized query keys + schedule/calendar/replan hooks"
```

---

## Task 4: Web — `api/queryClient.ts` (401 interceptor) + main.tsx wiring

**Files:**
- Create: `packages/web/src/api/queryClient.ts`
- Create: `packages/web/src/api/queryClient.test.ts`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Write the failing test `src/api/queryClient.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createQueryClient } from './queryClient';
import { ApiError } from './client';

describe('createQueryClient', () => {
  it('calls onUnauthorized on a 401 ApiError from a query', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    await qc.fetchQuery({ queryKey: ['x'], queryFn: async () => { throw new ApiError(401, 'unauthorized', 'no'); } }).catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores non-401 ApiErrors and plain errors', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    await qc.fetchQuery({ queryKey: ['a'], queryFn: async () => { throw new ApiError(500, 'oops', 'server'); } }).catch(() => {});
    await qc.fetchQuery({ queryKey: ['b'], queryFn: async () => { throw new Error('network'); } }).catch(() => {});
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('also fires on a 401 from a mutation', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    const mutation = qc.getMutationCache().build(qc, {
      mutationFn: async () => { throw new ApiError(401, 'unauthorized', 'no'); },
    });
    await mutation.execute(undefined).catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/api/queryClient.test.ts`
Expected: FAIL — `Cannot find module './queryClient'`.

- [ ] **Step 3: Create `src/api/queryClient.ts`**

```ts
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './client';

export interface QueryClientOptions {
  onUnauthorized: () => void;
}

export function createQueryClient({ onUnauthorized }: QueryClientOptions): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false } },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/api/queryClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it in `src/main.tsx`**

Replace the `QueryClient` import + construction with the factory, signing out on 401:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { ApiProvider } from './api/ApiProvider';
import { AuthProvider } from './auth/AuthContext';
import { createApiClient } from './api/client';
import { createQueryClient } from './api/queryClient';
import { tokenStore } from './auth/tokenStore';
import './index.css';

const queryClient = createQueryClient({
  onUnauthorized: () => {
    tokenStore.clear();
    window.location.assign('/signin');
  },
});
const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken: () => tokenStore.get()?.token ?? null,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/queryClient.ts packages/web/src/api/queryClient.test.ts packages/web/src/main.tsx
git commit -m "feat(web): global 401 interceptor that signs out and redirects"
```

---

## Task 5: Web — realtime invalidation uses shared keys + refreshes calendar on sync

**Files:**
- Modify: `packages/web/src/realtime/events.ts`
- Modify: `packages/web/src/realtime/events.test.ts`

- [ ] **Step 1: Update the failing test `src/realtime/events.test.ts`**

Replace the `sync.completed` test and add a calendar assertion:

```ts
  it('sync.completed invalidates schedule and calendar-event queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['calendarEvents'] });
  });
```

(Keep the `schedule.updated` and `task.changed` tests as-is — their expected keys are unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/realtime/events.test.ts`
Expected: FAIL — `sync.completed` does not yet invalidate `['calendarEvents']`.

- [ ] **Step 3: Update `src/realtime/events.ts` to use `queryKeys`**

```ts
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: unknown }
  | { type: 'sync.completed'; userId: string; sync: unknown; counts: unknown }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

/** Invalidate the query keys affected by a server event. Invalidating a root key (e.g.
 *  ['schedule']) matches every ['schedule', ...] key (including ['schedule','preview']) by prefix. */
export function invalidateForEvent(qc: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case 'schedule.updated':
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      break;
    case 'sync.completed':
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.calendarEventsRoot });
      break;
    case 'task.changed':
      void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      break;
  }
}
```

- [ ] **Step 4: Run the realtime tests to verify they pass**

Run: `npm test -w @notreclaim/web -- src/realtime/`
Expected: PASS (events + useWebSocket suites).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/realtime/events.ts packages/web/src/realtime/events.test.ts
git commit -m "refactor(web): realtime invalidation uses shared query keys; sync refreshes calendar"
```

---

## Task 6: Web — pure `weekModel.ts` (date + layout math) + `TZ=UTC` test pinning

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/app/planner/weekModel.ts`
- Create: `packages/web/src/app/planner/weekModel.test.ts`

- [ ] **Step 1: Pin `TZ=UTC` in the web test script (`packages/web/package.json`)**

Change the `test` script so local-time math is deterministic:

```json
    "test": "TZ=UTC vitest run"
```

- [ ] **Step 2: Write the failing test `src/app/planner/weekModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import {
  startOfWeek, dayColumns, classifyBlock, placeInDay, nowLine, humanizeMs,
  WINDOW_START_MIN, WINDOW_END_MIN,
} from './weekModel';

const MON = Date.parse('2026-01-05T00:00:00.000Z'); // Monday 00:00 UTC
const WED_NOON = Date.parse('2026-01-07T12:00:00.000Z');

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Focus',
    startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:30:00.000Z',
    taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0', ...over,
  };
}

describe('startOfWeek / dayColumns', () => {
  it('startOfWeek returns Monday 00:00 of the week', () => {
    expect(startOfWeek(WED_NOON)).toBe(MON);
    expect(startOfWeek(MON)).toBe(MON);
  });
  it('dayColumns returns 7 consecutive day starts', () => {
    const cols = dayColumns(MON);
    expect(cols).toHaveLength(7);
    expect(cols[0]).toBe(MON);
    expect(cols[6]).toBe(Date.parse('2026-01-11T00:00:00.000Z'));
  });
});

describe('classifyBlock', () => {
  it('classifies task vs habit and reads pinned', () => {
    expect(classifyBlock(block())).toEqual({ kind: 'task', pinned: false });
    expect(classifyBlock(block({ taskId: null, habitId: 'h1' }))).toEqual({ kind: 'habit', pinned: false });
    expect(classifyBlock(block({ pinned: true }))).toEqual({ kind: 'task', pinned: true });
  });
});

describe('placeInDay', () => {
  const dayStart = MON;
  it('positions a block within the 6:00-22:00 window', () => {
    const start = Date.parse('2026-01-05T09:00:00.000Z');
    const end = Date.parse('2026-01-05T09:30:00.000Z');
    const span = WINDOW_END_MIN - WINDOW_START_MIN; // 960
    expect(placeInDay(start, end, dayStart)).toEqual({
      topPct: ((540 - WINDOW_START_MIN) / span) * 100,
      heightPct: (30 / span) * 100,
    });
  });
  it('clamps a block that starts before the window', () => {
    const start = Date.parse('2026-01-05T05:00:00.000Z');
    const end = Date.parse('2026-01-05T07:00:00.000Z');
    const pos = placeInDay(start, end, dayStart)!;
    expect(pos.topPct).toBe(0);
    expect(pos.heightPct).toBeCloseTo((60 / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
  });
  it('returns null when the interval is outside the day window', () => {
    const start = Date.parse('2026-01-05T23:00:00.000Z');
    const end = Date.parse('2026-01-05T23:30:00.000Z');
    expect(placeInDay(start, end, dayStart)).toBeNull();
    // a different day entirely:
    expect(placeInDay(Date.parse('2026-01-06T09:00:00.000Z'), Date.parse('2026-01-06T10:00:00.000Z'), dayStart)).toBeNull();
  });
});

describe('nowLine', () => {
  it('returns a position when now is inside the day window, else null', () => {
    const pos = nowLine(WED_NOON, Date.parse('2026-01-07T00:00:00.000Z'));
    expect(pos).toBeCloseTo(((720 - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
    expect(nowLine(WED_NOON, MON)).toBeNull();
  });
});

describe('humanizeMs', () => {
  it('formats durations', () => {
    expect(humanizeMs(90 * 60000)).toBe('1h 30m');
    expect(humanizeMs(30 * 60000)).toBe('30m');
    expect(humanizeMs(2 * 3600000)).toBe('2h');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`
Expected: FAIL — `Cannot find module './weekModel'`.

- [ ] **Step 4: Create `src/app/planner/weekModel.ts`**

```ts
import type { ScheduledBlock } from '../../api/types';

export const WINDOW_START_MIN = 6 * 60;   // 06:00
export const WINDOW_END_MIN = 22 * 60;    // 22:00
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 (local) of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** Seven consecutive local-midnight timestamps starting at `weekStartMs`. */
export function dayColumns(weekStartMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMs);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d.getTime());
  }
  return out;
}

export interface BlockClass {
  kind: 'task' | 'habit';
  pinned: boolean;
}

export function classifyBlock(b: ScheduledBlock): BlockClass {
  return { kind: b.habitId != null ? 'habit' : 'task', pinned: b.pinned };
}

export interface BlockPosition {
  topPct: number;
  heightPct: number;
}

/**
 * Position an interval within a day's 06:00-22:00 window, as top/height percentages.
 * Clamps to the window; returns null when the interval does not intersect the window
 * (outside hours, or a different day).
 */
export function placeInDay(startMs: number, endMs: number, dayStartMs: number): BlockPosition | null {
  const startMin = (startMs - dayStartMs) / MS_PER_MIN;
  const endMin = (endMs - dayStartMs) / MS_PER_MIN;
  const clampedStart = Math.max(startMin, WINDOW_START_MIN);
  const clampedEnd = Math.min(endMin, WINDOW_END_MIN);
  if (clampedEnd <= clampedStart) return null;
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  return {
    topPct: ((clampedStart - WINDOW_START_MIN) / span) * 100,
    heightPct: ((clampedEnd - clampedStart) / span) * 100,
  };
}

/** Vertical position (%) of the "now" line within this day's window, or null if not today/in-window. */
export function nowLine(now: number, dayStartMs: number): number | null {
  const min = (now - dayStartMs) / MS_PER_MIN;
  if (min < WINDOW_START_MIN || min > WINDOW_END_MIN) return null;
  const span = WINDOW_END_MIN - WINDOW_START_MIN;
  return ((min - WINDOW_START_MIN) / span) * 100;
}

/** True when `now` falls within [dayStart, dayStart+24h). */
export function isToday(now: number, dayStartMs: number): boolean {
  return now >= dayStartMs && now < dayStartMs + MS_PER_DAY;
}

export function humanizeMs(ms: number): string {
  const totalMin = Math.round(ms / MS_PER_MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): pure weekModel date/layout math; pin TZ=UTC in web tests"
```

---

## Task 7: Web — `EventBlock` component

**Files:**
- Create: `packages/web/src/app/planner/EventBlock.tsx`
- Create: `packages/web/src/app/planner/EventBlock.test.tsx`

- [ ] **Step 1: Write the failing test `src/app/planner/EventBlock.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBlock } from './EventBlock';

describe('EventBlock', () => {
  it('renders title, kind, and position', () => {
    render(<EventBlock title="Standup" kind="meeting" topPct={10} heightPct={5} startLabel="10:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveTextContent('Standup');
    expect(el).toHaveAttribute('data-kind', 'meeting');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.style.top).toBe('10%');
    expect(el.style.height).toBe('5%');
  });

  it('marks pinned blocks', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-pinned', 'true');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: FAIL — `Cannot find module './EventBlock'`.

- [ ] **Step 3: Create `src/app/planner/EventBlock.tsx`**

```tsx
export type BlockKind = 'meeting' | 'task' | 'habit';

const KIND_BG: Record<BlockKind, string> = {
  meeting: 'bg-slate-400',
  task: 'bg-blue-500',
  habit: 'bg-green-500',
};

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false }: EventBlockProps) {
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      className={`absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight text-white ${KIND_BG[kind]}`}
      style={{
        top: `${topPct}%`,
        height: `${heightPct}%`,
        boxShadow: pinned ? 'inset 3px 0 0 #f59e0b' : undefined,
      }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/EventBlock.test.tsx
git commit -m "feat(web): EventBlock — color-coded, pinned-marked calendar block"
```

---

## Task 8: Web — `AtRiskPanel` component

**Files:**
- Create: `packages/web/src/app/planner/AtRiskPanel.tsx`
- Create: `packages/web/src/app/planner/AtRiskPanel.test.tsx`

- [ ] **Step 1: Write the failing test `src/app/planner/AtRiskPanel.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UnscheduledItem } from '../../api/types';
import { AtRiskPanel } from './AtRiskPanel';

const item = (over: Partial<UnscheduledItem> = {}): UnscheduledItem => ({
  sourceType: 'task', sourceId: 't1', title: 'Tax filing', reason: 'no free time before due', remainingMs: 90 * 60000, ...over,
});

describe('AtRiskPanel', () => {
  it('lists unscheduled items with reason and remaining time', () => {
    render(<AtRiskPanel items={[item(), item({ sourceId: 't2', title: 'Read paper', remainingMs: 2 * 3600000 })]} />);
    const rows = screen.getAllByTestId('at-risk-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Tax filing');
    expect(rows[0]).toHaveTextContent('no free time before due');
    expect(rows[0]).toHaveTextContent('1h 30m');
    expect(rows[1]).toHaveTextContent('2h');
  });

  it('shows an empty state when nothing is at risk', () => {
    render(<AtRiskPanel items={[]} />);
    expect(screen.getByText('Nothing at risk.')).toBeInTheDocument();
    expect(screen.queryByTestId('at-risk-item')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/AtRiskPanel.test.tsx`
Expected: FAIL — `Cannot find module './AtRiskPanel'`.

- [ ] **Step 3: Create `src/app/planner/AtRiskPanel.tsx`**

```tsx
import type { UnscheduledItem } from '../../api/types';
import { humanizeMs } from './weekModel';

export function AtRiskPanel({ items }: { items: UnscheduledItem[] }) {
  return (
    <aside className="w-44 shrink-0 rounded-lg border border-gray-200 p-3 text-xs">
      <h3 className="mb-2 font-semibold">⚠ At-risk ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-gray-500">Nothing at risk.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.sourceType}:${it.sourceId}`}
              data-testid="at-risk-item"
              className="rounded border-l-2 border-red-500 bg-red-50 px-2 py-1"
            >
              <div className="font-medium">{it.title}</div>
              <div className="text-[11px] text-red-700">{it.reason}</div>
              <div className="text-[11px] text-gray-500">{humanizeMs(it.remainingMs)} unplaced</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/AtRiskPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/AtRiskPanel.tsx packages/web/src/app/planner/AtRiskPanel.test.tsx
git commit -m "feat(web): AtRiskPanel listing unscheduled items"
```

---

## Task 9: Web — `WeekGrid` component

**Files:**
- Create: `packages/web/src/app/planner/WeekGrid.tsx`
- Create: `packages/web/src/app/planner/WeekGrid.test.tsx`

- [ ] **Step 1: Write the failing test `src/app/planner/WeekGrid.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { startOfWeek, dayColumns } from './weekModel';
import { WeekGrid, type WeekGridProps } from './WeekGrid';

const MON = startOfWeek(Date.parse('2026-01-05T12:00:00.000Z')); // 2026-01-05
const days = dayColumns(MON);
const WED_NOON = Date.parse('2026-01-07T12:00:00.000Z');

const block = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-05T13:00:00.000Z', endsAt: '2026-01-05T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0', ...over,
});
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1', ...over,
});

function renderGrid(props: Partial<WeekGridProps> = {}) {
  return render(
    <WeekGrid
      days={days}
      nowMs={WED_NOON}
      weekLabel="Jan 5 – 11"
      blocks={[block()]}
      events={[event()]}
      replanPending={false}
      onPrev={vi.fn()}
      onToday={vi.fn()}
      onNext={vi.fn()}
      onReplan={vi.fn()}
      {...props}
    />,
  );
}

describe('WeekGrid', () => {
  it('places a meeting and a task block in their day columns', () => {
    renderGrid();
    const blocks = screen.getAllByTestId('event-block');
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'meeting' && b.textContent?.includes('Standup'))).toBe(true);
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'task' && b.textContent?.includes('Write spec'))).toBe(true);
  });

  it('highlights today', () => {
    renderGrid();
    const todayHeader = screen.getByTestId('day-header-2'); // index 2 = Wednesday
    expect(todayHeader).toHaveAttribute('data-today', 'true');
  });

  it('renders a now-line on today', () => {
    renderGrid();
    expect(screen.getByTestId('now-line')).toBeInTheDocument();
  });

  it('fires onReplan when the button is clicked', () => {
    const onReplan = vi.fn();
    renderGrid({ onReplan });
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    expect(onReplan).toHaveBeenCalledTimes(1);
  });

  it('fires nav callbacks', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
    renderGrid({ onPrev, onNext, onToday });
    fireEvent.click(screen.getByRole('button', { name: '◀' }));
    fireEvent.click(screen.getByRole('button', { name: '▶' }));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`
Expected: FAIL — `Cannot find module './WeekGrid'`.

- [ ] **Step 3: Create `src/app/planner/WeekGrid.tsx`**

```tsx
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { placeInDay, nowLine, isToday, classifyBlock } from './weekModel';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_TICKS = [6, 8, 10, 12, 14, 16, 18, 20, 22];

export interface WeekGridProps {
  days: number[];            // 7 local-midnight timestamps
  nowMs: number;
  weekLabel: string;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  replanPending: boolean;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onReplan: () => void;
}

interface Item {
  key: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  startMs: number;
  endMs: number;
  startLabel: string;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toItems(blocks: ScheduledBlock[], events: CalendarEvent[]): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned,
      startMs, endMs: Date.parse(b.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: 'meeting', pinned: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: timeLabel(startMs) };
  });
  return [...fromEvents, ...fromBlocks];
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan } = props;
  const items = toItems(blocks, events);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onPrev} className="rounded border border-gray-300 px-2 py-0.5">◀</button>
        <button onClick={onToday} className="rounded border border-gray-300 px-2 py-0.5">Today</button>
        <button onClick={onNext} className="rounded border border-gray-300 px-2 py-0.5">▶</button>
        <span className="font-semibold">{weekLabel}</span>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded bg-blue-600 px-3 py-0.5 text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
      </div>

      <div className="grid grid-cols-[34px_repeat(7,1fr)] overflow-hidden rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50" />
        {days.map((d, i) => (
          <div
            key={d}
            data-testid={`day-header-${i}`}
            data-today={isToday(nowMs, d)}
            className={`border-b border-l border-gray-100 bg-gray-50 py-1 text-center text-xs font-semibold ${
              isToday(nowMs, d) ? 'text-blue-600' : ''
            }`}
          >
            {DAY_LABELS[i]} {new Date(d).getDate()}
          </div>
        ))}

        <div className="bg-gray-50">
          {HOUR_TICKS.map((h) => (
            <div key={h} className="h-[22px] pr-1 text-right text-[9px] text-gray-400">{h}</div>
          ))}
        </div>
        {days.map((d, i) => {
          const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
          const line = nowLine(nowMs, d);
          return (
            <div key={d} data-testid={`day-col-${i}`} className="relative min-h-[198px] border-l border-gray-100">
              {dayItems.map((it) => {
                const pos = placeInDay(it.startMs, it.endMs, d);
                if (!pos) return null;
                return (
                  <EventBlock
                    key={it.key}
                    title={it.title}
                    kind={it.kind}
                    pinned={it.pinned}
                    topPct={pos.topPct}
                    heightPct={pos.heightPct}
                    startLabel={it.startLabel}
                  />
                );
              })}
              {line != null && (
                <div data-testid="now-line" className="absolute left-0 right-0 h-0.5 bg-red-500" style={{ top: `${line}%` }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "feat(web): WeekGrid — 7-day grid, toolbar, now-line, positioned blocks"
```

---

## Task 10: Web — `Planner` page (integration) + Vite proxy

**Files:**
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Create: `packages/web/src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Add `/calendar` to the Vite dev proxy (`packages/web/vite.config.ts`)**

In the `proxy` map, after `'/schedule': API,`:

```ts
      '/schedule': API,
      '/calendar': API,
```

- [ ] **Step 2: Write the failing integration test `src/app/pages/Planner.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Planner } from './Planner';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const blocks: ScheduledBlock[] = [{
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-07T13:00:00.000Z', endsAt: '2026-01-07T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0',
}];
const events: CalendarEvent[] = [{
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1',
}];
const preview: SchedulePreview = {
  blocks: [],
  unscheduled: [{ sourceType: 'task', sourceId: 't9', title: 'Tax filing', reason: 'no free time before due', remainingMs: 3600000 }],
};

function makeApi(over = {}) {
  return fakeApiClient({
    getSchedule: vi.fn(async () => blocks),
    getCalendarEvents: vi.fn(async () => events),
    getSchedulePreview: vi.fn(async () => preview),
    replan: vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 })),
    ...over,
  } as never);
}

describe('Planner', () => {
  it('renders blocks, meetings, and at-risk items', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Tax filing')).toBeInTheDocument();
  });

  it('clicking Re-plan calls api.replan', async () => {
    const replan = vi.fn(async () => ({ created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 }));
    const api = makeApi({ replan });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /re-plan/i }));
    await waitFor(() => expect(replan).toHaveBeenCalledTimes(1));
  });

  it('navigating to the next week refetches with a new range', async () => {
    const getSchedule = vi.fn(async () => blocks);
    const api = makeApi({ getSchedule });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(1));
    const firstFrom = getSchedule.mock.calls[0]![0];
    fireEvent.click(screen.getByRole('button', { name: '▶' }));
    await waitFor(() => expect(getSchedule).toHaveBeenCalledTimes(2));
    const secondFrom = getSchedule.mock.calls[1]![0];
    expect(secondFrom).not.toBe(firstFrom);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`
Expected: FAIL — the placeholder `Planner` renders no blocks and accepts no `now` prop.

- [ ] **Step 4: Replace `src/app/pages/Planner.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation } from '../../api/queries';
import { startOfWeek, dayColumns } from '../planner/weekModel';
import { WeekGrid } from '../planner/WeekGrid';
import { AtRiskPanel } from '../planner/AtRiskPanel';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function weekLabel(days: number[]): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(days[0]!)} – ${fmt(days[6]!)}`;
}

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const [weekStartMs, setWeekStartMs] = useState(() => startOfWeek(nowMs));
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(weekStartMs + 7 * MS_PER_DAY).toISOString();

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const replan = useReplanMutation();

  const isLoading = schedule.isLoading || calendar.isLoading || preview.isLoading;
  const isError = schedule.isError || calendar.isError || preview.isError;

  if (isLoading) {
    return <div className="p-6 text-gray-500">Loading your week…</div>;
  }
  if (isError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn’t load the schedule.</p>
        <button
          onClick={() => { void schedule.refetch(); void calendar.refetch(); void preview.refetch(); }}
          className="rounded border border-gray-300 px-3 py-1"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days)}
          blocks={schedule.data ?? []}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setWeekStartMs(weekStartMs - 7 * MS_PER_DAY)}
          onNext={() => setWeekStartMs(weekStartMs + 7 * MS_PER_DAY)}
          onToday={() => setWeekStartMs(startOfWeek(now()))}
          onReplan={() => replan.mutate()}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      <AtRiskPanel items={preview.data?.unscheduled ?? []} />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`
Expected: PASS.

- [ ] **Step 6: Give the authenticated `App.test.tsx` renders an empty-data API stub**

`App.test.tsx` renders `<App />` at `/` (the Planner route). It asserts only sidebar/nav and the Habits page — **not** any Planner copy — so no assertion needs changing. But now that `Planner` fetches on mount, the default `fakeApiClient()` (whose schedule/calendar/preview methods reject with "not implemented") would error asynchronously and emit `act(...)` warnings. Give the three authenticated tests a stub API that returns empty data so the grid renders cleanly.

Add this helper near the top of `App.test.tsx` (after the imports), importing `fakeApiClient`:

```ts
import { renderWithProviders, fakeApiClient } from '../test/fakes';

function authedApi() {
  return fakeApiClient({
    getSchedule: async () => [],
    getCalendarEvents: async () => [],
    getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
  } as never);
}
```

(Replace the existing `import { renderWithProviders } from '../test/fakes';` line with the combined import above.)

Then pass `api: authedApi()` to the three authenticated renders (the ones that call `tokenStore.set(...)`):

```ts
renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
```

Leave the first test (`redirects to /signin when unauthenticated`) unchanged — it never mounts the Planner.

- [ ] **Step 7: Run the App routing tests to verify they pass**

Run: `npm test -w @notreclaim/web -- src/app/App.test.tsx`
Expected: PASS (4 tests), no `act(...)` warnings about the Planner.

- [ ] **Step 8: Commit**

```bash
git add packages/web/vite.config.ts packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): Planner page wiring grid + at-risk + re-plan; proxy /calendar"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire monorepo test suite**

Run: `npm test`
Expected: every package passes with **zero failures**. Baselines before 5b were core 27, scheduler 31, google 33, db 35, server 52, web 25. After 5b: server gains the `calendar.test.ts` suite (3 tests → 55), and web gains the queries/queryClient/weekModel/EventBlock/AtRiskPanel/WeekGrid/Planner suites plus the extended events test. Note the new totals; the only requirement is no failures.

- [ ] **Step 2: Typecheck/build the touched packages**

Run: `npm run build -w @notreclaim/server && npm run build -w @notreclaim/web`
Expected: both clean. The web build typechecks test files (`tsc -p tsconfig.json`), so any test-only type error fails here — fix before proceeding.

- [ ] **Step 3: Commit any build-driven fixes (if needed)**

```bash
git add -A
git commit -m "chore(web): typecheck fixes for 5b"
```

(Skip if the build was already clean.)

---

## Notes for the implementer

- **`fakeApiClient` typing:** the 5a fake casts its base to `ApiClient`. When passing `getSchedule`/`getCalendarEvents`/etc. overrides in tests, the `as never` cast in the examples sidesteps the partial-override variance; keep it.
- **`renderHook` is available** from `@testing-library/react` (used in `useWebSocket.test.tsx`).
- **TanStack v5 mutation test:** `qc.getMutationCache().build(qc, { mutationFn }).execute(vars)` runs the mutation and triggers `MutationCache.onError` — that is how the 401 mutation path is exercised without a component.
- **Timezone:** all positioning math lives in `weekModel.ts` and is exercised under `TZ=UTC`. In the browser it uses the user's local zone (the documented 5b default). Do not introduce a timezone library.
- **DST:** day membership/positioning ignores DST transitions (acceptable for 5b; documented in the spec's Decisions).
- **No `Date.now()` in pure modules:** `weekModel.ts` must never call `Date.now()`/`new Date()` with no args. `Planner.tsx` is a component (impure boundary) and may default `now` to `Date.now`.
```
