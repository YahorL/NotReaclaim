# Interactive Calendar (Review 1, Milestone B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-move (within a day) and bottom-edge-resize committed task/habit blocks on the Planner grid; on release the block is pinned (locked) at its new time and the rest of the schedule reflows.

**Architecture:** Backend `PATCH /schedule/:id` (update times/pinned + run the existing re-plan hook). Web: an `ApiClient.updateScheduledBlock` + query mutation; pure inverse geometry in `weekModel` (the day column is a fixed `16×58=928px`, so px↔min is a known constant); an `InteractiveBlock` pointer wrapper for task/habit blocks. Engine + DB unchanged (pinned blocks already honored).

**Tech Stack:** Fastify + zod + Prisma/Postgres (server/db); React 18 + Vite + Tailwind + TanStack Query (web); Vitest.

**Conventions:** backend explicit `.js` import extensions; web EXTENSIONLESS + never `import React` (`useState`, `type PointerEvent` from 'react' OK); Tailwind literal classes (dynamic px via inline `style` is the sanctioned exception); DI + injected `now`; `@notreclaim/db` tests hit Postgres (start userspace pg if needed: `/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start`). Per-task run: `npm test -w <pkg> -- <path>`. Stage only listed files; never `seed-dev.mjs`/`.env.run`/`design_handoff_notreclaim`/`review`/`.claude`.

---

## Task 1: Backend `PATCH /schedule/:id` + reflow

**Files:** `packages/server/src/schemas.ts`, `packages/server/src/schedule-routes.ts`, `packages/server/src/app.ts`, `packages/server/test/fakes.ts`, `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Add the zod schema to `packages/server/src/schemas.ts`** (append):

```ts
export const updateScheduledBlockSchema = z
  .object({
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((b) => !(b.startsAt && b.endsAt) || Date.parse(b.startsAt) < Date.parse(b.endsAt), {
    message: 'startsAt must be before endsAt',
  });
```

- [ ] **Step 2: Widen the repo surface in `packages/server/src/app.ts`.** Change the `scheduledBlocks` line in `AppDeps.repos` from:

```ts
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
```
to:
```ts
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update'>;
```
And change the schedule-routes registration to pass the after-mutation hook — from `registerScheduleRoutes(app, deps);` to:
```ts
  registerScheduleRoutes(app, deps, afterMutation);
```
(`afterMutation` is already defined above in `buildApp` and passed to the task/habit/settings registrars.)

- [ ] **Step 3: Add the route in `packages/server/src/schedule-routes.ts`.** Update the imports + signature + add the PATCH handler:

```ts
import type { FastifyInstance } from 'fastify';
import { computeDesiredSchedule } from '@notreclaim/core';
import type { AppDeps, AfterMutation } from './app.js';
import { rangeQuerySchema, idParamSchema, updateScheduledBlockSchema } from './schemas.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerScheduleRoutes(app: FastifyInstance, deps: AppDeps, afterMutation: AfterMutation): void {
  const guard = { onRequest: [app.authenticate] };

  app.get('/schedule', guard, async (request) => {
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
    return deps.repos.scheduledBlocks.listByUserInRange(request.userId, start, end);
  });

  app.get('/schedule/preview', guard, async (request) => {
    return computeDesiredSchedule(deps.schedulingRepos, request.userId, deps.now());
  });

  app.post('/schedule/replan', guard, async (request) => {
    return deps.reconcile(request.userId, deps.now());
  });

  app.patch('/schedule/:id', guard, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = updateScheduledBlockSchema.parse(request.body);
    const data = {
      ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
      ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    };
    const block = await deps.repos.scheduledBlocks.update(request.userId, id, data);
    afterMutation(request.userId);
    return block;
  });
}
```

- [ ] **Step 4: Extend the fake in `packages/server/test/fakes.ts`.** Replace `fakeScheduledBlockRepo` with a mutable version that also supports `update`:

```ts
export function fakeScheduledBlockRepo(seed: ScheduledBlock[] = []) {
  const rows = [...seed];
  return {
    async listByUserInRange(userId: string, start: Date, end: Date): Promise<ScheduledBlock[]> {
      return rows.filter((b) => b.userId === userId && b.startsAt < end && b.endsAt > start);
    },
    async update(userId: string, id: string, data: Partial<ScheduledBlock>): Promise<ScheduledBlock> {
      const row = rows.find((b) => b.id === id && b.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`ScheduledBlock ${id}`); }
      Object.assign(row, data); return row;
    },
  };
}
```
(The `buildTestApp` wiring already passes `scheduledBlocks` for both `repos` and `schedulingRepos`; the added `update` method satisfies the widened `AppDeps` surface.)

- [ ] **Step 5: Write the failing route tests — add to `packages/server/test/schedule.test.ts`** (inside `describe('schedule routes', …)`):

```ts
  it('PATCH /schedule/:id updates times+pinned, returns the block, and triggers a re-plan', async () => {
    const { app, emitted } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/b1',
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z', pinned: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pinned).toBe(true);
    expect(res.json().startsAt).toBe('2026-01-05T11:00:00.000Z');
    expect(emitted.some((e) => e.type === 'schedule.updated')).toBe(true);
  });

  it('PATCH /schedule/:id returns 404 for a block the user does not own', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/does-not-exist',
      headers: { authorization: `Bearer ${token}` },
      payload: { pinned: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /schedule/:id rejects startsAt >= endsAt with 400', async () => {
    const { app } = buildTestApp({ blocks: [block()], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PATCH', url: '/schedule/b1',
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-01-05T12:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 6: Run + verify.** `npm test -w @notreclaim/server -- test/schedule.test.ts` (PATCH tests fail first → implement Steps 1–4 → pass). Then `npm test -w @notreclaim/server` (all pass) and `npm run build -w @notreclaim/server` (clean). (The `block()`/`settings()` factories already exist in schedule.test.ts; `block()` has id `b1`, userId `u1`, engineKey `task:t1:0`.)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/schemas.ts packages/server/src/schedule-routes.ts packages/server/src/app.ts packages/server/test/fakes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): PATCH /schedule/:id to move/pin a block + reflow"
```

---

## Task 2: Web ApiClient method + query mutation

**Files:** `packages/web/src/api/types.ts`, `packages/web/src/api/client.ts`, `packages/web/src/test/fakes.tsx`, `packages/web/src/api/queries.ts`, `packages/web/src/api/client.test.ts`, `packages/web/src/api/queries.test.tsx`

- [ ] **Step 1: Add the input type to `packages/web/src/api/types.ts`** (near the other `Update*Input`s):

```ts
export interface UpdateScheduledBlockInput {
  startsAt?: string;
  endsAt?: string;
  pinned?: boolean;
}
```

- [ ] **Step 2: Add to `packages/web/src/api/client.ts`.** Import the type (add `UpdateScheduledBlockInput` to the existing `./types` import), add to the `ApiClient` interface (after `getSchedule`):

```ts
  updateScheduledBlock(id: string, patch: UpdateScheduledBlockInput): Promise<ScheduledBlock>;
```
and to the returned object in `createApiClient` (after `getSchedule`):
```ts
    updateScheduledBlock: (id, patch) => request('PATCH', `/schedule/${id}`, patch),
```

- [ ] **Step 3: Add to the fake base in `packages/web/src/test/fakes.tsx`.** In `fakeApiClient`'s `base`, add a line alongside the other `notImplemented(...)` entries:

```ts
    updateScheduledBlock: notImplemented('updateScheduledBlock'),
```

- [ ] **Step 4: Add the mutation hook to `packages/web/src/api/queries.ts`.** Import `UpdateScheduledBlockInput` (add to the existing `./types` type import) and add:

```ts
export function useUpdateScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateScheduledBlockInput }) => api.updateScheduledBlock(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}
```

- [ ] **Step 5: Add focused tests.**
  - In `packages/web/src/api/client.test.ts`, add a case asserting `updateScheduledBlock('b1', { pinned: true })` issues a `PATCH` to `/schedule/b1` with the JSON body (follow the file's existing fetch-mock pattern; mirror an existing `updateTask`/PATCH test).
  - In `packages/web/src/api/queries.test.tsx`, add a test that `useUpdateScheduledBlockMutation` calls `api.updateScheduledBlock` and invalidates the `['schedule']` root (follow the existing mutation-hook test pattern in that file, e.g. how `useUpdateTaskMutation` is tested).

- [ ] **Step 6: Run + verify.** `npm test -w @notreclaim/web -- src/api/client.test.ts src/api/queries.test.tsx` (PASS), `npm test -w @notreclaim/web` (all pass), `npm run build -w @notreclaim/web` (clean).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/api/client.ts packages/web/src/test/fakes.tsx packages/web/src/api/queries.ts packages/web/src/api/client.test.ts packages/web/src/api/queries.test.tsx
git commit -m "feat(web): updateScheduledBlock API client + useUpdateScheduledBlockMutation"
```

---

## Task 3: Pure inverse geometry in `weekModel`

**Files:** `packages/web/src/app/planner/weekModel.ts`, `packages/web/src/app/planner/weekModel.test.ts`

- [ ] **Step 1: Write failing tests — add to `packages/web/src/app/planner/weekModel.test.ts`:**

```ts
import { HOUR_ROW_PX, GRID_COLUMN_PX, snapMinutes, pxToMinutes, clampToWindow, WINDOW_START_MIN, WINDOW_END_MIN } from './weekModel';

describe('grid geometry', () => {
  it('exports the fixed column geometry constants', () => {
    expect(HOUR_ROW_PX).toBe(58);
    expect(GRID_COLUMN_PX).toBe(((WINDOW_END_MIN - WINDOW_START_MIN) / 60) * 58); // 16 * 58 = 928
  });

  it('snapMinutes rounds to the nearest step (default 15)', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
    expect(snapMinutes(52, 30)).toBe(60);
  });

  it('pxToMinutes maps the column height to the full window span', () => {
    expect(pxToMinutes(GRID_COLUMN_PX)).toBe(WINDOW_END_MIN - WINDOW_START_MIN); // 928px -> 960 min
    expect(Math.round(pxToMinutes(HOUR_ROW_PX))).toBe(60); // one row -> 60 min
    expect(pxToMinutes(0)).toBe(0);
    expect(pxToMinutes(-GRID_COLUMN_PX)).toBe(-(WINDOW_END_MIN - WINDOW_START_MIN));
  });

  it('clampToWindow floors start at the window start and shifts back on overflow', () => {
    expect(clampToWindow(540, 60)).toEqual({ startMin: 540, endMin: 600 });
    expect(clampToWindow(300, 60)).toEqual({ startMin: WINDOW_START_MIN, endMin: WINDOW_START_MIN + 60 }); // before window -> floored
    expect(clampToWindow(1290, 60)).toEqual({ startMin: WINDOW_END_MIN - 60, endMin: WINDOW_END_MIN }); // would overflow -> shifted back
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`

- [ ] **Step 3: Implement in `packages/web/src/app/planner/weekModel.ts`** (append; `WINDOW_START_MIN`/`WINDOW_END_MIN`/`MS_PER_MIN` already exist at the top):

```ts
/** One hour = 58px tall in the grid body (must match WeekGrid's h-[58px] rows). */
export const HOUR_ROW_PX = 58;
/** Fixed day-column pixel height: one 58px row per hour of the window (16 * 58 = 928). */
export const GRID_COLUMN_PX = ((WINDOW_END_MIN - WINDOW_START_MIN) / 60) * HOUR_ROW_PX;

/** Round a minute value to the nearest `step` (default 15). */
export function snapMinutes(min: number, step = 15): number {
  return Math.round(min / step) * step;
}

/** Convert a signed pixel delta within a day column to a signed minute delta. */
export function pxToMinutes(px: number): number {
  return (px / GRID_COLUMN_PX) * (WINDOW_END_MIN - WINDOW_START_MIN);
}

/** Keep [startMin, startMin+durationMin] inside the [WINDOW_START_MIN, WINDOW_END_MIN] window. */
export function clampToWindow(startMin: number, durationMin: number): { startMin: number; endMin: number } {
  let s = Math.max(WINDOW_START_MIN, startMin);
  if (s + durationMin > WINDOW_END_MIN) s = WINDOW_END_MIN - durationMin;
  s = Math.max(WINDOW_START_MIN, s);
  return { startMin: s, endMin: s + durationMin };
}
```

- [ ] **Step 4: Run → PASS.** `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`, then `npm test -w @notreclaim/web` (all pass), `npm run build -w @notreclaim/web` (clean).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): weekModel inverse geometry (snapMinutes/pxToMinutes/clampToWindow + column constants)"
```

---

## Task 4: `InteractiveBlock` + WeekGrid/Planner wiring

**Files:** `packages/web/src/app/planner/EventBlock.tsx` (export its class helpers), `packages/web/src/app/planner/InteractiveBlock.tsx` (new) + `InteractiveBlock.test.tsx` (new), `packages/web/src/app/planner/WeekGrid.tsx`, `packages/web/src/app/pages/Planner.tsx`

- [ ] **Step 1: Export the class helpers from `packages/web/src/app/planner/EventBlock.tsx`.** Add `export` to the existing `BASE` const and `variantClass` function (no other change):

```ts
export const BASE = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';

/** Color by state, Google-Calendar-style: meeting=blue, locked task/habit=green+lock, movable=transparent dashed green. */
export function variantClass(kind: BlockKind, pinned: boolean): string {
  if (kind === 'meeting') return 'bg-event text-white';
  if (pinned) return 'bg-low text-white';
  // movable: text-kind-habitText (#1c7a43) is an accessible dark green on the transparent bg (used for task & habit alike)
  return 'border border-dashed border-low bg-transparent text-kind-habitText';
}
```

- [ ] **Step 2: Write the failing test `packages/web/src/app/planner/InteractiveBlock.test.tsx`:**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InteractiveBlock } from './InteractiveBlock';
import { GRID_COLUMN_PX } from './weekModel';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight (TZ=UTC)
const START = Date.parse('2026-01-05T09:00:00.000Z');
const END = Date.parse('2026-01-05T10:00:00.000Z');
// +60 minutes worth of pixels: 60/960 of the column.
const PX_PER_60MIN = (60 / 960) * GRID_COLUMN_PX; // = HOUR_ROW_PX = 58

function renderBlock(onCommit = vi.fn()) {
  render(
    <InteractiveBlock
      id="b1" dayStartMs={DAY} startMs={START} endMs={END}
      topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
      onCommit={onCommit}
    />,
  );
  return onCommit;
}

describe('InteractiveBlock', () => {
  it('renders an event-block with kind/pinned and a resize handle', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'task');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
  });

  it('moving the body down by 60 min commits a new start/end and pins', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('resizing the bottom handle down by 60 min extends the end and pins, start unchanged', () => {
    const onCommit = renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('a zero-delta click commits nothing', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → FAIL (module not found).** `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx`

- [ ] **Step 4: Implement `packages/web/src/app/planner/InteractiveBlock.tsx`:**

```tsx
import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_START_MIN, WINDOW_END_MIN, snapMinutes, pxToMinutes, clampToWindow } from './weekModel';

const MIN_DURATION_MIN = 15;
const iso = (ms: number): string => new Date(ms).toISOString();

export interface InteractiveBlockProps {
  id: string;
  dayStartMs: number;
  startMs: number;
  endMs: number;
  topPct: number;
  heightPct: number;
  startLabel: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  onCommit: (patch: { startsAt: string; endsAt: string; pinned: boolean }) => void;
}

type Drag = { mode: 'move' | 'resize'; startY: number; offsetPx: number };

export function InteractiveBlock(props: InteractiveBlockProps) {
  // `id` is part of the props for the parent's onCommit binding; not read inside this component.
  const { dayStartMs, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const locked = pinned;

  const begin = (mode: Drag['mode']) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    }
    setDrag({ mode, startY: e.clientY, offsetPx: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    setDrag((d) => (d ? { ...d, offsetPx: e.clientY - d.startY } : d));
  };

  const onPointerUp = () => {
    if (!drag) return;
    const deltaMin = snapMinutes(pxToMinutes(drag.offsetPx));
    setDrag(null);
    if (deltaMin === 0) return;
    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;
    if (drag.mode === 'move') {
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      onCommit({ startsAt: iso(dayStartMs + moved.startMin * 60_000), endsAt: iso(dayStartMs + moved.endMin * 60_000), pinned: true });
    } else {
      const newEndMin = Math.min(WINDOW_END_MIN, Math.max(startMin + MIN_DURATION_MIN, endMin + deltaMin));
      if (newEndMin === endMin) return;
      onCommit({ startsAt: iso(startMs), endsAt: iso(dayStartMs + newEndMin * 60_000), pinned: true });
    }
  };

  const movePx = drag?.mode === 'move' ? drag.offsetPx : 0;
  const growPx = drag?.mode === 'resize' ? drag.offsetPx : 0;

  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`${BASE} cursor-grab select-none ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%`, transform: `translateY(${movePx}px)`, marginBottom: `${-growPx}px` }}
    >
      {locked && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
    </div>
  );
}
```

Notes: the inline `style` carries the dynamic positioning (top/height %) and the live drag preview (`translateY` for move, a negative `marginBottom` to fake the height growth for resize) — these are the sanctioned dynamic-style use. The resize handle stops propagation so a handle-press starts `resize`, not `move`. `id` is in the props interface (WeekGrid binds `onCommit` to it) but isn't destructured/read inside the component, so there's no unused-var.

- [ ] **Step 5: Run → PASS (4 tests).** `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx`

(Verification of the move math: column 928px ↔ 960min; +58px → `pxToMinutes(58)=60` → `snapMinutes(60)=60`. Block 09:00–10:00 → start-min 540, dur 60 → moved {600,660} → 10:00–11:00. ✓ Resize: end-min 600 +60 → 660 → 11:00, start unchanged 09:00. ✓)

- [ ] **Step 6: Wire `WeekGrid` to render task/habit via `InteractiveBlock`.** In `packages/web/src/app/planner/WeekGrid.tsx`:
  - Import: `import { InteractiveBlock } from './InteractiveBlock';`
  - Add to `Item`: a `blockId: string | null` field. In `toItems`, set `blockId: b.id` for `fromBlocks` and `blockId: null` for `fromEvents`.
  - Add to `WeekGridProps`: `onCommit: (id: string, patch: { startsAt: string; endsAt: string; pinned: boolean }) => void;` and destructure it.
  - In the day-column render, replace the single `<EventBlock …/>` with a branch:
    ```tsx
    {dayItems.map((it) => {
      const pos = placeInDay(it.startMs, it.endMs, d);
      if (!pos) return null;
      if (it.kind !== 'meeting' && it.blockId) {
        return (
          <InteractiveBlock
            key={it.key} id={it.blockId} dayStartMs={d}
            startMs={it.startMs} endMs={it.endMs}
            topPct={pos.topPct} heightPct={pos.heightPct}
            startLabel={it.startLabel} title={it.title} kind={it.kind} pinned={it.pinned}
            onCommit={(patch) => onCommit(it.blockId as string, patch)}
          />
        );
      }
      return (
        <EventBlock
          key={it.key} title={it.title} kind={it.kind} pinned={it.pinned}
          topPct={pos.topPct} heightPct={pos.heightPct} startLabel={it.startLabel}
        />
      );
    })}
    ```
  (Everything else in WeekGrid — header, legend, day-headers, now-line, HOURS rows `h-[58px]` — unchanged. Leave the `h-[58px]` literal; it must equal `HOUR_ROW_PX`.)

- [ ] **Step 7: Update `WeekGrid.test.tsx`** — the `renderGrid` helper must supply the new required `onCommit`. Add `onCommit={vi.fn()}` to the `<WeekGrid …>` in `renderGrid`. The existing "places a meeting and a task block" test still passes (the task block now renders via `InteractiveBlock`, which also sets `data-testid="event-block"` + `data-kind="task"`). No other test changes.

- [ ] **Step 8: Wire `Planner.tsx`** to pass the mutation as `onCommit`. Add the hook + prop:
  - Import `useUpdateScheduledBlockMutation` (add to the existing `../../api/queries` import).
  - In the component: `const updateBlock = useUpdateScheduledBlockMutation();`
  - On `<WeekGrid>`, add: `onCommit={(id, patch) => updateBlock.mutate({ id, patch })}`.
  (No other Planner change.)

- [ ] **Step 9: Update `Planner.test.tsx`** — `makeApi` should stub the new client method so the mutation has something to call if exercised. Add `updateScheduledBlock: vi.fn(async () => blocks[0])` to the `makeApi` overrides object (alongside `getSchedule`/etc.). Existing tests still pass (they don't drag); this just prevents an unimplemented-fake rejection if any interaction path runs. (No new Planner test required for the drag — the interaction is covered by `InteractiveBlock.test.tsx`.)

- [ ] **Step 10: Run + verify.** `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx src/app/planner/InteractiveBlock.test.tsx` (PASS), then `npm test -w @notreclaim/web` (all pass), `npm run build -w @notreclaim/web` (clean).

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx \
  packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx \
  packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): drag-move + resize task/habit blocks (InteractiveBlock) → pin + reflow"
```

---

## Task 5: full verification

- [ ] **Step 1: Run the whole monorepo suite + web build** (Postgres up for db):

```bash
npm test -w @notreclaim/scheduler
npm test -w @notreclaim/core
npm test -w @notreclaim/google
npm test -w @notreclaim/db
npm test -w @notreclaim/server
npm test -w @notreclaim/web
npm run build -w @notreclaim/web
```
Expected: all PASS, build clean. Report per-package counts.

---

## Notes for the implementer
- Engine/DB unchanged — `pinned` blocks are already honored by `assembleScheduleInput` + skipped by `applyDesiredSchedule`; the route just sets pinned + reflows via the existing hook.
- Tailwind: do NOT templatize `h-[58px]` (JIT needs literal); the `HOUR_ROW_PX` constant documents the coupling.
- Inline `style` in `InteractiveBlock` is the sanctioned dynamic-px exception (positioning + drag preview).
- `setPointerCapture` is guarded for jsdom.
- Stage only the files listed per task.
