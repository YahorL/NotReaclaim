# Review 15 — Full-Day Planner with Vertical Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT SAFETY (all subagents):** Do NOT run `git checkout`, `git switch`, `git reset`, `git branch`, or `git stash`. Stay on `feat/review15-full-day-scroll`; commit with `git add <named files>` + `git commit` only. Read-only git is fine.

**Goal:** Show the planner's full day (00:00–24:00) instead of 06:00–22:00, with the hour grid scrolling vertically (day header pinned) and auto-scrolling to the current time on load.

**Architecture:** Widen the two window constants in `weekModel.ts` (all placement/drag/slot math derives from them and cascades). `WeekGrid` renders 24 hour rows, wraps the body grid in a vertical-scroll container below the fixed day-header grid, and scrolls to "now" on mount. The minute↔pixel ratio (58px/hr) is unchanged, so drag/resize math is identical per-minute.

**Tech Stack:** `@notreclaim/web` (React + Vite). Vitest. Run web tests with `TZ=UTC`.

**Spec:** `docs/superpowers/specs/2026-06-18-notreclaim-review-15-design.md`

---

## File structure

- Modify `packages/web/src/app/planner/weekModel.ts` — the two window constants.
- Modify `packages/web/src/app/planner/WeekGrid.tsx` — 24 hour rows; scroll container + auto-scroll.
- Test updates: `weekModel.test.ts`, `WeekGrid.test.tsx`, `pages/Planner.test.tsx`, `CreatePopover.test.tsx`, `InteractiveBlock.test.tsx`.

---

## Preconditions

- [ ] On branch `feat/review15-full-day-scroll` (already created).

---

## Task 1: Full-day window (constants + 24 hour rows + test updates)

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts`, `packages/web/src/app/planner/WeekGrid.tsx`
- Test: `weekModel.test.ts`, `WeekGrid.test.tsx`, `pages/Planner.test.tsx`, `CreatePopover.test.tsx`, `InteractiveBlock.test.tsx`

- [ ] **Step 1: Update the breaking unit-test assertions to the full-day window.** These currently hard-code the 06:00–22:00 window; the others in these files compute from the constants and will cascade.

In `packages/web/src/app/planner/weekModel.test.ts`:

(a) Replace the `placeInDay` "clamps a block that starts before the window" test with an end-clamp test (nothing clamps at the top anymore — the day starts at 00:00):

```ts
  it('clamps a block that extends past the end of the day', () => {
    const start = Date.parse('2026-01-05T23:00:00.000Z');
    const end = Date.parse('2026-01-06T01:00:00.000Z'); // 25:00 → clamps to 24:00
    const pos = placeInDay(start, end, dayStart)!;
    const span = WINDOW_END_MIN - WINDOW_START_MIN; // 1440
    expect(pos.topPct).toBeCloseTo((1380 / span) * 100, 5); // 23:00
    expect(pos.heightPct).toBeCloseTo((60 / span) * 100, 5); // 23:00–24:00
  });
```

(b) Replace the `placeInDay` "returns null when the interval is outside the day window" test (a 23:00 same-day block now renders):

```ts
  it('places early/late same-day blocks and returns null for a different day', () => {
    // 05:00 used to be clipped; now it places within the full-day window
    expect(placeInDay(Date.parse('2026-01-05T05:00:00.000Z'), Date.parse('2026-01-05T05:30:00.000Z'), dayStart)).not.toBeNull();
    expect(placeInDay(Date.parse('2026-01-05T23:00:00.000Z'), Date.parse('2026-01-05T23:30:00.000Z'), dayStart)).not.toBeNull();
    // a different day still returns null
    expect(placeInDay(Date.parse('2026-01-06T09:00:00.000Z'), Date.parse('2026-01-06T10:00:00.000Z'), dayStart)).toBeNull();
  });
```

(c) In the `clampToWindow` test, replace the two window-edge cases (the middle one is fine):

```ts
    expect(clampToWindow(540, 60)).toEqual({ startMin: 540, endMin: 600 });
    expect(clampToWindow(-30, 60)).toEqual({ startMin: WINDOW_START_MIN, endMin: WINDOW_START_MIN + 60 });
    expect(clampToWindow(1410, 60)).toEqual({ startMin: WINDOW_END_MIN - 60, endMin: WINDOW_END_MIN });
```

(d) In the `snapClickToSlot` test, fix the mid-window case (0.5 of a 24h day is 12:00, not 14:00):

```ts
    expect(snapClickToSlot(0)).toBe(WINDOW_START_MIN);       // top of the window (00:00)
    expect(snapClickToSlot(0.5)).toBe(720);                  // 12:00
    expect(snapClickToSlot(0.99)).toBe(WINDOW_END_MIN - 15); // clamped so a 15-min slot fits (23:45)
    expect(snapClickToSlot(-0.2)).toBe(WINDOW_START_MIN);
```

(Optional: update the now-stale comments "16 * 58 = 928" / "928px -> 960 min" in the grid-geometry/pxToMinutes tests to `24 * 58 = 1392` / `1392px -> 1440 min`; those assertions cascade and stay green.)

In `packages/web/src/app/planner/WeekGrid.test.tsx`, the click-to-create slot is now the **00:00** window top:

```ts
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    // jsdom: rect height 0 → fraction 0 → slot starts at the 00:00 window top
    expect(screen.getByTestId('slot-label').textContent).toMatch(/00:00/);
```

In `packages/web/src/app/pages/Planner.test.tsx`, the drag-to-schedule slot is now 00:00:

```ts
    const col = screen.getByTestId('day-col-0'); // today 2026-01-07 (TZ=UTC); jsdom 0-height → 00:00 slot
    const dt = { types: ['application/x-nr-task'], getData: (t: string) => (t === 'application/x-nr-task' ? 't1' : ''), dropEffect: '' };
    fireEvent.drop(col, { clientY: 100, dataTransfer: dt });
    await waitFor(() => expect(createScheduledBlock).toHaveBeenCalledTimes(1));
    expect(createScheduledBlock).toHaveBeenCalledWith({
      taskId: 't1',
      startsAt: '2026-01-07T00:00:00.000Z',
      endsAt: '2026-01-07T01:00:00.000Z',
    });
```

In `packages/web/src/app/planner/CreatePopover.test.tsx`, the "cap at the window end" test moves to the new 24:00 end:

```ts
  it('caps the duration so the slot cannot extend past the 24:00 window end', () => {
    renderWithProviders(<CreatePopover {...baseProps} startMin={1425} />, { api: fakeApiClient() });
    expect(screen.getByTestId('slot-label').textContent).toMatch(/11:45 PM.*12:00 AM|23:45.*00:00/); // 23:45 – 24:00 (15 min max)
    fireEvent.click(screen.getByRole('button', { name: 'increase slot' }));
    expect(screen.getByTestId('slot-label').textContent).toMatch(/11:45 PM.*12:00 AM|23:45.*00:00/); // still capped at 15 min
  });
```

In `packages/web/src/app/planner/InteractiveBlock.test.tsx`, make the per-60-min pixel constant window-independent (it currently hard-codes the old 960-min span):

```ts
const PX_PER_60MIN = minutesToPx(60); // 58px/hr (was (60/960)*GRID_COLUMN_PX)
```

(`minutesToPx` is already imported in that file.)

- [ ] **Step 2: Run — expect FAIL** (assertions now expect full-day values, but the constants are still 06:00–22:00).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts`
Expected: FAIL (e.g. snapClickToSlot(0) expects 0 but gets 360).

- [ ] **Step 3: Widen the window constants.** In `packages/web/src/app/planner/weekModel.ts`:

```ts
export const WINDOW_START_MIN = 0;          // 00:00
export const WINDOW_END_MIN = 24 * 60;      // 24:00 (full day)
```

- [ ] **Step 4: Render all 24 hour rows.** In `packages/web/src/app/planner/WeekGrid.tsx`, change the `HOURS` constant:

```ts
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 00:00 → 23:00 row starts (full day)
```

(`hourLabel` already renders `12a … 11p` for `0..23`.)

- [ ] **Step 5: Run the affected suites — expect PASS.**

```bash
cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx src/app/planner/CreatePopover.test.tsx src/app/planner/InteractiveBlock.test.tsx
```
Expected: all PASS. (If a `slot-label` regex doesn't match the rendered format, open the component output and adjust the regex to the actual string — keep the 00:00 / 23:45–24:00 intent.)

- [ ] **Step 6: Full web suite + build, then commit.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all pass; clean build.

```bash
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/weekModel.test.ts packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/pages/Planner.test.tsx packages/web/src/app/planner/CreatePopover.test.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx
git commit -m "feat(web): planner shows the full day (00:00–24:00); 24 hour rows"
```

---

## Task 2: Vertical scroll container + auto-scroll to now

**Files:**
- Modify: `packages/web/src/app/planner/WeekGrid.tsx`
- Test: `packages/web/src/app/planner/WeekGrid.test.tsx`

- [ ] **Step 1: Write a failing test.** In `WeekGrid.test.tsx`, add (the `renderGrid` helper already exists):

```ts
  it('puts the hour grid in a scroll container, below the day header', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    expect(scroller.className).toMatch(/overflow-y-auto/);
    // day headers are OUTSIDE the scroll container (they stay pinned)
    expect(scroller.querySelector('[data-testid="day-header-0"]')).toBeNull();
    expect(screen.getByTestId('day-header-0')).toBeInTheDocument();
    // hour rows / day columns ARE inside the scroller
    expect(scroller.querySelector('[data-testid="day-col-0"]')).not.toBeNull();
  });
```

- [ ] **Step 2: Run — expect FAIL** (`hours-scroll` not found).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `WeekGrid.tsx`:

Add `useRef` to the React import and `localMidnight` + `GRID_COLUMN_PX` to the weekModel import:

```ts
import { useEffect, useRef, useState } from 'react';
```
```ts
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, TIME_GUTTER_PX, GRID_COLUMN_PX, localMidnight } from './weekModel';
```

Inside the component (near the other hooks, after the `taskDrop` state), add the ref + auto-scroll effect:

```ts
  const scrollRef = useRef<HTMLDivElement>(null);
  // On mount, scroll so the current time-of-day sits near the top (a little context above).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minOfDay = Math.max(0, Math.min(WINDOW_END_MIN, (nowMs - localMidnight(nowMs)) / 60_000));
    el.scrollTop = Math.max(0, (minOfDay / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX - 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll to "now" once on mount
  }, []);
```

Wrap **only the body grid** in the scroll container. Change:

```tsx
          {/* body grid */}
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
```

to:

```tsx
          {/* body grid (scrolls vertically; the day header above stays pinned) */}
          <div ref={scrollRef} data-testid="hours-scroll" className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
```

and add the matching extra closing `</div>` immediately after the body grid's existing closing `</div>` (the one before the card's closing `</div>`). I.e. the body grid `</div>` is now followed by one more `</div>` to close the scroll container.

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full web suite + build, then commit.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all pass; clean build.

```bash
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "feat(web): scroll the hour grid vertically (pinned day header) + auto-scroll to now"
```

---

## Task 3: Verify & finish

- [ ] **Step 1: Full web suite + build.**

```bash
(cd packages/web && npm test)
npm run build
```
Expected: all green; all workspaces compile. (Server/db/core untouched, but a root build confirms nothing else broke.)

- [ ] **Step 2: Restart Vite (clear cache), live-verify via geckodriver.**

- `cd packages/web && rm -rf node_modules/.vite && npm run dev` (:5173). (API can stay as-is — no server change this review.)
- With the demo token + `TZ=UTC` geckodriver, confirm: the grid shows **24 hourly labels (12a … 11p)**; the body **scrolls vertically**; on load it's **scrolled near the current time** (the now-line is visible without manual scrolling); the **day-of-week header stays fixed** while scrolling the hours; a **late-night block (e.g. 23:00) renders** (previously clipped); and there's **no page-level horizontal scroll** (Review 13 day count intact). Tune the `maxHeight` offset if a second vertical scrollbar appears.

- [ ] **Step 3: Update memory** (`project-status.md` + `MEMORY.md`) with a one-line Review 15 summary (window now 00:00–24:00, vertical scroll, auto-scroll to now).

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review15-full-day-scroll` to `main`.

---

## Self-review notes (reconciled)

- **Spec coverage:** full-day window (Task 1 constants + 24 `HOURS`); vertical scroll + pinned header (Task 2 container); auto-scroll to now (Task 2 effect); tests (both tasks) + live verify (Task 3).
- **Cascade correctness:** `minutesToPx`/`pxToMinutes` ratio is `GRID_COLUMN_PX/span = 1392/1440 = 58/60` — unchanged, so drag/resize math is identical; only `InteractiveBlock.test`'s hard-coded `(60/960)*GRID_COLUMN_PX` needed the `minutesToPx(60)` fix.
- **No silent caps:** `snapClickToSlot` still reserves the bottom 15 min (`WINDOW_END_MIN-15` = 23:45); blocks past midnight clamp to 24:00 in `placeInDay`.
