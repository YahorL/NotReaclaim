# Review 2 M-A: Planner Drag Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planner blocks draggable across days, snap fluidly to the 15-minute grid *while* dragging (with a live time label), and stop the visual jump on release.

**Architecture:** All in `packages/web`; no server/engine change. `weekModel.ts` gains three pure helpers (`minutesToPx`, `shiftDays`, `clampDayDelta`). `InteractiveBlock` previews snapped deltas (minutes/days) instead of raw pixels and commits day-shifted ISO timestamps; `WeekGrid` passes each block its `dayIndex`. `useUpdateScheduledBlockMutation` gets an optimistic cache update (guarding the non-array `schedulePreview` entry that shares the `['schedule']` root) so released blocks render at their new position instantly.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Tailwind, vitest + RTL (jsdom; `PointerEvent` polyfilled in `src/test/setup.ts`; web tests run with `TZ=UTC`).

**Branch:** `feat/review2-ma-drag-feel` off `main`. Spec: `docs/superpowers/specs/2026-06-09-notreclaim-review-2-design.md` (§M-A).

**Key constants (already in weekModel):** window 06:00–22:00 (960 min), `HOUR_ROW_PX=58`, `GRID_COLUMN_PX=928`, `snapMinutes(min, step=15)`, `pxToMinutes(px) = px/928*960`. So 15 min ⇄ 14.5 px and 60 min ⇄ 58 px exactly.

---

### Task 1: Branch + weekModel helpers (TDD)

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts`
- Test: `packages/web/src/app/planner/weekModel.test.ts`

- [ ] **Step 1: Create the milestone branch**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git checkout -b feat/review2-ma-drag-feel main
```

- [ ] **Step 2: Write the failing tests**

Append to `weekModel.test.ts` (it already imports from './weekModel'; extend the import list with `minutesToPx, shiftDays, clampDayDelta, pxToMinutes, GRID_COLUMN_PX`):

```ts
describe('minutesToPx', () => {
  it('is the inverse of pxToMinutes', () => {
    expect(minutesToPx(60)).toBeCloseTo(58);
    expect(minutesToPx(15)).toBeCloseTo(14.5);
    expect(pxToMinutes(minutesToPx(37))).toBeCloseTo(37);
    expect(minutesToPx(0)).toBe(0);
    expect(minutesToPx(-30)).toBeCloseTo(-29);
  });
});

describe('shiftDays', () => {
  const MON = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight under TZ=UTC
  it('shifts whole days preserving wall-clock time', () => {
    expect(shiftDays(MON, 1)).toBe(Date.parse('2026-01-06T00:00:00.000Z'));
    expect(shiftDays(MON, -2)).toBe(Date.parse('2026-01-03T00:00:00.000Z'));
    const nineFifteen = Date.parse('2026-01-05T09:15:00.000Z');
    expect(shiftDays(nineFifteen, 3)).toBe(Date.parse('2026-01-08T09:15:00.000Z'));
  });
  it('zero days is identity', () => {
    expect(shiftDays(MON, 0)).toBe(MON);
  });
});

describe('clampDayDelta', () => {
  it('keeps dayIndex+delta within the rendered week [0,6]', () => {
    expect(clampDayDelta(0, -3)).toBe(0);
    expect(clampDayDelta(0, 3)).toBe(3);
    expect(clampDayDelta(6, 3)).toBe(0);
    expect(clampDayDelta(6, -2)).toBe(-2);
    expect(clampDayDelta(3, 9)).toBe(3);
    expect(clampDayDelta(3, -9)).toBe(-3);
    expect(clampDayDelta(2, 0)).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/planner/weekModel.test.ts
```

Expected: FAIL — the three helpers don't exist.

- [ ] **Step 4: Implement the helpers**

Append to `weekModel.ts` (after `pxToMinutes`):

```ts
/** Convert a signed minute delta to a signed pixel delta within a day column (inverse of pxToMinutes). */
export function minutesToPx(min: number): number {
  return (min / (WINDOW_END_MIN - WINDOW_START_MIN)) * GRID_COLUMN_PX;
}

/** Shift a timestamp by whole days via local-date arithmetic (DST-safe; preserves wall-clock time). */
export function shiftDays(ms: number, days: number): number {
  if (days === 0) return ms;
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Clamp a horizontal day delta so dayIndex + delta stays within the rendered week (0..6). */
export function clampDayDelta(dayIndex: number, delta: number): number {
  return Math.max(-dayIndex, Math.min(6 - dayIndex, delta));
}
```

- [ ] **Step 5: Run to verify pass**

```bash
TZ=UTC npx vitest run src/app/planner/weekModel.test.ts
```

Expected: PASS (all weekModel tests).

- [ ] **Step 6: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): weekModel helpers for snapped drag previews and cross-day moves

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Live 15-min snapping + drag time label in InteractiveBlock (TDD)

**Files:**
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx`
- Test: `packages/web/src/app/planner/InteractiveBlock.test.tsx`

Behavior change: the preview transform/height use the SNAPPED minute delta converted back to px (block "ticks" along the grid), and while a non-zero preview is active the block shows a `drag-label` with the live start–end times. Commit semantics for vertical move/resize are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('InteractiveBlock', …)` block in `InteractiveBlock.test.tsx` (the file already defines `DAY`, `START`, `END`, `PX_PER_60MIN`, `renderBlock`):

```tsx
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('preview snaps to the 15-min grid while moving (sub-step drag → no offset)', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 107, pointerId: 1 }); // 7px ≈ 7.2min → snaps to 0
    expect(el.style.transform).toBe('translate(0px, 0px)');
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });

  it('preview ticks one 15-min step and shows the live time label', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 }); // 20px ≈ 20.7min → snaps to 15 → 14.5px
    expect(el.style.transform).toBe('translate(0px, 14.5px)');
    expect(screen.getByTestId('drag-label')).toHaveTextContent(
      `${fmt(START + 15 * 60_000)} – ${fmt(END + 15 * 60_000)}`,
    );
  });

  it('resize preview snaps and shows the live label with the start unchanged', () => {
    renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    const el = screen.getByTestId('event-block');
    expect(el.style.height).toBe('calc(5% + 58px)');
    expect(screen.getByTestId('drag-label')).toHaveTextContent(
      `${fmt(START)} – ${fmt(END + 60 * 60_000)}`,
    );
  });

  it('label disappears after release', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx
```

Expected: the new tests FAIL (transform is raw `translateY(20px)` style, no `drag-label`). The four pre-existing tests must still pass at this point — note the pre-existing move/zero-delta tests don't pass `clientX`; `e.clientX` is then `0`/undefined-coerced in jsdom, which the implementation must tolerate (treat non-finite as 0).

- [ ] **Step 3: Implement snapped preview + label**

Replace `InteractiveBlock.tsx` with (this also pre-plumbs `startXRef`/`colWidthRef`/`dayDelta` used by Task 3, but `dayIndex` is NOT yet a prop — horizontal logic stays inert because `colWidthRef` is 0 without measurement, added next task):

```tsx
import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow } from './weekModel';

const MIN_DURATION_MIN = 15;
const iso = (ms: number): string => new Date(ms).toISOString();
const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

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

type DragMode = 'move' | 'resize';

export function InteractiveBlock(props: InteractiveBlockProps) {
  // `id` is part of the props for the parent's onCommit binding; not read inside this component.
  const { dayStartMs, startMs, endMs, topPct, heightPct, startLabel, title, kind, pinned, onCommit } = props;
  // Refs hold the authoritative drag state; mutated directly so pointer handlers always
  // see the latest values regardless of React's batching/commit schedule.
  const modeRef = useRef<DragMode | null>(null);
  const startYRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const colWidthRef = useRef<number>(0);
  // State is used only to trigger re-renders for the snapped CSS preview.
  const [moveMin, setMoveMin] = useState(0);
  const [growMin, setGrowMin] = useState(0);

  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    }
    modeRef.current = mode;
    startYRef.current = finite(e.clientY);
    startXRef.current = finite(e.clientX);
  };

  const snappedDy = (clientY: number): number => snapMinutes(pxToMinutes(finite(clientY) - startYRef.current));

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!modeRef.current) return;
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setGrowMin(0); }
    else { setGrowMin(min); setMoveMin(0); }
  };

  const reset = () => {
    modeRef.current = null;
    startYRef.current = 0;
    startXRef.current = 0;
    colWidthRef.current = 0;
    setMoveMin(0);
    setGrowMin(0);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const deltaMin = snappedDy(e.clientY);
    const mode = modeRef.current;
    reset();
    if (!mode) return;
    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;
    if (mode === 'move') {
      if (deltaMin === 0) return;
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      onCommit({ startsAt: iso(dayStartMs + moved.startMin * 60_000), endsAt: iso(dayStartMs + moved.endMin * 60_000), pinned: true });
    } else {
      const newEndMin = Math.min(WINDOW_END_MIN, Math.max(startMin + MIN_DURATION_MIN, endMin + deltaMin));
      if (newEndMin === endMin) return;
      onCommit({ startsAt: iso(startMs), endsAt: iso(dayStartMs + newEndMin * 60_000), pinned: true });
    }
  };

  const onPointerCancel = () => { reset(); };

  const dragging = moveMin !== 0 || growMin !== 0;
  const previewStart = startMs + moveMin * 60_000;
  const previewEnd = growMin !== 0 ? endMs + growMin * 60_000 : endMs + moveMin * 60_000;

  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`${BASE} ${dragging ? 'cursor-grabbing' : 'cursor-grab'} select-none ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${minutesToPx(growMin)}px)`, transform: `translate(0px, ${minutesToPx(moveMin)}px)` }}
    >
      {pinned && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
      {dragging && (
        <span data-testid="drag-label" className="absolute right-1 top-0.5 rounded bg-ink/70 px-1 text-[10px] font-semibold text-white">
          {fmtTime(previewStart)} – {fmtTime(previewEnd)}
        </span>
      )}
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
    </div>
  );
}
```

Notes: `transform` is now always `translate(0px, Npx)` (two-axis form, ready for Task 3); the pre-existing tests assert `onCommit` args only, so they keep passing. `bg-ink/70` is valid — `ink` is a hex token, Tailwind generates the opacity-modified utility.

- [ ] **Step 4: Run to verify pass**

```bash
TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx
```

Expected: ALL InteractiveBlock tests pass (4 old + 4 new).

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx
git commit -m "feat(web): planner blocks snap to the 15-min grid live while dragging

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Cross-day move (TDD)

**Files:**
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx`
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (one prop)
- Test: `packages/web/src/app/planner/InteractiveBlock.test.tsx`

`InteractiveBlock` gains a required `dayIndex: number` prop (0=Mon..6=Sun). On pointer-down in move mode it measures the day-column width from `e.currentTarget.parentElement` (the `day-col-i` div); during move it previews `translate(dayDelta*colWidth px, snappedY px)` with `dayDelta = clampDayDelta(dayIndex, Math.round(dx/colWidth))`; on release it shifts the committed timestamps by `dayDelta` whole days via `shiftDays`. When the column width can't be measured (jsdom default: 0) the horizontal axis is inert.

- [ ] **Step 1: Write the failing tests**

In `InteractiveBlock.test.tsx`: first add `dayIndex={0}` to the existing `renderBlock` helper's JSX (compile-fix for the new required prop), then add a new describe block. New helper + tests:

```tsx
function renderBlockInColumn(onCommit = vi.fn(), dayIndex = 0, colWidth = 120) {
  const { container } = render(
    <div>
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={dayIndex} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={onCommit}
      />
    </div>,
  );
  const column = container.firstChild as HTMLElement;
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ width: colWidth, height: 928, top: 0, left: 0, right: colWidth, bottom: 928, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  return onCommit;
}

describe('InteractiveBlock cross-day move', () => {
  it('previews a one-column shift and commits +1 day', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 230, clientY: 100, pointerId: 1 }); // dx=130 → round(130/120)=1
    expect(el.style.transform).toBe('translate(120px, 0px)');
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true,
    });
  });

  it('combines a day shift with a snapped vertical move', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-06T10:00:00.000Z', endsAt: '2026-01-06T11:00:00.000Z', pinned: true,
    });
  });

  it('clamps the day delta at the week edge (Sunday cannot go right)', () => {
    const onCommit = renderBlockInColumn(vi.fn(), 6);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(el.style.transform).toBe('translate(0px, 0px)');
    fireEvent.pointerUp(el, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled(); // day clamped to 0 + no vertical delta = no-op
  });

  it('a pure day shift with zero vertical delta still commits', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 100 - 130, clientY: 100, pointerId: 1 }); // one column left… but dayIndex=0
    expect(onCommit).not.toHaveBeenCalled(); // clamped: Monday cannot go left
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/app/planner/InteractiveBlock.test.tsx
```

Expected: compile error (`dayIndex` not a prop) and/or new tests FAIL.

- [ ] **Step 3: Implement**

In `InteractiveBlock.tsx`:

1. Import the new helpers: `import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta } from './weekModel';`
2. Add `dayIndex: number;` to `InteractiveBlockProps` and destructure it.
3. Add a `[dayDelta, setDayDelta]` state (number, default 0); reset it in `reset()`.
4. In `begin('move')` measure the column: after setting `startXRef`, add

```ts
    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;
```

5. Add a helper next to `snappedDy`:

```ts
  const snappedDx = (clientX: number): number => {
    const w = colWidthRef.current;
    if (w <= 0) return 0;
    return clampDayDelta(dayIndex, Math.round((finite(clientX) - startXRef.current) / w));
  };
```

6. In `onPointerMove` (move branch): `setDayDelta(snappedDx(e.clientX));` (resize branch: `setDayDelta(0);`).
7. In `onPointerUp`, capture the column width BEFORE `reset()` (reset zeroes the ref) and compute both deltas:

```ts
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const deltaMin = snappedDy(e.clientY);
    const deltaDays = modeRef.current === 'move' ? snappedDx(e.clientX) : 0;
    const mode = modeRef.current;
    reset();
    if (!mode) return;
    const startMin = (startMs - dayStartMs) / 60_000;
    const endMin = (endMs - dayStartMs) / 60_000;
    if (mode === 'move') {
      if (deltaMin === 0 && deltaDays === 0) return;
      const moved = clampToWindow(startMin + deltaMin, endMin - startMin);
      const dayStart = shiftDays(dayStartMs, deltaDays);
      onCommit({ startsAt: iso(dayStart + moved.startMin * 60_000), endsAt: iso(dayStart + moved.endMin * 60_000), pinned: true });
    } else { /* resize branch unchanged */ }
  };
```

8. Preview: `dragging` becomes `moveMin !== 0 || growMin !== 0 || dayDelta !== 0`; transform becomes

```ts
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${minutesToPx(growMin)}px)`, transform: `translate(${dayDelta * colWidthRef.current}px, ${minutesToPx(moveMin)}px)` }}
```

(the label's `previewStart/previewEnd` stay time-of-day only — the horizontal position communicates the day).

In `WeekGrid.tsx`: pass `dayIndex={i}` where `<InteractiveBlock` is rendered (the day-columns `days.map((d, i) => …)` loop).

- [ ] **Step 4: Run to verify pass + full planner suite**

```bash
TZ=UTC npx vitest run src/app/planner/
```

Expected: all planner tests pass (weekModel, EventBlock, InteractiveBlock old+new, WeekGrid, AtRiskPanel).

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx packages/web/src/app/planner/WeekGrid.tsx
git commit -m "feat(web): drag planner blocks across days

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Optimistic update on block commit (TDD)

**Files:**
- Modify: `packages/web/src/api/queries.ts` (only `useUpdateScheduledBlockMutation`)
- Test: `packages/web/src/api/queries.test.tsx`

Fixes the release "jump": today the preview resets on pointer-up and the block renders at its OLD position until the refetch lands. The mutation gets an `onMutate` optimistic patch of every cached `['schedule', …]` LIST (the `['schedule','preview']` entry shares the root but holds a non-array `SchedulePreview` — it must pass through untouched), rollback `onError`, invalidate `onSettled`.

- [ ] **Step 1: Write the failing tests**

Append to `queries.test.tsx` (the file already has `wrap()` returning `{ Wrapper, qc }`, `fakeApiClient`, `renderHook`, `waitFor`, `vi`):

```tsx
describe('useUpdateScheduledBlockMutation optimistic update', () => {
  const block = { id: 'b1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z', pinned: false };
  const patch = { startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true };
  const preview = { blocks: [], unscheduled: [] };

  it('patches cached schedule lists immediately, leaves the preview entry alone, invalidates on settle', async () => {
    let resolveReq!: (v: unknown) => void;
    const updateScheduledBlock = vi.fn(() => new Promise((res) => { resolveReq = res; }));
    const api = fakeApiClient({ updateScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block]);
    qc.setQueryData(queryKeys.schedulePreview(), preview);
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch });
    await waitFor(() => {
      const cached = qc.getQueryData<(typeof block)[]>(queryKeys.schedule('a', 'b'))!;
      expect(cached[0]).toEqual({ ...block, ...patch });
    });
    expect(qc.getQueryData(queryKeys.schedulePreview())).toEqual(preview); // non-array entry untouched
    resolveReq({ ...block, ...patch });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the cache back when the request fails', async () => {
    const updateScheduledBlock = vi.fn(async () => { throw new Error('500'); });
    const api = fakeApiClient({ updateScheduledBlock } as never);
    const { Wrapper, qc } = wrap(api);
    qc.setQueryData(queryKeys.schedule('a', 'b'), [block]);
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(queryKeys.schedule('a', 'b'))).toEqual([block]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/nyx-ai/Projects/NotReclaim/packages/web
TZ=UTC npx vitest run src/api/queries.test.tsx
```

Expected: first test FAILS (cache only updates after invalidation/refetch — with the unresolved promise it never reaches the patched state, the waitFor times out). Second test fails on the rollback assertion only if onMutate exists without rollback — initially it passes trivially; that's fine, it guards the implementation.

- [ ] **Step 3: Implement**

Replace `useUpdateScheduledBlockMutation` in `queries.ts`:

```ts
export function useUpdateScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateScheduledBlockInput }) => api.updateScheduledBlock(id, patch),
    // Optimistic: patch every cached schedule LIST so the released block renders in place
    // immediately. The preview entry (['schedule','preview']) shares the root but holds a
    // non-array SchedulePreview — the Array.isArray guard passes it through untouched.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.scheduleRoot });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot });
      qc.setQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot }, (old) =>
        Array.isArray(old) ? old.map((b) => (b.id === id ? { ...b, ...patch } : b)) : old,
      );
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}
```

- [ ] **Step 4: Run to verify pass, then the whole web suite + typecheck**

```bash
TZ=UTC npx vitest run src/api/queries.test.tsx
npm test
npx tsc -p tsconfig.json --noEmit
```

Expected: queries tests pass; full web suite green (202 + 10 new across tasks = ~212); typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/nyx-ai/Projects/NotReclaim
git add packages/web/src/api/queries.ts packages/web/src/api/queries.test.tsx
git commit -m "fix(web): optimistic schedule-cache update on block move/resize (no release jump)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full suite + live verification + merge

- [ ] **Step 1: Run the whole monorepo suite**

```bash
cd /home/nyx-ai/Projects/NotReclaim
npm test
```

Expected: all workspaces green (441 baseline + ~10 new web = ~451).

- [ ] **Step 2: Verify live**

In the running app's Planner: drag a block — it should tick along 15-min steps with a live time label, move across day columns, and stay put on release (no jump). Resize the bottom edge similarly.

- [ ] **Step 3: Hand off to finishing-a-development-branch**

Merge `feat/review2-ma-drag-feel` into `main` per the superpowers:finishing-a-development-branch skill (suite green on merged main, delete branch).
