# Review 13 — Planner Layout & Start Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Start to the Next-task widget only (pulling the upcoming task's start to the snapped current time), add hide toggles for the left sidebar and right task panel, and make the planner render as many days as fit (today-anchored, paged by N) with no horizontal scroll.

**Architecture:** Mostly web. The planner becomes a responsive N-day window: a pure `daysThatFit(width)` + a `ResizeObserver` width hook drive `dayCount`; `WeekGrid` renders `days.length` columns via inline `gridTemplateColumns` (no min-width/scroll). The per-tile Start button is removed; the existing Next-task widget keeps the only Start, and `POST /schedule/:id/start` is changed to pull the block's start to `round15(now)` (end fixed). Two `localStorage`-backed UI flags hide the sidebar / right panel.

**Tech Stack:** React + React Query + Vite (`@notreclaim/web`); one Fastify route tweak (`@notreclaim/server`). Vitest. **Run web tests with `TZ=UTC`; run tests per-package.**

**Spec:** `docs/superpowers/specs/2026-06-15-notreclaim-review-13-design.md`

---

## File structure

**Modify**
- `packages/server/src/schedule-routes.ts` — pull-forward snap in `POST /schedule/:id/start`
- `packages/web/src/app/planner/weekModel.ts` — `dayColumns(count)`, `clampDayDelta(last)`, `daysThatFit`
- `packages/web/src/app/planner/InteractiveBlock.tsx` — drop Start button + `onStart`/`startedAt`; take `dayCount` for clamp
- `packages/web/src/app/planner/WeekGrid.tsx` — dynamic columns, no min-width/scroll, drop `onStartBlock`/`startedAt`, pass `dayCount={days.length}`
- `packages/web/src/app/pages/Planner.tsx` — `viewStartMs` + responsive `dayCount` + panel hide; drop Start wiring; page by N
- `packages/web/src/app/planner/PlannerTaskPanel.tsx` — `onHide` + hide button
- `packages/web/src/app/AppShell.tsx` — `sidebarHidden` + conditional `<Sidebar/>`
- `packages/web/src/app/Sidebar.tsx` — add `data-testid="sidebar"` to its root
- `packages/web/src/app/shell/TopBar.tsx` — sidebar toggle button

**Create**
- `packages/web/src/app/planner/useElementWidth.ts` — ResizeObserver width hook

**Test files touched:** `packages/server/test/schedule.test.ts`, `packages/web/src/app/planner/{weekModel.test.ts,WeekGrid.test.tsx,InteractiveBlock.test.tsx,PlannerTaskPanel.test.tsx}`, `packages/web/src/app/shell/TopBar.test.tsx`, `packages/web/src/app/pages/Planner.test.tsx`, and a new `packages/web/src/app/AppShell.test.tsx`.

---

## Preconditions

- [ ] On branch `feat/review13-planner-layout` (already created). Postgres only needed if you run server tests — it's running.

---

## Task 1: Server — pull the start to now

**Files:**
- Modify: `packages/server/src/schedule-routes.ts`
- Test: `packages/server/test/schedule.test.ts`

- [ ] **Step 1: Update the failing test.** In `schedule.test.ts`, inside the `describe('POST /schedule/:id/start', …)` block, **replace** the test titled `'does not move startsAt when the snap falls at/before the block start'` with:

```ts
  it('pulls an upcoming block start to the snapped current time, keeping the end', async () => {
    const b = block({ id: 'b1', startsAt: new Date('2026-01-05T02:00:00.000Z'), endsAt: new Date('2026-01-05T03:00:00.000Z') });
    const { app } = buildTestApp({ blocks: [b], settings: settings() });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/b1/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().startsAt).toBe('2026-01-05T00:00:00.000Z'); // FIXED_NOW (00:00) snapped → pulled forward
    expect(res.json().endsAt).toBe('2026-01-05T03:00:00.000Z');   // end unchanged
    expect(res.json().pinned).toBe(true);
  });
```

Leave the other start-route tests (late-start snap, 404 unknown, 400 habit) unchanged.

- [ ] **Step 2: Run — expect FAIL** (old code leaves startsAt at 02:00).

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: FAIL on the new test.

- [ ] **Step 3: Implement.** In `schedule-routes.ts`, in the `POST /schedule/:id/start` handler, change the snap condition from:

```ts
    if (snapped > blockRow.startsAt.getTime() && snapped < blockRow.endsAt.getTime()) {
      data.startsAt = new Date(snapped);
    }
```

to:

```ts
    // Pull the start to the snapped current time (Start always targets the upcoming task),
    // keeping the end. The lower-bound guard is gone so a future block is pulled forward too.
    if (snapped < blockRow.endsAt.getTime()) {
      data.startsAt = new Date(snapped);
    }
```

- [ ] **Step 4: Run — expect PASS** (all start-route tests).

Run: `npm --workspace @notreclaim/server test -- schedule`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/schedule-routes.ts packages/server/test/schedule.test.ts
git commit -m "feat(server): start pulls the upcoming block to the snapped current time"
```

---

## Task 2: weekModel — variable day count + fit math

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts`
- Test: `packages/web/src/app/planner/weekModel.test.ts` (create if absent, else append)

- [ ] **Step 1: Write failing tests.** Create/append `weekModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayColumns, clampDayDelta, daysThatFit } from './weekModel';

describe('dayColumns(count)', () => {
  it('returns the requested number of consecutive local-midnight days', () => {
    const start = new Date('2026-01-07T00:00:00').getTime();
    expect(dayColumns(start, 3)).toHaveLength(3);
    expect(dayColumns(start, 3)[1]).toBe(new Date('2026-01-08T00:00:00').getTime());
    expect(dayColumns(start)).toHaveLength(7); // default
  });
});

describe('clampDayDelta(lastIndex)', () => {
  it('clamps the day delta to [-dayIndex, lastIndex - dayIndex]', () => {
    expect(clampDayDelta(0, 5, 2)).toBe(2);   // last index 2
    expect(clampDayDelta(2, -5, 2)).toBe(-2);
    expect(clampDayDelta(1, 1, 6)).toBe(1);
  });
});

describe('daysThatFit', () => {
  it('returns 7 for unknown/zero width', () => {
    expect(daysThatFit(0)).toBe(7);
    expect(daysThatFit(-10)).toBe(7);
  });
  it('fits more days as width grows, capped at 7 and floored at 1', () => {
    expect(daysThatFit(64 + 120 * 3 + 10)).toBe(3);
    expect(daysThatFit(64 + 120 * 20)).toBe(7);
    expect(daysThatFit(100)).toBe(1);
  });
});
```

> If `weekModel.test.ts` already exists, add these three `describe` blocks to it (and merge the import line).

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts`
Expected: FAIL (`daysThatFit` undefined; `clampDayDelta` arity).

- [ ] **Step 3: Implement.** In `weekModel.ts`:

Change `dayColumns` to accept a count:

```ts
/** `count` consecutive local-midnight timestamps starting at `startMs` (default 7). */
export function dayColumns(startMs: number, count = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startMs);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d.getTime());
  }
  return out;
}
```

Change `clampDayDelta` to take the last index:

```ts
/** Clamp a horizontal day delta so dayIndex + delta stays within the rendered columns (0..lastIndex). */
export function clampDayDelta(dayIndex: number, delta: number, lastIndex = 6): number {
  return Math.max(-dayIndex, Math.min(lastIndex - dayIndex, delta)) || 0;
}
```

Add the fit helper (near the other layout constants):

```ts
/** Time-gutter width (px) — must match WeekGrid's first column. */
export const TIME_GUTTER_PX = 64;
/** Minimum readable width (px) for one day column. */
export const MIN_DAY_COL_PX = 120;

/** How many day columns fit in `widthPx` (1..7); 7 when the width is unknown (0/SSR/jsdom). */
export function daysThatFit(widthPx: number): number {
  if (!(widthPx > 0)) return 7;
  return Math.max(1, Math.min(7, Math.floor((widthPx - TIME_GUTTER_PX) / MIN_DAY_COL_PX)));
}
```

- [ ] **Step 4: Run — expect PASS** (this file + the full planner-model area).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): weekModel supports a variable day count + daysThatFit"
```

---

## Task 3: `useElementWidth` ResizeObserver hook

**Files:**
- Create: `packages/web/src/app/planner/useElementWidth.ts`

(No unit test: jsdom lacks layout/ResizeObserver, so the hook reports 0 and `daysThatFit(0)` → 7; behavior is verified live. The hook is intentionally tiny.)

- [ ] **Step 1: Create the hook.**

```ts
import { useState, useEffect, useRef, type RefObject } from 'react';

/** Track an element's content-box width via ResizeObserver. Returns [ref, width]; width is 0 until measured (and in jsdom). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `npm --workspace @notreclaim/web run build`
Expected: tsc + vite build succeed.

- [ ] **Step 3: Commit.**

```bash
git add packages/web/src/app/planner/useElementWidth.ts
git commit -m "feat(web): useElementWidth ResizeObserver hook"
```

---

## Task 4: InteractiveBlock — remove the Start button, take `dayCount`

**Files:**
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx`
- Test: `packages/web/src/app/planner/InteractiveBlock.test.tsx`

- [ ] **Step 1: Remove the obsolete Start-button tests.** In `InteractiveBlock.test.tsx`, delete the entire `describe('InteractiveBlock Start button', …)` block (the two tests added in Review 12 that reference `block-start` / `block-started`). Leave the `renderBlock` helper and all other tests.

- [ ] **Step 2: Run — expect PASS** (the file still passes without the deleted tests; confirms nothing else referenced them).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx`
Expected: PASS.

- [ ] **Step 3: Implement.** In `InteractiveBlock.tsx`:

In `InteractiveBlockProps`, remove `onStart?: () => void;` and `startedAt?: string | null;` and add `dayCount?: number;`:

```ts
  onDelete?: () => void;
  dayCount?: number;
  accent?: string;
```

In the destructure (the `const { … } = props;` line), remove `onStart, startedAt` and add `dayCount = 7`:

```ts
  const { dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit, onUnpin, onDelete, dayCount = 7, accent } = props;
```

In `snappedDx`, pass the last index to the clamp:

```ts
  const snappedDx = (clientX: number): number => {
    const w = colWidthRef.current;
    if (w <= 0) return 0;
    return clampDayDelta(dayIndex, Math.round((finite(clientX) - startXRef.current) / w), dayCount - 1);
  };
```

Delete the Start-button JSX block (the `{onStart && (startedAt ? … : …)}` element between the title line and the `{showDragLabel && …}` element):

```tsx
      <span className="font-medium">{startLabel}</span> {title}
      {showDragLabel && (
```

(i.e. the title line is now immediately followed by the `showDragLabel` element — remove everything in between.)

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx
git commit -m "feat(web): drop the per-tile Start button; clamp day-drag to the rendered column count"
```

---

## Task 5: WeekGrid — dynamic columns, no horizontal scroll, drop Start wiring

**Files:**
- Modify: `packages/web/src/app/planner/WeekGrid.tsx`
- Test: `packages/web/src/app/planner/WeekGrid.test.tsx`

- [ ] **Step 1: Write a failing test.** In `WeekGrid.test.tsx`, add (reuse the file's existing render helper / props factory — open it; it renders `<WeekGrid …>` with a `days` array):

```ts
  it('renders one column per day for a 3-day window and has no horizontal-scroll wrapper', () => {
    const days = [
      new Date('2026-01-07T00:00:00.000Z').getTime(),
      new Date('2026-01-08T00:00:00.000Z').getTime(),
      new Date('2026-01-09T00:00:00.000Z').getTime(),
    ];
    renderGrid({ days }); // adapt to the file's helper; pass the 3-day array
    expect(screen.getByTestId('day-col-0')).toBeInTheDocument();
    expect(screen.getByTestId('day-col-2')).toBeInTheDocument();
    expect(screen.queryByTestId('day-col-3')).toBeNull();
  });
```

> Match the file's real helper name and required props (nowMs, weekLabel, blocks, events, on* handlers). If it has no helper, render `<WeekGrid>` directly with the existing tests' prop set but a 3-element `days`.

- [ ] **Step 2: Run — expect FAIL** (hard-coded 7-column grid still renders only the 3 given days but the assertion for absence of `day-col-3` already passes; the meaningful check is the column template — so this step mainly guards the dynamic-template change. If it passes pre-change because `days.length` already drives `.map`, keep it as a regression guard and proceed.)

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx`
Expected: the new test PASSES already for column count (days drive the `.map`); it locks the behavior. Continue to make the layout change.

- [ ] **Step 3: Implement.** In `WeekGrid.tsx`:

Add `TIME_GUTTER_PX` to the weekModel import:

```ts
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, TIME_GUTTER_PX } from './weekModel';
```

Remove `onStartBlock?: (id: string) => void;` from `WeekGridProps`. Remove `startedAt: string | null;` from the `Item` interface. In `toItems`, remove `startedAt: b.startedAt ?? null` (blocks) and `startedAt: null` (events) from the two returned objects. In the `props` destructure, remove `onStartBlock`.

Compute the grid template once inside the component (after the destructure):

```ts
  const gridCols = `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;
```

Replace the scroll wrapper + min-width. Change:

```tsx
      <div className="overflow-x-auto">
        <div className="min-w-[820px] overflow-hidden rounded-[14px] border border-line bg-card">
```

to:

```tsx
      <div className="w-full">
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
```

Change the header grid div from `className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-line"` to:

```tsx
          <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
```

Change the body grid div from `className="grid grid-cols-[64px_repeat(7,1fr)]"` to:

```tsx
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
```

In the `<InteractiveBlock …>` usage, remove the `onStart={…}` and `startedAt={it.startedAt}` props and add `dayCount={days.length}`:

```tsx
                          onDelete={onDeleteBlock ? () => onDeleteBlock(blockId) : undefined}
                          dayCount={days.length}
                          accent={accent}
```

- [ ] **Step 4: Run — expect PASS** (new + existing WeekGrid tests; the 7-day fixtures still render 7 columns).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "feat(web): WeekGrid renders N day columns with no horizontal scroll"
```

---

## Task 6: Hide / show the left sidebar

**Files:**
- Modify: `packages/web/src/app/AppShell.tsx`, `packages/web/src/app/Sidebar.tsx`, `packages/web/src/app/shell/TopBar.tsx`
- Test: `packages/web/src/app/shell/TopBar.test.tsx`, `packages/web/src/app/AppShell.test.tsx` (create)

- [ ] **Step 1: Write failing tests.**

In `TopBar.test.tsx` add (the file uses `renderWithProviders` + `fakeApiClient`; pass the new props):

```ts
  it('renders a sidebar toggle that fires onToggleSidebar', () => {
    const onToggleSidebar = vi.fn();
    const api = fakeApiClient({ getSchedule: vi.fn(async () => []) });
    renderWithProviders(<TopBar onNewTask={() => {}} sidebarHidden={false} onToggleSidebar={onToggleSidebar} />, { api });
    const btn = screen.getByTestId('toggle-sidebar');
    expect(btn).toHaveAttribute('aria-label', 'Hide sidebar');
    fireEvent.click(btn);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });
```

Create `packages/web/src/app/AppShell.test.tsx`:

```ts
import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test/fakes';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('toggles the left sidebar visibility', () => {
    localStorage.removeItem('nr.sidebarHidden');
    renderWithProviders(<AppShell />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(screen.queryByTestId('sidebar')).toBeNull();
    fireEvent.click(screen.getByTestId('toggle-sidebar'));
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx src/app/AppShell.test.tsx`
Expected: FAIL (`toggle-sidebar` / `sidebar` not found).

- [ ] **Step 3: Implement.**

In `Sidebar.tsx`, add `data-testid="sidebar"` to the root element (the outermost `<aside>`/`<nav>` container).

In `TopBar.tsx`, extend props and render the toggle button. Change the interface:

```ts
interface TopBarProps {
  onNewTask: () => void;
  now?: () => number;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}
```

Update the signature: `export function TopBar({ onNewTask, now = Date.now, sidebarHidden = false, onToggleSidebar }: TopBarProps) {`

Insert, as the first child inside `<header …>` (before the `<h1>`):

```tsx
      {onToggleSidebar && (
        <button
          type="button"
          data-testid="toggle-sidebar"
          aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          onClick={onToggleSidebar}
          className="-ml-1 rounded-[9px] p-2 text-inkSoft hover:bg-line"
        >
          <Icons.panelLeft size={20} />
        </button>
      )}
```

In `AppShell.tsx`, add the state + persistence + conditional render:

```tsx
import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';
import { NewTaskModal } from './shell/NewTaskModal';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('nr.sidebarHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nr.sidebarHidden', sidebarHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [sidebarHidden]);

  return (
    <div className="flex h-screen overflow-hidden">
      {!sidebarHidden && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onNewTask={() => setNewTaskOpen(true)}
          sidebarHidden={sidebarHidden}
          onToggleSidebar={() => setSidebarHidden((h) => !h)}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/shell/TopBar.test.tsx src/app/AppShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/AppShell.tsx packages/web/src/app/Sidebar.tsx packages/web/src/app/shell/TopBar.tsx packages/web/src/app/shell/TopBar.test.tsx packages/web/src/app/AppShell.test.tsx
git commit -m "feat(web): hide/show the left sidebar"
```

---

## Task 7: Hide button on the right task panel

**Files:**
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx`
- Test: `packages/web/src/app/planner/PlannerTaskPanel.test.tsx`

- [ ] **Step 1: Write a failing test.** In `PlannerTaskPanel.test.tsx`, add (extend `renderPanel` to forward an `onHide` handler, or render `<PlannerTaskPanel … onHide={fn} />` directly):

```ts
  it('shows a hide button that fires onHide', () => {
    const onHide = vi.fn();
    renderPanel([task({ id: 'a', title: 'Thing' })], undefined, { onHide });
    fireEvent.click(screen.getByTestId('panel-hide'));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
```

> If `renderPanel`'s handlers arg doesn't accept `onHide`, add it there and pass it through to the component.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/PlannerTaskPanel.test.tsx`
Expected: FAIL (`panel-hide` not found).

- [ ] **Step 3: Implement.** In `PlannerTaskPanel.tsx`:

Add `onHide?: () => void;` to `PlannerTaskPanelProps`, and accept it in the destructured props of `PlannerTaskPanel`.

In the tab-header row (`<div className="flex shrink-0 gap-1 border-b border-line px-2 pt-2">`), after the two tab buttons (still inside that div), add:

```tsx
        {onHide && (
          <button
            type="button"
            data-testid="panel-hide"
            aria-label="Hide tasks panel"
            onClick={onHide}
            className="shrink-0 rounded-[9px] px-2 text-[16px] font-bold text-inkSoft hover:bg-bg hover:text-ink"
          >
            ›
          </button>
        )}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/PlannerTaskPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx
git commit -m "feat(web): hide button on the planner task panel"
```

---

## Task 8: Planner — today-anchored N-day window, panel hide, drop Start wiring

**Files:**
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Test: `packages/web/src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Update the tests.** In `Planner.test.tsx`:

(a) **Remove** the Review-12-era test titled `'starts a block from the planner tile'` (it referenced `block-start`).

(b) **Add** a panel-hide test:

```ts
  it('hides and re-shows the right task panel', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-hide'));
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('panel-show'));
    expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument();
  });
```

(c) **Update the existing range/navigation test** (the one that clicks Next and asserts `getSchedule` was called with a new range). The window is now today-anchored and pages by `dayCount` (jsdom width 0 → `dayCount = 7`). With `NOW = 2026-01-07T12:00:00Z` (and `TZ=UTC`), the initial range is `from = 2026-01-07T00:00:00.000Z`, `to = 2026-01-14T00:00:00.000Z`; after one **Next** click, `from = 2026-01-14T00:00:00.000Z`, `to = 2026-01-21T00:00:00.000Z`. Adjust that test's expected ISO strings accordingly (it previously expected Monday-anchored week ranges). Keep its mechanism (spy on `getSchedule`, click `Next`, `waitFor` the new-range call).

> Open the file to get the exact current assertion text before editing; preserve its structure, change only the expected dates and (if present) the week-label expectation to the visible range.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/pages/Planner.test.tsx`
Expected: FAIL (panel-hide/show missing; range mismatch).

- [ ] **Step 3: Implement.** Rewrite `Planner.tsx` to:

Replace the imports at the top:

```ts
import { useMemo, useState, useEffect } from 'react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, localMidnight, clampToWindow, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';
```

Change `weekLabel` to use the visible range ends:

```ts
function weekLabel(days: number[]): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(days[0]!)} – ${fmt(days[days.length - 1]!)}`;
}
```

Replace the state/derivation block (the `weekStartMs`/`days`/`fromIso`/`toIso` lines and the `startBlock` line) with:

```ts
export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const [viewStartMs, setViewStartMs] = useState(() => localMidnight(nowMs));
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  const dayCount = daysThatFit(gridWidth);
  const days = useMemo(() => dayColumns(viewStartMs, dayCount), [viewStartMs, dayCount]);
  const fromIso = new Date(viewStartMs).toISOString();
  const toIso = new Date(viewStartMs + dayCount * MS_PER_DAY).toISOString();
  const [panelHidden, setPanelHidden] = useState(() => {
    try { return localStorage.getItem('nr.plannerPanelHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nr.plannerPanelHidden', panelHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [panelHidden]);

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const tasksQ = useTasksQuery();
  const categoriesQ = useCategoriesQuery();
  const replan = useReplanMutation();
  const updateBlock = useUpdateScheduledBlockMutation();
  const deleteBlock = useDeleteScheduledBlockMutation();
  const deleteEvent = useDeleteCalendarEventMutation();
  const updateTask = useUpdateTaskMutation();
  const deleteTask = useDeleteTaskMutation();
  const createBlock = useCreateScheduledBlockMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = (tasksQ.data ?? []).find((t) => t.id === editingId) ?? null;
```

(Delete the old `useStartBlockMutation()` call entirely.)

Update the `WeekGrid` block: wrap its container with the measuring ref, swap the nav handlers to page by `dayCount`, and remove `onStartBlock`:

```tsx
  return (
    <div className="flex gap-3 p-4">
      <div ref={gridRef} className="min-w-0 flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your days…</div>}
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days)}
          blocks={labeledBlocks}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setViewStartMs((ms) => shiftDays(ms, -dayCount))}
          onNext={() => setViewStartMs((ms) => shiftDays(ms, dayCount))}
          onToday={() => setViewStartMs(localMidnight(now()))}
          onReplan={() => replan.mutate()}
          onCommit={(id, patch) => updateBlock.mutate({ id, patch })}
          onDeleteBlock={(id) => deleteBlock.mutate(id)}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          onScheduleTaskAt={onScheduleTaskAt}
          accents={accents}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      {panelHidden ? (
        <button
          type="button"
          data-testid="panel-show"
          aria-label="Show tasks panel"
          onClick={() => setPanelHidden(false)}
          className="h-fit shrink-0 self-start rounded-[12px] border border-line bg-card px-2 py-4 text-[13px] font-bold text-inkSoft [writing-mode:vertical-rl] hover:text-ink"
        >
          Tasks ‹
        </button>
      ) : (
        <PlannerTaskPanel
          tasks={tasksQ.data ?? []}
          preview={preview.data}
          nowMs={nowMs}
          onComplete={onCompleteTask}
          onEdit={(t) => setEditingId(t.id)}
          onDelete={onDeleteTask}
          onHide={() => setPanelHidden(true)}
        />
      )}
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateTask.isPending}
            error={updateTask.error instanceof ApiError ? updateTask.error : null}
            onSave={(patch) => updateTask.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  );
}
```

(The `onScheduleTaskAt`, `labeledBlocks`, `accents`, `isLoading`/`isError`, and the error-return block are unchanged from the current file — keep them.)

- [ ] **Step 4: Run — expect PASS** (Planner tests).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/pages/Planner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full web suite + build.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all web tests pass; tsc + vite build clean. (If any other test imported the removed `onStartBlock`/`startBlock` Planner wiring or the old `addWeeks`/`startOfWeek` Planner usage, fix the reference.)

- [ ] **Step 6: Commit.**

```bash
git add packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): today-anchored responsive day window + right-panel hide; Start only in the widget"
```

---

## Phase: Verify & finish

### Task 9: Full verification

- [ ] **Step 1: Per-package suites.**

```bash
npm --workspace @notreclaim/server test
(cd packages/web && npm test)
```
Expected: green. (db/core/scheduler/google untouched — run them too if you want a full sweep.)

- [ ] **Step 2: Build everything.**

```bash
npm run build
```
Expected: all workspaces compile.

- [ ] **Step 3: Rebuild + restart the API, restart Vite, live-verify via geckodriver.**

- Start API: `set -a && . ./.env.run && set +a && node packages/server/dist/server.js` (:3000).
- Restart Vite (clear cache after branch churn): `cd packages/web && rm -rf node_modules/.vite && npm run dev`.
- With the demo token, confirm:
  - **No Start button on calendar tiles**; the Next-task widget's **Start** pulls the upcoming task's start to the snapped now (end unchanged).
  - **Toggle-sidebar** button in the topbar hides/shows the left sidebar.
  - **Hide (›)** on the task panel hides it and shows the **Tasks ‹** reopen button; reopening restores it.
  - **Narrow the window / hide a panel** → the planner shows fewer/more days with **no horizontal scrollbar**; Prev/Next page by the visible count; Today returns to today as the first column. (Headless Firefox renders in its local tz — run geckodriver with `TZ=UTC` to line up with UTC-placed seed blocks.)

- [ ] **Step 4: Update memory** (`project-status.md` + `MEMORY.md`) with a one-line Review 13 summary.

- [ ] **Step 5: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review13-planner-layout` to `main`.

---

## Self-review notes (reconciled)

- **Spec coverage:** Start-relocation + pull-forward (Tasks 1, 4, 5, 8 + widget unchanged); left-sidebar hide (Task 6); right-panel hide (Tasks 7, 8); responsive day window (Tasks 2, 3, 5, 8).
- **Type consistency:** `dayColumns(start, count)`, `clampDayDelta(idx, delta, lastIndex)`, `daysThatFit(width)`, `TIME_GUTTER_PX`, `useElementWidth`, `dayCount`, `viewStartMs`, `panelHidden`, `sidebarHidden`, testids `toggle-sidebar`/`sidebar`/`panel-hide`/`panel-show` used consistently across tasks.
- **No silent caps:** `daysThatFit` floors at 1, caps at 7, and falls back to 7 when width is unknown (jsdom/SSR) so existing 7-day tests and behavior are preserved.
