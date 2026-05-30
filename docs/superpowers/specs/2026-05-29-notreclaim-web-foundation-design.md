# NotReclaim Web Client — Foundation — Design Spec (Milestone 5a)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestones 1–4b (all merged): `@notreclaim/scheduler`, `@notreclaim/db`,
`@notreclaim/core`, `@notreclaim/google`, `@notreclaim/server`.

## Summary

Milestone 5 is the React + Vite + Tailwind web client — a Reclaim-style UI
(original implementation; no Reclaim code/assets) consuming the `@notreclaim/server`
REST API + `/ws` WebSocket. It is decomposed into four sub-milestones:

- **5a — Foundation (this spec):** scaffold, typed API client, Google sign-in flow,
  app shell + routing, and the realtime WebSocket hook.
- **5b — Planner week-view:** the calendar grid (fixed events + auto-scheduled
  blocks, color-coded, at-risk flags), manual re-plan, live WS refresh.
- **5c — Tasks & Habits panels:** the right-panel lists + quick-add + create/edit/
  delete forms.
- **5d — Settings:** working hours, timezone, horizon, default chunk sizes,
  connection status.

5a delivers a runnable, navigable skeleton: a sign-in screen, the authenticated app
shell (left sidebar nav + content area), placeholder pages for the four sections,
and the underlying data/auth/realtime plumbing every later sub-milestone builds on.

## Goals

- A new `packages/web` (`@notreclaim/web`): Vite + React 18 + TypeScript (strict) +
  Tailwind v3 + TanStack Query + React Router; Vitest + React Testing Library + jsdom.
- A typed `ApiClient` (bearer auth, JSON, typed errors) covering the server endpoints.
- Google sign-in via the redirect-with-token flow, including a small backward-
  compatible server change to the OAuth callback.
- App shell with a left sidebar and React Router routes; protected routing.
- A `useWebSocket` hook that invalidates TanStack Query keys on server events.
- Everything testable deterministically with a mocked `ApiClient` + a fake WebSocket
  (no real network, no real Google).

## Non-Goals (5a)

The rich Planner/Tasks/Habits/Settings UIs (5b–5d). Production static-serving of the
built client by the server (deferred to go-live; dev uses the Vite proxy). A shared
`contracts` types package (client DTOs are hand-defined for now). A dedicated
Google-connection status endpoint (being authenticated implies connected for this
single-user tool).

## Package & tooling

New **`packages/web`** (`@notreclaim/web`), picked up by the existing
`workspaces: ["packages/*"]` glob. Stack: Vite, React 18, TypeScript (strict),
Tailwind v3, `@tanstack/react-query`, `react-router-dom`; dev/test:
`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

```
packages/web/
  package.json
  tsconfig.json            # strict; jsx: react-jsx; bundler resolution; DOM libs
  vite.config.ts           # React plugin + dev proxy (see below)
  vitest.config.ts         # jsdom environment, setup file
  tailwind.config.js · postcss.config.js
  index.html
  src/
    main.tsx               # mount: QueryClientProvider + BrowserRouter + AuthProvider + App
    app/
      App.tsx              # <Routes>: /signin, /auth/callback, protected shell routes
      AppShell.tsx         # sidebar (nav + connection status + sign-out) + routed content
      Sidebar.tsx
      ProtectedRoute.tsx   # redirect to /signin when unauthenticated
      pages/{Planner,Tasks,Habits,Settings}.tsx  # 5a placeholders
    api/
      types.ts             # client-side DTOs (Task, Habit, Settings, ScheduledBlock, etc.)
      client.ts            # createApiClient({ baseUrl, getToken }) -> ApiClient; ApiError
      queries.ts           # query keys + thin TanStack Query hooks (used more in 5b–5d)
    auth/
      AuthContext.tsx      # token+userId state, signIn redirect, signOut; localStorage
      tokenStore.ts        # get/set/clear token in localStorage
      SignIn.tsx           # "Sign in with Google" -> GET /auth/google -> redirect
      AuthCallback.tsx     # parse URL fragment -> store token -> navigate '/'
    realtime/
      useWebSocket.ts      # open /ws?token=, invalidate query keys on ServerEvent
      events.ts            # ServerEvent type (client copy) + key-invalidation map
    test/
      setup.ts             # jest-dom matchers
      fakes.ts             # FakeApiClient, FakeWebSocket, renderWithProviders helper
    (test files colocated as *.test.tsx / *.test.ts)
```

## Dev serving (no CORS)

The Vite dev server (`:5173`) **proxies** `/auth`, `/tasks`, `/habits`, `/settings`,
`/schedule` (HTTP) and `/ws` (WebSocket) to the server (`:3000`), so the browser is
same-origin in dev and no server-side CORS is required. The API base URL comes from
`VITE_API_URL` (default `''` → same-origin via the proxy). Production static-serving
(server hosting the built assets, same-origin) is **deferred to go-live**.

## API client (`src/api/`)

`createApiClient({ baseUrl, getToken }): ApiClient` — a thin `fetch` wrapper that:
- sets `Authorization: Bearer <getToken()>` when a token exists, `Content-Type:
  application/json` for bodies;
- parses JSON; on non-2xx throws `ApiError { status, code, message }` built from the
  server's `{code, message}` body;
- exposes methods mirroring the endpoints: `getConsentUrl()`,
  `listTasks(status?)`, `createTask(body)`, `updateTask(id, patch)`, `deleteTask(id)`,
  `listHabits()`, `createHabit(body)`, `updateHabit(id, patch)`, `deleteHabit(id)`,
  `getSettings()`, `putSettings(body)`, `getSchedule(from?, to?)`,
  `getSchedulePreview()`, `replan()`.

DTO types (`types.ts`) are **hand-defined client-side** (decoupled from
`@notreclaim/db`/`server`, which must not enter the browser bundle). A `401` from any
call signals the auth layer to clear the token and redirect to `/signin`.

## Auth flow (`src/auth/`) + server change

Redirect-with-token, single-user:

1. **`/signin`** — "Sign in with Google" calls `GET /auth/google` → `{ url }` →
   `window.location.assign(url)`.
2. **Server change (`@notreclaim/server`, backward-compatible):** add a `WEB_CLIENT_URL`
   env to config. When set, `/auth/google/callback` (after `connectFromCode`)
   **302-redirects** to `${WEB_CLIENT_URL}/auth/callback#token=<jwt>&userId=<id>`.
   When unset, it returns the existing `{ token, userId }` JSON (so 4a behavior and
   tests are unchanged). The token travels in the URL **fragment** (not the query) so
   it is not sent to servers/logged. Gets its own route test.
3. **`/auth/callback`** — the client reads `window.location.hash`, stores
   `{ token, userId }` via `tokenStore`, and navigates to `/`.
4. **`AuthContext`** exposes `token`, `userId`, `signOut()`; **`ProtectedRoute`**
   redirects to `/signin` when there is no token. Since signing in *is* Google
   sign-in, the sidebar shows **"Connected"** whenever authenticated — no separate
   status endpoint in 5a.

## App shell + routing (`src/app/`)

`react-router-dom` routes: public `/signin` and `/auth/callback`; protected `/`
(Planner), `/tasks`, `/habits`, `/settings` (wrapped in `ProtectedRoute` + `AppShell`).
`AppShell` renders the left **`Sidebar`** (nav links with active state, connection
status, sign-out) and a routed content area. 5a ships **placeholder pages** (e.g.
"Planner — week view arrives in 5b") so the shell is fully navigable and testable;
5b–5d replace them.

## Realtime (`src/realtime/`)

`useWebSocket({ token, makeSocket? })` — opens `${wsBase}/ws?token=<token>` (default
`makeSocket = (url) => new WebSocket(url)`; injectable for tests). On each message it
parses a `ServerEvent` and invalidates TanStack Query keys via a small map:
- `schedule.updated` / `sync.completed` → invalidate `['schedule']` and
  `['schedule','preview']`;
- `task.changed` → invalidate `['tasks']` and `['schedule']`.

It reconnects with capped backoff on close, and is mounted only while authenticated
(inside the protected shell). The `ServerEvent` type is a client-side copy in
`events.ts`.

## Error handling

- API non-2xx → `ApiError`, surfaced through TanStack Query error states (UI in
  5b–5d; 5a placeholders just need the plumbing). `401` → clear token → `/signin`.
- WebSocket close → reconnect with capped backoff; failure is non-fatal (the app
  still works via manual refresh/queries).
- No token → protected routes redirect to `/signin`; the WS hook does not connect.
- Malformed auth-callback fragment (no token) → redirect to `/signin`.

## Testing (deterministic; jsdom; no real network or Google)

- **`renderWithProviders`** helper wraps components in a fresh `QueryClient`, a
  `MemoryRouter`, and an `AuthContext` seeded with a fake token, injecting a
  `FakeApiClient`.
- **AuthCallback:** a fragment with `token`/`userId` is stored and navigates to `/`;
  a missing token redirects to `/signin`.
- **ProtectedRoute:** unauthenticated → redirect to `/signin`; authenticated →
  renders the shell.
- **ApiClient:** attaches the bearer header when a token exists; omits it when not;
  maps a non-2xx `{code,message}` to `ApiError`; parses success JSON.
- **useWebSocket (FakeWebSocket):** each event type invalidates exactly the mapped
  query keys (spy on `queryClient.invalidateQueries`); reconnect scheduled on close.
- **Sidebar/AppShell:** renders the four nav links with active state; sign-out clears
  the token and redirects.
- **Server (`@notreclaim/server`):** the callback **302-redirects** to
  `${WEB_CLIENT_URL}/auth/callback#token=…&userId=…` when `WEB_CLIENT_URL` is set, and
  returns the JSON `{token,userId}` when it is not.
- Build/lint: `vite build` (or `tsc --noEmit`) is clean.

## Scope

5a is the foundation everything else builds on (scaffold + API client + auth + shell
+ realtime). It is cohesive enough for one implementation plan. The single
cross-package change is the small, backward-compatible auth-callback redirect in
`@notreclaim/server` (+ a `WEB_CLIENT_URL` config). Subsequent sub-milestones
(5b Planner, 5c Tasks/Habits, 5d Settings) each get their own spec → plan → build.
