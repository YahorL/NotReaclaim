# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working principles

1. **Ask, don't assume.** If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.
2. **Match the solution to the problem.** Simplest solution for simple problems, better solutions for harder problems. Don't over-engineer or add flexibility that isn't needed yet.
3. **Stay in your lane, but speak up.** Don't touch unrelated code — but do surface bad code or design smells you discover so we can address them as a separate issue.
4. **Flag uncertainty explicitly.** If you're unsure, see #1. Where it makes sense, run a small, localised, low-risk experiment and bring the hypothesis and results back to discuss. Confidence without certainty causes more damage than admitting a gap.
5. **Suggest better ways.** Don't hesitate to propose a better approach — especially one with long-lasting impact over a tactical fix.

## Orchestration model

The main session runs on Fable and is used **only to orchestrate**: understand the request, plan, dispatch, and review results. Do all actual work — code exploration, implementation, tests, reviews — through subagents run on Opus (Agent tool with `model: "opus"`). Don't edit code or run long investigations directly in the main session; keep it as the coordinator. Subagent prompts must forbid branch-switching git commands (a review subagent once derailed onto `main` with `git checkout`).

## What this is

NotReclaim — a self-hosted Reclaim.ai-style auto-scheduler. Tasks/habits are auto-placed into free calendar time around fixed events and working hours; optionally two-way synced with Google Calendar. npm-workspaces monorepo, ESM throughout, strict TypeScript.

## Commands

```sh
npm run build                     # build all workspaces (tsc; web also vite build)
npm test                          # all workspace test suites (vitest)
npm test -w @notreclaim/web       # one package
npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx   # one file
npm run test:watch -w @notreclaim/core                          # watch mode
```

- Web tests must run with `TZ=UTC` (the `test` script already sets it — don't bypass it).
- `@notreclaim/db` tests are integration tests against a real Postgres: copy `packages/db/.env.test.example` → `.env.test` and point `TEST_DATABASE_URL` at a local database. Everything else mocks the repo layer and needs no DB.
- Prisma (run from `packages/db/`, reads `packages/db/.env`): `npm run prisma:migrate` (dev, creates migration), `npm run prisma:deploy` (apply), `npm run prisma:generate`.

### Running the app locally

```sh
npm run dev -w @notreclaim/web    # Vite on :5173, proxies API routes + /ws to :3000
# API (no dev script — build first, then run dist with env from .env.run):
npm run build
set -a && . ./.env.run && set +a && node packages/server/dist/server.js
node --env-file=.env.run seed-dev.mjs   # prints a demo-user AUTHURL to log in without Google
npm run admin -w @notreclaim/server -- create-user --email x@y --password p [--admin]
```

After changing backend code, rebuild and restart the server (it runs from `dist/`). Restart Vite before browser-verifying frontend changes — stale Vite state has caused false "bug not fixed" reports. Note the Vite proxy maps by path prefix (`/tasks`, `/schedule`, `/settings`, …), so a full-page load of an app route like `/settings` in dev hits the API proxy — navigate client-side from `/`.

## Architecture

Dependency chain: `scheduler` ← `db` ← `core` ← `google` ← `server`; `web` talks to `server` over HTTP + WebSocket. Packages import each other's built `dist/` via workspace symlinks, so cross-package changes need a rebuild of the dependency.

- **`packages/scheduler`** — pure scheduling engine, zero dependencies. Interval math (`intervals.ts`), chunk placement (`placement.ts`), priority-ordered task/habit scheduling (`schedule.ts`). Operates on plain ms-epoch numbers.
- **`packages/db`** — Prisma schema/migrations, factory-function repositories (`createTaskRepository(prisma)` etc.), and `mappers.ts` converting DB rows → engine types. Domain models: User, Settings (working hours, timezone, horizon), Task (+Subtask, sortOrder, status pending/scheduled/done/backlog), Habit, Category, ScheduledBlock (`origin: auto|pinned`, `startedAt`), CalendarEvent, InviteCode.
- **`packages/core`** — glue between db and scheduler. `assembleScheduleInput` reads repos and builds engine input: expands working hours per timezone (`time-windows.ts`, luxon), expands habits, subtracts spent time (`computeSpentMs` = Σ finished blocks; tasks with a started block are excluded from auto-scheduling — user-managed). `computeDesiredSchedule` runs the engine; `applyDesiredSchedule`/`planLocally` diff desired vs stored blocks and persist. Pure modules take `now` as a parameter (DI) — no `Date.now()` inside.
- **`packages/google`** — OAuth client, refresh-token encryption at rest (`ENCRYPTION_KEY`), inbound calendar sync, outbound writeback of blocks, and `reconcile` = sync + plan + writeback.
- **`packages/server`** — Fastify + `@fastify/jwt` + WebSocket. Route modules per resource (`task-routes.ts`, `schedule-routes.ts`, …), zod schemas in `schemas.ts`. Auth: email+password (argon2) and/or linkable Google OAuth; `REGISTRATION_MODE=closed|invite|open`. **Replan flow is the heart of the app**: every mutation calls `replanAfterMutation` → `makeReplan` picks Google `reconcile` (if connected) or `planLocally` → event bus emits `schedule.updated` → pushed to clients over `/ws`. A poll timer (`POLL_INTERVAL_MS`) additionally pulls external calendar changes per user. Admin CLI in `scripts/admin.mjs`.
- **`packages/web`** — React 18 + Vite + Tailwind v3 + TanStack Query. `src/api/` (client, query hooks), `src/app/pages/` (Planner, Priorities, Habits, Stats, Settings, Buffers, Hours), `src/app/planner/` (the interactive week grid: `weekModel.ts` zone-aware day/geometry math, `WeekGrid`, `InteractiveBlock` drag/resize, `overlapLayout.ts` side-by-side lanes, `CreatePopover`, `PlannerTaskPanel`), `src/realtime/` WS invalidation. All times render in `settings.timezone` (luxon), not the browser zone.

Design specs for every feature/review round live in `docs/superpowers/specs/`; deployment runbooks (Docker Compose, Tailscale Serve, Google OAuth, pull-based auto-deploy) in `docs/deploy/`.

## Conventions

- Backend packages use explicit `.js` extensions on relative imports (ESM). `packages/web` imports are extensionless and never `import React` (automatic JSX runtime; named hook imports are fine).
- Tailwind v3: literal utility class strings only (JIT can't see computed names).
- Repositories are factory functions over a shared `prisma` instance; server/core code depends on narrow repo interfaces (`Pick<...>`) for testability.
- Frontend drag-and-drop: **list / cross-container DnD uses dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`; shared sensors and collision strategy in `packages/web/src/app/dnd/sensors.ts` — `MouseSensor` 4px + `TouchSensor` 250ms/8px + `KeyboardSensor`). **Continuous geometric drag (planner blocks) uses raw pointer events** (`InteractiveBlock`). Drop decisions live in pure modules (`boardDnd.ts`, `subtaskDnd.ts`, `scheduleDrop.ts`) because jsdom cannot drive a real gesture — component tests assert wiring, gestures are verified live.
- Do not commit local-only files: `seed-dev.mjs`, `.env.run`, `packages/db/.env*`, `design_handoff_notreclaim/`, `review/`.
- This dev machine has no sudo: Node lives in `~/.local`, and Postgres is a userspace cluster.
