# Planner Proposed-Schedule Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the engine's proposed `/schedule/preview` blocks on the Planner week-grid as distinct dashed "ghost" blocks, behind a toolbar "Proposed" toggle (default on), so auto-scheduling is visible without a Google-connected reconcile.

**Architecture:** `EventBlock` gains a `proposed` ghost variant (dashed/translucent). `WeekGrid` takes an optional `proposed: PreviewBlock[]` prop, owns a local `showProposed` toggle (default on), maps proposed blocks into its `Item` list (numeric ms → `placeInDay` directly), and renders them through `EventBlock`. `Planner` passes the already-fetched `preview.data.blocks`. No backend or query change.

**Tech Stack:** React 18 + Vite + TS strict + TanStack Query v5; Vitest + @testing-library/react + jsdom. Web imports EXTENSIONLESS; never `import React` (jsx:react-jsx; `useState` from `react` OK). Tests under `TZ=UTC`; `build` (`tsc -p tsconfig.json && vite build`) typechecks tests.

**Conventions reminder:** `proposed` is an **optional** prop defaulting to `[]` so existing `WeekGrid`/`Planner` tests keep compiling unchanged. Tests use `fakeApiClient` + `renderWithProviders` from `src/test/fakes.tsx`.

---

## File Structure

- `src/app/planner/EventBlock.tsx` (modify) + `EventBlock.test.tsx` (extend) — `proposed` ghost variant.
- `src/app/planner/WeekGrid.tsx` (modify) + `WeekGrid.test.tsx` (extend) — proposed prop + toggle + rendering.
- `src/app/pages/Planner.tsx` (modify, one line) + `Planner.test.tsx` (extend) — pass `proposed`.

---

## Task 1: `EventBlock` proposed ghost variant

**Files:**
- Modify: `packages/web/src/app/planner/EventBlock.tsx`
- Modify: `packages/web/src/app/planner/EventBlock.test.tsx`

- [ ] **Step 1: Add failing tests to `EventBlock.test.tsx`**

Add inside the existing `describe('EventBlock', ...)` block:

```tsx
  it('renders a proposed block as a dashed ghost', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={10} heightPct={5} startLabel="13:00" proposed />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'true');
    expect(el).toHaveAttribute('data-kind', 'task');
    expect(el.className).toContain('border-dashed');
  });

  it('a committed block is solid (data-proposed false, no dashed border)', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'false');
    expect(el.className).not.toContain('border-dashed');
    expect(el.className).toContain('text-white');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: FAIL — `EventBlock` has no `proposed` prop / no `data-proposed` attribute.

- [ ] **Step 3: Update `src/app/planner/EventBlock.tsx`**

```tsx
export type BlockKind = 'meeting' | 'task' | 'habit';

const KIND_BG: Record<BlockKind, string> = {
  meeting: 'bg-slate-400',
  task: 'bg-blue-500',
  habit: 'bg-green-500',
};

const KIND_PROPOSED: Record<BlockKind, string> = {
  meeting: 'border border-dashed border-slate-400 bg-slate-400/20 text-slate-700',
  task: 'border border-dashed border-blue-400 bg-blue-500/20 text-blue-800',
  habit: 'border border-dashed border-green-400 bg-green-500/20 text-green-800',
};

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
  proposed?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false, proposed = false }: EventBlockProps) {
  const base = 'absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight';
  const variant = proposed ? KIND_PROPOSED[kind] : `text-white ${KIND_BG[kind]}`;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      data-proposed={proposed}
      title={`${startLabel} ${title}`}
      className={`${base} ${variant}`}
      style={{
        top: `${topPct}%`,
        height: `${heightPct}%`,
        boxShadow: pinned && !proposed ? 'inset 3px 0 0 #f59e0b' : undefined,
      }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: PASS (the existing tests + the two new ones). The existing committed-block tests still pass because `proposed` defaults to `false` (unchanged solid styling + pinned amber bar).

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/EventBlock.test.tsx
git commit -m "feat(web): EventBlock proposed ghost variant (dashed/translucent)"
```

---

## Task 2: `WeekGrid` proposed rendering + toggle

**Files:**
- Modify: `packages/web/src/app/planner/WeekGrid.tsx`
- Modify: `packages/web/src/app/planner/WeekGrid.test.tsx`

- [ ] **Step 1: Add failing tests to `WeekGrid.test.tsx`**

Add `PreviewBlock` to the `../../api/types` import, then add inside the existing `describe('WeekGrid', ...)`:

```tsx
  it('renders proposed blocks as ghosts by default and the toggle hides them', () => {
    const proposed: PreviewBlock[] = [
      { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'Proposed focus',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
    ];
    renderGrid({ proposed });
    const ghosts = () => screen.getAllByTestId('event-block').filter((b) => b.getAttribute('data-proposed') === 'true');
    expect(ghosts().some((b) => b.textContent?.includes('Proposed focus'))).toBe(true);

    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.queryByText('Proposed focus')).toBeNull();
    // committed blocks (data-proposed false) remain
    expect(screen.getAllByTestId('event-block').some((b) => b.getAttribute('data-proposed') === 'false')).toBe(true);

    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.getByText('Proposed focus')).toBeInTheDocument();
  });
```

(`renderGrid` already supplies `blocks: [block()]` and `events: [event()]`, so committed blocks are present. The new `proposed` key is accepted because `renderGrid` takes `Partial<WeekGridProps>` and the prop is optional.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`
Expected: FAIL — no `proposed` prop / no `toggle-proposed` button.

- [ ] **Step 3: Update `src/app/planner/WeekGrid.tsx`**

Change the imports (lines 1-3) and add `useState`:

```tsx
import { useState } from 'react';
import type { ScheduledBlock, CalendarEvent, PreviewBlock } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY } from './weekModel';
```

Add `proposed?` to the props and `proposed: boolean` to `Item`:

```tsx
export interface WeekGridProps {
  days: number[];
  nowMs: number;
  weekLabel: string;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  proposed?: PreviewBlock[];
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
  proposed: boolean;
  startMs: number;
  endMs: number;
  startLabel: string;
}
```

Replace `toItems` to set `proposed: false` on committed/meeting items and add proposed mapping:

```tsx
function toItems(blocks: ScheduledBlock[], events: CalendarEvent[], proposed: PreviewBlock[]): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned, proposed: false,
      startMs, endMs: Date.parse(b.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: 'meeting', pinned: false, proposed: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromProposed = proposed.map((b): Item => ({
    key: `p:${b.id}`, title: b.title, kind: b.sourceType, pinned: false, proposed: true,
    startMs: b.start, endMs: b.end, startLabel: timeLabel(b.start),
  }));
  return [...fromEvents, ...fromBlocks, ...fromProposed];
}
```

In the component, destructure `proposed = []`, add the toggle state, gate proposed inclusion, add the toolbar button, and pass `proposed` to `EventBlock`:

```tsx
export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, proposed = [], replanPending, onPrev, onToday, onNext, onReplan } = props;
  const [showProposed, setShowProposed] = useState(true);
  const items = toItems(blocks, events, showProposed ? proposed : []);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onPrev} className="rounded border border-gray-300 px-2 py-0.5">◀</button>
        <button onClick={onToday} className="rounded border border-gray-300 px-2 py-0.5">Today</button>
        <button onClick={onNext} className="rounded border border-gray-300 px-2 py-0.5">▶</button>
        <span className="font-semibold">{weekLabel}</span>
        <span className="flex-1" />
        <button
          data-testid="toggle-proposed"
          aria-pressed={showProposed}
          onClick={() => setShowProposed((v) => !v)}
          className={`rounded border px-2 py-0.5 text-sm ${showProposed ? 'border-blue-200 bg-blue-100 text-blue-700' : 'border-gray-300 text-gray-600'}`}
        >
          Proposed
        </button>
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded bg-blue-600 px-3 py-0.5 text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
      </div>
```

(The grid markup below is unchanged **except** the `<EventBlock>` call gains `proposed={it.proposed}`:)

```tsx
                return (
                  <EventBlock
                    key={it.key}
                    title={it.title}
                    kind={it.kind}
                    pinned={it.pinned}
                    proposed={it.proposed}
                    topPct={pos.topPct}
                    heightPct={pos.heightPct}
                    startLabel={it.startLabel}
                  />
                );
```

Leave the day-headers, gutter, column filtering (`it.startMs >= d && it.startMs < d + MS_PER_DAY`), and now-line exactly as they are.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`
Expected: PASS (existing tests + the new toggle test). Existing tests are unaffected — `proposed` defaults to `[]`, the new toolbar button doesn't collide with the `◀`/`Today`/`▶`/`re-plan` role queries.

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "feat(web): WeekGrid renders proposed ghost blocks behind a default-on toggle"
```

---

## Task 3: `Planner` wiring + integration test

**Files:**
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Modify: `packages/web/src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Add a failing integration test to `Planner.test.tsx`**

Add `PreviewBlock` to the `../../api/types` import, then add inside `describe('Planner', ...)`:

```tsx
  it('shows proposed blocks on the grid by default and the Proposed toggle hides them', async () => {
    const proposed: PreviewBlock[] = [
      { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'Proposed focus',
        start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T14:00:00.000Z') },
    ];
    const api = makeApi({ getSchedulePreview: vi.fn(async () => ({ blocks: proposed, unscheduled: [] })) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Proposed focus')).toBeInTheDocument());
    const ghost = screen.getByText('Proposed focus').closest('[data-testid="event-block"]');
    expect(ghost).toHaveAttribute('data-proposed', 'true');
    fireEvent.click(screen.getByTestId('toggle-proposed'));
    expect(screen.queryByText('Proposed focus')).toBeNull();
  });
```

The file already imports `Planner`, `renderWithProviders`, `fakeApiClient`, `NOW`, and the `makeApi` helper. `getSchedulePreview` must return a `SchedulePreview` (`{ blocks, unscheduled }`); the existing `makeApi` default returns `{ blocks: [], unscheduled: [...] }`, so overriding it here is additive and the other tests keep their empty `blocks`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`
Expected: FAIL — `Planner` doesn't pass `proposed` to `WeekGrid`, so no `Proposed focus` ghost renders.

- [ ] **Step 3: Wire `proposed` in `src/app/pages/Planner.tsx`**

In the `<WeekGrid …>` element, add the `proposed` prop sourced from the existing preview query:

```tsx
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days)}
          blocks={schedule.data ?? []}
          events={calendar.data ?? []}
          proposed={preview.data?.blocks ?? []}
          replanPending={replan.isPending}
          onPrev={() => setWeekStartMs(weekStartMs - 7 * MS_PER_DAY)}
          onNext={() => setWeekStartMs(weekStartMs + 7 * MS_PER_DAY)}
          onToday={() => setWeekStartMs(startOfWeek(now()))}
          onReplan={() => replan.mutate()}
        />
```

(Only the `proposed={preview.data?.blocks ?? []}` line is new; everything else is unchanged. `preview` is the existing `useSchedulePreviewQuery()` result already used for `AtRiskPanel`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`
Expected: PASS (existing tests + the new one). Existing tests use a preview fixture with `blocks: []`, so no proposed ghosts appear in them.

- [ ] **Step 5: Run the full web suite + build**

Run: `npm test -w @notreclaim/web && npm run build -w @notreclaim/web`
Expected: all pass; build clean. (`App.test.tsx` is unaffected — it doesn't render the Planner with preview blocks.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): Planner draws proposed schedule blocks (preview) on the grid"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire monorepo test suite**

Ensure the userspace Postgres is running (the `@notreclaim/db` setup runs `prisma migrate deploy`):

```bash
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata status >/dev/null 2>&1 || \
  /usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start
```

Run: `npm test`
Expected: every package passes with **zero failures**. Baselines: core 27, scheduler 31, google 33, db 35, server 56, web 117 (+ the new EventBlock/WeekGrid/Planner assertions). The only requirement is no failures.

- [ ] **Step 2: Build the web package**

Run: `npm run build -w @notreclaim/web`
Expected: clean (`tsc` typechecks test files, then `vite build`).

- [ ] **Step 3: Commit any build-driven fixes (only if needed)**

```bash
git add -A && git commit -m "chore(web): typecheck fixes for proposed overlay"
```

(Skip if the build was already clean. Do **not** stage the untracked `seed-dev.mjs` / `.env.run` dev helpers — leave them out of commits.)

---

## Notes for the implementer

- **`proposed` is optional (`?`) with a `[]` default** in `WeekGrid` so the existing `renderGrid` helper and `Planner` call sites compile without change.
- **`PreviewBlock.start`/`.end` are already epoch ms** — pass them straight to `placeInDay`; do NOT `Date.parse` them (unlike committed `ScheduledBlock` ISO strings).
- **`kind: b.sourceType`** is sound: `sourceType` is `'task' | 'habit'`, a subset of `BlockKind`.
- **Toggle state lives in `WeekGrid`** (`useState(true)`), not the page — the Planner only passes the data.
- **Don't `import React`**; `useState` from `'react'` is fine.
- **Untracked dev files** (`seed-dev.mjs`, `.env.run`) from the local launch must not be committed — stage only the files each task lists.
