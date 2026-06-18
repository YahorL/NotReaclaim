# Review 16b — Google-Calendar Overlap Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT SAFETY (all subagents):** Do NOT run `git checkout`, `git switch`, `git reset`, `git branch`, or `git stash`. Stay on `feat/review16b-overlap-layout`; commit with `git add <named files>` + `git commit` only. Read-only git is fine.

**Goal:** Render overlapping planner tiles side-by-side in equal-width lanes (Google-Calendar style) instead of stacked.

**Architecture:** A pure `layoutOverlaps` assigns each of a day's items a `{lane, lanes}` within its overlap cluster. `WeekGrid` runs it per day and passes `leftPct`/`widthPct` to each tile; `EventBlock`/`InteractiveBlock` apply those inline (replacing the fixed full-width `left-0.5 right-0.5`).

**Tech Stack:** `@notreclaim/web` (React + Vite). Vitest, web `TZ=UTC`.

**Spec:** `docs/superpowers/specs/2026-06-18-notreclaim-review-16b-overlap-layout-design.md`

---

## Preconditions
- [ ] On branch `feat/review16b-overlap-layout` (already created).

---

## Task 1: `layoutOverlaps` pure module

**Files:** Create `packages/web/src/app/planner/overlapLayout.ts`, `packages/web/src/app/planner/overlapLayout.test.ts`

- [ ] **Step 1: Write failing tests.** Create `overlapLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutOverlaps } from './overlapLayout';

const at = (h: number, m = 0) => Date.parse(`2026-01-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
const item = (key: string, sh: number, eh: number) => ({ key, startMs: at(sh), endMs: at(eh) });

describe('layoutOverlaps', () => {
  it('gives non-overlapping items a single full-width lane', () => {
    const m = layoutOverlaps([item('a', 9, 10), item('b', 10, 11), item('c', 11, 12)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('b')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('c')).toEqual({ lane: 0, lanes: 1 });
  });
  it('splits two overlapping items into two lanes', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 10, 12)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
  });
  it('uses three lanes for three mutually-overlapping items', () => {
    const m = layoutOverlaps([item('a', 9, 12), item('b', 9, 12), item('c', 9, 12)]);
    expect(m.get('c')).toEqual({ lane: 2, lanes: 3 });
  });
  it('reuses a freed lane within the same cluster (A 9-11, B 9-10, C 10-11)', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 9, 10), item('c', 10, 11)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(m.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(m.get('c')).toEqual({ lane: 1, lanes: 2 }); // C reuses B's lane (B ends as C starts)
  });
  it('treats touching blocks (end == start) as non-overlapping', () => {
    const m = layoutOverlaps([item('a', 9, 10), item('b', 10, 11)]);
    expect(m.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(m.get('b')).toEqual({ lane: 0, lanes: 1 });
  });
  it('keeps separate clusters independent', () => {
    const m = layoutOverlaps([item('a', 9, 11), item('b', 10, 12), item('x', 14, 15)]);
    expect(m.get('a')!.lanes).toBe(2);
    expect(m.get('x')).toEqual({ lane: 0, lanes: 1 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/overlapLayout.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Create `overlapLayout.ts`:

```ts
export interface LayoutItem { key: string; startMs: number; endMs: number }
export interface Lane { lane: number; lanes: number }

/**
 * Equal-lane overlap layout (Google-Calendar basic model). Items in the same overlap
 * *cluster* split into N lanes; each item takes lane index `lane` of `lanes` total.
 * Touching intervals (end === start) do not overlap and may share a lane.
 */
export function layoutOverlaps(items: LayoutItem[]): Map<string, Lane> {
  const result = new Map<string, Lane>();
  const sorted = [...items].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  let cluster: { key: string; endMs: number; lane: number }[] = [];
  let laneEnds: number[] = []; // last endMs per open lane in the current cluster
  let clusterMax = 0;          // max endMs in the current cluster

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const c of cluster) result.set(c.key, { lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
    clusterMax = 0;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMs >= clusterMax) flush(); // no overlap with the cluster → close it
    // first lane whose previous block has ended (end <= start); else a new lane
    let lane = laneEnds.findIndex((end) => end <= it.startMs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMs); }
    else laneEnds[lane] = it.endMs;
    cluster.push({ key: it.key, endMs: it.endMs, lane });
    clusterMax = Math.max(clusterMax, it.endMs);
  }
  flush();
  return result;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/overlapLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/planner/overlapLayout.ts packages/web/src/app/planner/overlapLayout.test.ts
git commit -m "feat(web): layoutOverlaps — equal-lane overlap layout helper"
```

---

## Task 2: Render tiles in lanes

**Files:** Modify `EventBlock.tsx`, `InteractiveBlock.tsx`, `WeekGrid.tsx`; Test `WeekGrid.test.tsx`

- [ ] **Step 1: Write a failing test.** In `WeekGrid.test.tsx` add (the `renderGrid` helper + `block()` exist):

```ts
  it('renders two overlapping blocks side-by-side at half width', () => {
    const day = new Date('2026-01-05T00:00:00.000Z').getTime();
    const blocks = [
      block({ id: 'o1', title: 'A', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z' }),
      block({ id: 'o2', title: 'B', startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z' }),
    ];
    renderGrid({ days: [day], blocks, events: [], nowMs: Date.parse('2026-01-05T08:00:00.000Z') });
    const tiles = screen.getAllByTestId('event-block');
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => /width:\s*calc\(50%/.test(t.getAttribute('style') || ''))).toBe(true);
  });
```

> Adjust `renderGrid` if it doesn't accept `events`/`nowMs` overrides — it does (it spreads `props`).

- [ ] **Step 2: Run — expect FAIL** (tiles are full width).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.**

**`EventBlock.tsx`** — drop the fixed sides from `BASE` and add lane props:
```ts
export const BASE = 'absolute overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';
```
Add `leftPct = 0` and `widthPct = 100` to `EventBlockProps` and the destructure, and apply them inline (merge with the existing `top`/`height`/accent style):
```tsx
      style={{ top: `${topPct}%`, height: `${heightPct}%`, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, ...accentStyles }}
```

**`InteractiveBlock.tsx`** — add `leftPct = 0` / `widthPct = 100` props (default in the destructure) and merge into its existing inline `style`:
```tsx
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${heightDelta}px)`, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, transform: `translate(${transformX}px, ${transformY}px)`, ...accentStyles }}
```
(The block had `left-0.5 right-0.5` only via `BASE`, which is now removed — so the inline `left`/`width` are the sole horizontal sizing. The `transform` translateX for cross-day drag is unchanged.)

**`WeekGrid.tsx`** — import `layoutOverlaps`; compute per day and pass the lane geometry:
```ts
import { layoutOverlaps } from './overlapLayout';
```
Inside the `days.map`, after computing `dayItems`:
```ts
              const lanes = layoutOverlaps(dayItems.map((it) => ({ key: it.key, startMs: it.startMs, endMs: it.endMs })));
```
In the `dayItems.map((it) => …)`, before rendering, compute:
```ts
                    const ln = lanes.get(it.key) ?? { lane: 0, lanes: 1 };
                    const leftPct = (ln.lane / ln.lanes) * 100;
                    const widthPct = (1 / ln.lanes) * 100;
```
Pass `leftPct={leftPct} widthPct={widthPct}` to BOTH the `<InteractiveBlock …>` and `<EventBlock …>` usages.

- [ ] **Step 4: Run — expect PASS** (new + existing WeekGrid/EventBlock/InteractiveBlock tests; single blocks stay full width via the 0/100 defaults).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx src/app/planner/EventBlock.test.tsx src/app/planner/InteractiveBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full web suite + build, then commit.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all pass; clean build.

```bash
git add packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "feat(web): render overlapping planner tiles in side-by-side lanes"
```

---

## Task 3: Verify & finish

- [ ] **Step 1: Full web suite + build.**
```bash
(cd packages/web && npm test)
npm run build
```
Expected: green; clean.

- [ ] **Step 2: Live-verify via geckodriver** (restart Vite with cleared cache first). Create two overlapping pinned task blocks in one day (e.g. via `POST /schedule` at 09:00–11:00 and 10:00–12:00 for a task), load the planner, and confirm they render **side-by-side at ~half width** (and a non-overlapping block stays full width). Clean up the test blocks afterward.

- [ ] **Step 3: Update memory** (`project-status.md` + `MEMORY.md`) with the Review 16b summary; note **16c (tame the extra-tile reconcile UX) is the last remaining sub-project**.

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review16b-overlap-layout` to `main`.

---

## Self-review notes (reconciled)
- **Spec coverage:** equal-lane algorithm + clusters (Task 1); WeekGrid per-day layout + tile leftPct/widthPct, BASE change (Task 2); verify (Task 3).
- **Compatibility:** default `leftPct=0`/`widthPct=100` reproduces today's full-width tile (`calc(0%+2px)` / `calc(100%-4px)` ≈ the old `left-0.5 right-0.5`), so single-block tests/visuals are unchanged.
- **Unchanged:** vertical placement, drag/resize (cross-day `transform` still uses full column width), timezone work.
