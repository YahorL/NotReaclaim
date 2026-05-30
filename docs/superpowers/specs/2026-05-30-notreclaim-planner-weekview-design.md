# NotReclaim Web Client — Planner Week-View — Design Spec (Milestone 5b)

**Date:** 2026-05-30
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Foundation:** `docs/superpowers/specs/2026-05-29-notreclaim-web-foundation-design.md` (5a, merged)
**Depends on:** Milestones 1–5a (all merged): `@notreclaim/scheduler`, `@notreclaim/db`,
`@notreclaim/core`, `@notreclaim/google`, `@notreclaim/server`, `@notreclaim/web` (foundation).

## Summary

Milestone 5b makes the Planner real: a **7-day week-view calendar grid** that renders the
user's committed schedule — Google meetings as fixed/busy blocks, auto-scheduled task and
habit blocks color-coded, user-pinned blocks marked — with an **at-risk panel** for items
the engine could not place, a **manual re-plan** button, and **live WebSocket refresh**.

It also lands two carry-overs flagged in the 5a final review (now that the first real data
fetch arrives): a **401-from-`ApiError` interceptor** that signs the user out, and a
**single source of truth for query keys** so realtime invalidation can't drift from fetch
keys. It corrects the `SchedulePreview` DTO, which 5a defined against the wrong shape.

The one cross-package change is a small, read-only server addition: `GET /calendar/events`.

## Goals

- A 7-day week grid (Variant A layout): time gutter, day-header row with today highlighted,
  a red "now" line, color-coded positioned blocks, vertical scroll, week navigation.
- Render three reads together: persisted blocks (`GET /schedule`), Google meetings
  (`GET /calendar/events`, **new**), and the engine preview's `unscheduled` list
  (`GET /schedule/preview`) in a right-hand **at-risk** panel.
- A **↻ Re-plan** button (`POST /schedule/replan`) with pending/error states.
- Live refresh: server WebSocket events invalidate the affected TanStack Query keys.
- The two 5a carry-overs: 401 interceptor (sign-out + redirect) and centralized query keys.
- Everything testable deterministically (jsdom, injected `now`, pinned `TZ`, mocked
  `ApiClient`); no real network or Google.

## Non-Goals (5b)

Drawing the engine **preview's `blocks`** on the grid as a "what-if" overlay (only its
`unscheduled` list is consumed; the grid shows the *committed* schedule). Drag-to-reschedule,
click-to-pin, or any block editing (later). Honoring `settings.timezone` for rendering — 5b
renders in the **browser-local** timezone (see Decisions). Tasks/Habits/Settings panels
(5c/5d). A shared `contracts` types package (client DTOs stay hand-defined).

## Decisions (defaults locked during brainstorming)

- **Grid source = the committed schedule.** Persisted `ScheduledBlock`s + `CalendarEvent`s
  are drawn. The preview is computed live and feeds only the at-risk panel; the committed
  blocks are kept fresh by the background re-plan/poll loop and WS pushes (milestone 4b).
- **Meetings are shown.** A calendar that hides the meetings its focus-blocks were scheduled
  around is misleading, so we add a read endpoint for `CalendarEvent`s.
- **Browser-local timezone.** Single-user self-hosted; browser tz ≈ `settings.timezone`
  virtually always. Avoids a tz library now. Honoring the configured tz is a later
  enhancement. Tests pin `TZ` for deterministic block positioning.
- **Day window 6:00–22:00, vertically scrollable.** A fixed render window (constants), with
  blocks clamped to it. A settings-driven window is a later enhancement.
- **Week starts Monday.**

## Server change — `GET /calendar/events` (`@notreclaim/server`)

Read-only, guarded, backward-compatible. The `CalendarEvent` repo and its
`listByUserInRange` already exist (used by the scheduling layer); we expose them to the
client and add no engine behavior.

- **`AppDeps.repos`** gains `calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>`
  (alongside the existing `scheduledBlocks`). `server.ts` already constructs this repo for
  `schedulingRepos` — it passes the same instance into `repos.calendarEvents`. `fakes.ts`
  `TestAppOptions` gains a `calendarEvents` fake.
- **New `calendar-routes.ts`**, registered in `app.ts` next to `registerScheduleRoutes`,
  mirroring `schedule-routes.ts`:

  ```ts
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
  ```

- **Route tests:** requires auth (401 without token); returns the repo's rows for the parsed
  range; honors explicit `from`/`to`; falls back to `now → horizonDays` when omitted.

Returned rows serialize their `startsAt`/`endsAt` `Date`s to ISO strings (no response schema;
Fastify JSON-stringifies). The client DTO models them as `string`.

## API layer (`packages/web/src/api`)

### DTO corrections + additions (`types.ts`)

The 5a `SchedulePreview` DTO is **wrong**: it reuses the persisted `ScheduledBlock` shape, but
`GET /schedule/preview` returns the engine's `ScheduleResult` — blocks with **numeric**
`start`/`end` and `sourceType`/`sourceId`, and `unscheduled` items carrying `remainingMs`.
Corrected/added types:

```ts
export interface PreviewBlock {
  id: string;                       // e.g. "task:<id>:0"
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  start: number;                    // epoch ms
  end: number;                      // epoch ms
}
export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
  remainingMs: number;              // amount of work that could not be placed
}
export interface SchedulePreview {
  blocks: PreviewBlock[];
  unscheduled: UnscheduledItem[];
}
export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  startsAt: string;                 // ISO
  endsAt: string;                   // ISO
  googleCalendarId: string;
  googleEventId: string;
}
```

(The persisted `ScheduledBlock` DTO is already correct and unchanged.)

### Client method (`client.ts`)

Add to the `ApiClient` interface and implementation, mirroring `getSchedule`:

```ts
getCalendarEvents(from?: string, to?: string): Promise<CalendarEvent[]>;
// GET /calendar/events?from&to  (URLSearchParams, same as getSchedule)
```

### Query keys + hooks (`api/queries.ts`) — carry-over #2

Single source of truth so fetch keys and realtime-invalidation keys cannot drift:

```ts
export const queryKeys = {
  schedule: (from?: string, to?: string) => ['schedule', { from, to }] as const,
  schedulePreview: () => ['schedule', 'preview'] as const,
  calendarEvents: (from?: string, to?: string) => ['calendarEvents', { from, to }] as const,
  tasks: (status?: string) => ['tasks', { status }] as const,
};
```

Thin hooks built on these (used by the Planner now, by 5c/5d later):
`useScheduleQuery(from, to)`, `useCalendarEventsQuery(from, to)`, `useSchedulePreviewQuery()`,
and `useReplanMutation()` (calls `api.replan()`, on success invalidates the `schedule`
prefix). Each hook reads the `ApiClient` from `useApi()`. `realtime/events.ts` imports
`queryKeys` and invalidates by **prefix** (`['schedule']`, `['calendarEvents']`, `['tasks']`).

### 401 interceptor (`api/queryClient.ts`) — carry-over #1

A factory wiring global error handling so any expired/invalid token logs the user out:

```ts
export function createQueryClient(opts: { onUnauthorized: () => void }): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) opts.onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false } },
  });
}
```

`main.tsx` builds it with `onUnauthorized = () => { tokenStore.clear(); window.location.assign('/signin'); }`
(hard redirect → `AuthProvider` re-inits from the now-empty store → `ProtectedRoute` bounces
to `/signin`). The factory is injectable so tests assert `onUnauthorized` fires on a 401 and
not on other statuses. `retry: false` keeps query errors (and tests) deterministic.

## Planner UI (`packages/web/src/app/planner/`)

### `weekModel.ts` — pure, testable core (DI `now`)

No React, no `Date.now()`/`Math.random()`. Functions:

- `startOfWeek(now: number): number` — Monday 00:00 (browser-local) of `now`'s week.
- `addDays(ms, n)`, `dayColumns(weekStartMs): number[]` — 7 day-start timestamps.
- `WINDOW_START_MIN = 6*60`, `WINDOW_END_MIN = 22*60` — render window.
- `classifyBlock(b: ScheduledBlock): { kind: 'task' | 'habit'; pinned: boolean }` —
  `habitId != null` → habit, else task; `pinned` from the flag.
- `placeInDay(startMs, endMs, dayStartMs): { topPct: number; heightPct: number } | null` —
  position within the day window; returns `null` if the interval doesn't intersect the day
  (so the caller renders it in the right column only); clamps to `[WINDOW_START, WINDOW_END]`.
- `nowLine(now, dayStartMs): number | null` — `topPct` of the red line if `now` falls in this
  day's window, else `null`.
- `humanizeMs(ms): string` — e.g. `90 min` → "1h 30m" for the at-risk panel.

Unit-tested with fixed epoch inputs; `vitest.config` / test pins `TZ` (e.g. `TZ=UTC`) so
local-time math is deterministic.

### Components

- **`WeekGrid.tsx`** — toolbar (◀ / Today / ▶ + week label + `↻ Re-plan`), day-header row
  (today highlighted), time gutter, 7 day columns, the red now-line. Receives the week's
  blocks + events + the `onReplan` mutation state. Vertically scrollable; renders the
  6:00–22:00 window.
- **`EventBlock.tsx`** — one absolutely-positioned block from `placeInDay` output. Color by
  source: meeting = slate/gray, task = blue, habit = green; pinned blocks get an amber inset
  left bar. Shows title + start time; `title` attribute for overflow.
- **`AtRiskPanel.tsx`** — right panel listing `preview.unscheduled`: title + reason +
  `humanizeMs(remainingMs)`. Empty state: "Nothing at risk."
- **`Planner.tsx`** — replaces the 5a placeholder. Holds week state (initialized from `now`
  via a `useNow`/injected clock, default `Date.now`); composes `useScheduleQuery`,
  `useCalendarEventsQuery` (both for the visible week range), `useSchedulePreviewQuery`, and
  `useReplanMutation`; renders loading / error / empty states; wires ◀/Today/▶ and Re-plan.

The visible-week range is passed to `getSchedule`/`getCalendarEvents` as `from`/`to` ISO
strings (week start → week start + 7 days). The preview is range-less (engine computes over
the settings horizon); the at-risk panel shows all unscheduled items regardless of the week
in view.

## Realtime (`packages/web/src/realtime/events.ts`)

Extend the existing invalidation map (importing `queryKeys` prefixes):

- `schedule.updated` → invalidate `['schedule']` (covers `['schedule','preview']` by prefix).
- `sync.completed` → invalidate `['schedule']` **and** `['calendarEvents']` (a sync can change
  meetings).
- `task.changed` → invalidate `['tasks']` and `['schedule']`.

The hook itself (`useWebSocket`) is unchanged; only the event→keys map grows.

## Error handling

- Query errors (`ApiError` or network) → an inline error strip in the content area with a
  retry button (re-runs the queries). Non-fatal: the shell stays navigable.
- Re-plan mutation error → an inline message near the button; the button re-enables.
- `401` from any call → global interceptor signs out and redirects (above).
- Empty schedule (no blocks/events) → the grid renders an empty week (no error).

## Testing (deterministic; jsdom; no network or Google)

- **`weekModel` (pure):** `startOfWeek`/`dayColumns` boundaries; `classifyBlock` task vs habit
  vs pinned; `placeInDay` positioning, clamping, and null-when-outside-day; `nowLine`
  presence/position; `humanizeMs`. `TZ` pinned.
- **`createQueryClient`:** a query/mutation that rejects with `ApiError(401)` calls
  `onUnauthorized`; `ApiError(500)` and non-`ApiError` errors do **not**.
- **`queries.ts` / hooks:** `useScheduleQuery` calls `api.getSchedule(from,to)` with the right
  range; `useReplanMutation` calls `api.replan()` and invalidates the schedule prefix on
  success (spy on `queryClient.invalidateQueries`).
- **`WeekGrid` / `EventBlock` / `AtRiskPanel`** via `renderWithProviders` + `fakeApiClient`
  returning canned blocks/events/preview: blocks land in the correct day column with the
  correct color class; a pinned block shows the amber marker; today is highlighted; the
  at-risk panel lists unscheduled items (and the empty state).
- **`Planner` integration:** clicking **Re-plan** triggers `api.replan` (pending state shown);
  ◀/▶ change the requested week range; a `schedule.updated` WS event refetches (assert via
  invalidation/refetch spy).
- **`realtime/events.ts`:** each event type invalidates exactly the mapped prefixes (including
  the new `calendarEvents` on `sync.completed`).
- **Server (`@notreclaim/server`):** `GET /calendar/events` requires auth; returns
  `calendarEvents.listByUserInRange` rows for the parsed range; explicit `from`/`to` vs
  `now → horizonDays` fallback.
- **Build/typecheck:** `tsc -p tsconfig.json && vite build` clean (the build typechecks test
  files, per 5a).

## Scope

5b is cohesive enough for one implementation plan: a small read-only server route, the
client API corrections + the two carry-overs, the pure `weekModel`, and the Planner
components + integration. Subsequent sub-milestones — **5c** (Tasks & Habits panels) and
**5d** (Settings) — each get their own spec → plan → build, completing milestone 5.
