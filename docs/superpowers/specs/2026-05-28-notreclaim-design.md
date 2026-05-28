# NotReclaim — Design Spec

**Date:** 2026-05-28
**Status:** Approved (ready for implementation planning)

## Summary

NotReclaim is a personal, self-hosted tool that replicates the core of Reclaim.ai:
it syncs the user's Google Calendar and automatically schedules flexible **tasks**
and **habits** into open time slots around fixed events. It is built as a
client–server system so a website (now) and standalone desktop/mobile apps (later)
can share one backend and stay in sync.

This is a single-user tool. The UI mirrors Reclaim's layout and interaction
patterns as an **original implementation** — no Reclaim code, logos, or assets.

## Goals

- Connect a single user's Google Calendar (OAuth via Google Sign-In).
- Auto-schedule flexible tasks and habits into free time, respecting working
  hours, priority, due dates, duration, and chunk-size constraints.
- Reflect scheduled blocks back into Google Calendar as real events.
- Re-plan automatically when the calendar or the task/habit set changes.
- Serve a Reclaim-style web UI; keep the API client-agnostic for future apps.

## Non-Goals (v1)

Defragmentation, buffer/travel time, smart 1:1s, scheduling links, analytics,
teams, billing, and the desktop/mobile apps themselves. The API is designed to
support those clients, but only the web client is built in v1.

## Architecture

```
┌─────────────┐   ┌──────────────┐   ┌───────────────┐
│  Web client │   │ Desktop app  │   │  Mobile app   │   (clients, share one API)
│ React+Vite  │   │  (later)     │   │   (later)     │
└──────┬──────┘   └──────┬───────┘   └──────┬────────┘
       └─────────────────┴──── HTTPS / WSS ──┴──────┐
                                                     ▼
                          ┌──────────────────────────────────────┐
                          │              Backend server            │
                          │  (TypeScript · Fastify · Postgres)     │
                          │                                        │
                          │  • Auth (Google Sign-In, JWT)          │
                          │  • REST API + WebSocket push           │
                          │  • Google Calendar sync worker         │
                          │  • Auto-scheduling engine              │
                          │  • Background job runner               │
                          └───────────────┬────────────────────────┘
                                          │ Google Calendar API v3
                                          ▼
                                   ┌──────────────┐
                                   │    Google    │
                                   └──────────────┘
```

The server is the single source of truth. Clients render state and issue
commands; the server schedules, syncs, and pushes updates over WebSocket so
every connected client stays live.

### Tech stack

- **Backend:** TypeScript (Node) · Fastify · Postgres · a background job runner.
- **Web client:** React + Vite + Tailwind.
- **Realtime:** WebSocket push.
- **Future clients:** Tauri (desktop) and/or React Native (mobile), reusing the API.
- Single language (TypeScript) across server and clients for solo maintainability.

## Data Model (v1)

All entities are scoped by `userId` (single user now, multi-user-capable later).

- **User** — Google identity, encrypted OAuth refresh token, timezone,
  working-hours settings.
- **CalendarEvent** — cached copy of *fixed* events synced from Google
  (meetings, etc.). Treated by the engine as immovable.
- **Task** — flexible to-do: title, priority, estimated duration, due date,
  min/max chunk size, category, status, time logged.
- **Habit** — recurring flexible block: title, chunk duration, frequency
  (e.g. 3×/week), preferred time-of-day window, priority, eligible days.
- **ScheduledBlock** — engine output: a concrete time slot bound to a Task or
  Habit. Mirrored to Google Calendar as a real event (stores `googleEventId`).
  Can be **pinned** (locked so the engine won't move it).
- **Settings** — working hours, planning horizon, default chunk sizes.

## Auto-Scheduling Engine (v1 core solver)

A **pure, deterministic function**:

```
schedule(fixedEvents, tasks, habits, settings, horizon) → ScheduledBlock[]
```

Pure = no DB or network inside; trivial to unit-test and reason about.

Algorithm (greedy, priority-ordered):

1. Build the **free/busy timeline** over the horizon (default 2 weeks) from
   working hours minus fixed events minus pinned blocks.
2. Sort flexible items by **priority, then due date** (most urgent first).
3. For each item, split its duration into chunks honoring **min/max chunk size**,
   and place each chunk in the **earliest feasible free slot** that fits before
   its due date.
4. **Habits:** ensure the required count per period lands inside the preferred
   time-of-day windows.
5. Items that can't fit before their deadline are returned as **unscheduled /
   "at risk"** — surfaced in the UI, never silently dropped.

**Re-run triggers:** Google Calendar changes, a task/habit added or edited,
manual refresh, or a periodic tick. Each re-run recomputes blocks for the
horizon and diffs against Google (create/update/delete events).

## Google Calendar Sync

- **Auth/connect:** Google Sign-In provides identity + Calendar scopes in one
  consent. Store the refresh token encrypted; mint short-lived access tokens.
- **Inbound (Google → us):** initial full sync within the horizon, then
  **incremental sync** via Google's `syncToken`. Register a **watch channel**
  (push webhook) for near-realtime; **fall back to polling** every few minutes
  when the webhook isn't reachable (e.g. local dev).
- **Outbound (us → Google):** scheduled blocks are written as real events,
  tagged for recognition, on a dedicated **"Auto-scheduled" calendar** (keeps
  the primary calendar clean and makes cleanup trivial).
- **Conflict rule:** if the user manually moves or deletes one of our blocks in
  Google, the next sync treats it as a **pin** (user wins); the engine won't
  fight it.

## API Surface

- **Auth:** `POST /auth/google` → JWT (identical for web/desktop/mobile).
- **REST CRUD:** `/tasks`, `/habits`, `/settings`, `/calendars`, `/schedule`
  (read current blocks, trigger manual re-plan).
- **WebSocket:** server pushes `schedule.updated`, `sync.completed`,
  `task.changed`; all open clients refresh live.

## UI — Reclaim-style Layout (original implementation)

- **Left sidebar:** nav — Planner (calendar), Tasks, Habits, Settings;
  calendar-connection status.
- **Center — week view:** main canvas. Fixed events and auto-scheduled blocks
  rendered together, **color-coded** (meetings vs tasks vs habits), with
  at-risk items flagged.
- **Right panel (context):** Tasks or Habits list for the current view —
  priority, due date, time remaining, quick-add.
- **Settings:** working hours, timezone, horizon, calendar connection, default
  chunk sizes.

Built with React + Tailwind, reproducing layout/interaction patterns only.

## Error Handling

- **Token refresh failures** → mark calendar "disconnected," prompt re-auth;
  never crash the sync worker.
- **Google rate limits / 5xx** → exponential backoff + retry; sync is idempotent
  (keyed on `syncToken` / event IDs).
- **Infeasible schedule** → item returned as unscheduled and surfaced in UI.
- **Re-plan failures** → keep the last good schedule; log and alert.

## Testing

- **Scheduling engine:** pure function → extensive **unit tests** (TDD).
  Deterministic fixtures: overlapping events, tight deadlines, chunking, habit
  frequency, infeasible cases.
- **Sync worker:** integration tests against a **mocked Google Calendar API**
  (inbound incremental sync, outbound write-back, conflict/pin handling).
- **API:** endpoint tests with an ephemeral Postgres.
- **Clients:** light component tests for the calendar/week view rendering.
