# Mobile Phase 3 — dnd-kit Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all four HTML5-DnD surfaces (priorities board, card subtasks, drawer subtasks, drag-to-schedule) onto `dnd-kit`, so every reorder and the task→calendar drag work identically on a mouse, on touch, and — for the sortable lists — from the keyboard. Desktop feel is preserved or improved: clicks that open drawers/popovers keep working, the drop targets and persistence payloads are unchanged, and the last of the native `dataTransfer` machinery leaves the codebase. On the compact layout a drag that starts inside the Tasks bottom sheet slides the sheet down to a slim strip for the drag's duration so the grid is visible and droppable, then restores.

**Architecture:**

- **One shared sensor module** — `src/app/dnd/sensors.ts` exports `useAppSensors()` (sortable lists: mouse + touch + keyboard) and `useDragToScheduleSensors()` (planner: mouse + touch only), plus the two activation constants and a `pointerFirstCollision` collision-detection strategy. **`MouseSensor` is deliberately used instead of `PointerSensor`:** a `PointerSensor` receives touch input too, so a `{distance: 4}` constraint on it would steal every touch scroll. `MouseSensor` (`onMouseDown`) + `TouchSensor` (`onTouchStart`) split the two inputs at the event level — strictly better than a `matchMedia` switch, because a hybrid laptop gets the right behaviour per gesture rather than per device. No `touch-action` is set on sortable items: the touch sensor's `{delay: 250, tolerance: 8}` constraint is dnd-kit's documented way to let a scroll stay a scroll (movement past the tolerance before the delay elapses cancels the pending drag).
- **Four `DndContext` instances, deliberately not one.** `Board` owns the priorities board; `TaskRow` owns its own card-subtask list; `TaskDrawer` owns its drawer-subtask list; `Planner` owns drag-to-schedule. The `TaskRow` context is *nested* inside the `Board` context. This is safe and is verified in `@dnd-kit/core@6.3.1` source: `bindActivatorToSensorInstantiator` stamps `nativeEvent.dndKit = {capturedBy}` on the **native** event when a sensor captures it, and bails on any later activator that sees that flag. React synthetic events bubble innermost-first, so a press on a subtask is captured by the subtask's sensor and the enclosing card's sortable activator declines. That replaces the hand-rolled `e.stopPropagation()` guards exactly.
- **Every drag *decision* is a pure module** — `priorities/boardDnd.ts` (`resolveBoardDrop`, `overColumnKey`, `taskMovePatch`), `tasks/subtaskDnd.ts` (`subtaskDropSortOrder`), `planner/scheduleDrop.ts` (`pointerClientY`, `dayDropFromOver`, `draggedTaskId`, `pinnedBlockTimes`), `planner/dragSheet.ts` (`shouldCollapseSheet`). jsdom cannot produce a real dnd-kit gesture, so the pure modules carry the arithmetic tests and the component tests assert wiring (rendered attributes, testids, props). Real gesture verification lives in the live-check gate. This is the Phase-2 pattern, unchanged.
- **`resolveBoardDrop` reads ids, not dnd-kit data.** Column droppables are `col:<columnKey>`, card sortables are the bare task id, so the whole drop resolution is `(columns, activeId, overId) → {taskId, to, index}` over plain values — no dnd-kit types in the pure layer.
- **The FLIP *drag* path retires; `useFlip` stays.** dnd-kit's sorting strategy animates the moving card and the gap during the drag, so `Column`'s `InsertGap`, `Board`'s `drag` state and `ColumnDnd` all go. `useFlip` keeps animating **server-driven** re-sorts (the list only changes after the `sortOrder` PATCH round-trips — there is no optimistic cache write on `useUpdateTaskMutation`). To keep a single owner of that animation, `TaskRow`'s `useSortable` is given `animateLayoutChanges: () => false`.
- **Day columns become droppables without restructuring `WeekGrid`.** Hooks cannot be called in the `days.map` loop, and extracting the ~120-line column body into a child component would be a large unrelated refactor. Instead each column renders a `<DayDropZone>` child: `pointer-events-none absolute inset-0`, which registers `useDroppable` and whose rect is *exactly* the column's padding box (the column has only a `border-l`, no vertical borders — the same box the old `slotFromEvent` measured). dnd-kit's collision detection is rect maths, not DOM hit-testing, so `pointer-events-none` costs nothing and the column's own `onClick` (CreatePopover) and taps keep working untouched — better than putting a sensor on the column.
- **The drop slot is computed from `activatorEvent + delta` against `over.rect`, and that is exact under scrolling.** dnd-kit exposes no live pointer on its events, so the pointer is reconstructed as `getEventCoordinates(activatorEvent).y + delta.y`. Verified in 6.3.1 source: `delta` is `scrollAdjustedTranslate`, i.e. the pure pointer translate **plus** any scroll that happened mid-drag; and `over.rect` comes from `droppableRects`, measured once at drag start under the default `MeasuringStrategy.WhileDragging` and *not* re-measured on scroll. If the hours-scroll container scrolls by `S`, the reconstructed pointer is `S` too high **and** the stale rect top is `S` too low — the two errors cancel exactly, so the offset into the column is correct. This is why the plan must **not** set `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` on the planner context: re-measuring would break the cancellation and make the indicator drift during edge auto-scroll.

**Tech Stack:** React 18.3.1 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite 5, Tailwind v3.4.x (literal utility strings only; `calc()` in an arbitrary value needs `_` for its spaces, e.g. `translate-y-[calc(100%_-_56px)]`), TanStack Query v5, react-router-dom v6, vitest 1.6 + jsdom 24 + @testing-library/react v16.

New dependencies, **pinned to the latest stable releases** (verified against the npm registry on 2026-08-27; installed with the repo's caret convention so `package.json` records `^`):

| package | version | why this one |
| --- | --- | --- |
| `@dnd-kit/core` | **6.3.1** | Latest stable of the React-hooks line (`DndContext`/`useDraggable`/`useDroppable`/sensors). The `@dnd-kit/dom` + `@dnd-kit/react` v2 rewrite is a different, still-prerelease package family with an incompatible API — do **not** install it. |
| `@dnd-kit/sortable` | **10.0.0** | Latest stable; peer-requires `@dnd-kit/core@^6.3.0`, satisfied by 6.3.1. (The 8.x/9.x lines pair with core 6.0.x/6.2.x.) |
| `@dnd-kit/utilities` | **3.2.2** | Latest stable; `CSS.Transform.toString` is required by every `useSortable` consumer and `getEventCoordinates` by `scheduleDrop.ts`. Core and sortable already depend on it transitively — declaring it directly makes the import legal rather than a phantom dependency. |

`@dnd-kit/accessibility@3.1.1` arrives transitively via core; it is not declared. All three peer-require `react >= 16.8`, satisfied by 18.3.1. None declares an `exports` map; Vite/vitest resolve the `module` ESM build and `tsc` resolves `dist/index.d.ts` next to `main`. All observer usage (`ResizeObserver`, `MutationObserver`) is guarded by `typeof window.X === 'undefined'`, so **jsdom needs no new polyfill** and `src/test/setup.ts` is not touched.

**Spec:** docs/superpowers/specs/2026-08-25-mobile-adaptation-design.md — section 3 "DnD migration to dnd-kit" in full (all four migrations, the shared sensor config, the mobile sheet-collapse wrinkle, the CLAUDE.md convention change), plus the Phase-3 line of the §5 phase list and the §5 risk note that sequences the board after the simpler surfaces.

## Global Constraints

- Web suite **baseline: 589 tests / 66 files green** (`npm test -w @notreclaim/web`, verified 2026-08-27 on `main` at `e67f218`). It must be green after **every** task; the expected count is stated per task. Final expected: **637 tests / 71 files**. The per-task arithmetic: 589 → **597** (T1, +8) → **603** (T2, +6) → **602** (T3, +2 −4 +2 −1) → **618** (T4, +21 +1 +1 −7) → **630** (T5, +13 −1) → **637** (T6, +5 +2) → 637 (T7, docs only).
- Tests run under `TZ=UTC` via the package `test` script — never bypass it.
- **This phase edits pre-existing tests** (unlike Phase 2). That is expected — the deleted tests fire synthetic HTML5 drag events at machinery that no longer exists. **Discipline:** every such edit is listed explicitly, by file and by test name, in the step that makes it; no task may delete or rewrite a test that is not named in its own step list; a deleted assertion must reappear either as a pure test with the *same numbers* or as a documented semantic change. The complete ledger:

  | file | deleted | rewritten in place | added | task |
  | --- | --- | --- | --- | --- |
  | `app/tasks/TaskDrawer.test.tsx` | 2 | 0 | 2 | 2 |
  | `app/priorities/TaskRow.test.tsx` | 4 | 0 | 3 (2 in Task 3, 1 in Task 4) | 3, 4 |
  | `app/pages/Priorities.test.tsx` | 1 (Task 3) + 7 (Task 4) | 0 | 1 | 3, 4 |
  | `app/planner/WeekGrid.test.tsx` | 2 | 0 | 2 | 5 |
  | `app/planner/PlannerTaskPanel.test.tsx` | 0 | 1 | 0 | 5 |
  | `app/pages/Planner.test.tsx` | 1 | 0 | 0 | 5 |
  | `app/components/Sheet.test.tsx` | 0 | 0 | 2 | 6 |
  | **total** | **17** | **1** | **10** | |

  Resulting per-file counts, for checking against a run: `TaskDrawer.test.tsx` 14 (was 14), `TaskRow.test.tsx` 11 (was 12), `Priorities.test.tsx` 14 (was 21), `WeekGrid.test.tsx` unchanged, `PlannerTaskPanel.test.tsx` unchanged, `Planner.test.tsx` one fewer, `Sheet.test.tsx` 6 (was 4).

  Plus one non-test helper edit: `renderRow` in `TaskRow.test.tsx` loses the `dragging` / `onDragStart` / `onDragEnd` props (Task 4).
- **Exactly one behavioural value changes, and it is deliberate.** Under HTML5 the semantics were "insert *above* the row you are hovering" (jsdom's zero-height rects made every hover read as the top half). Under dnd-kit + `arrayMove` the semantics are "land *where the preview shows you*", so a **downward** drag lands *after* the hovered item. Upward drags are unchanged and every old expected value for them is preserved verbatim. Three old expectations move:
  - `Priorities.test.tsx` "drags the first task DOWN within a column" — `sortOrder` `2.5` → **`4`** (ported to `boardDnd.test.ts`).
  - `TaskRow.test.tsx` "dragging first subtask downward" — `25` → **`31`** (ported to `subtaskDnd.test.ts`).
  - `TaskDrawer.test.tsx` "drag first subtask below second" — `0` → **`2`** (ported to `subtaskDnd.test.ts`).
- **Persistence payloads are otherwise byte-identical.** The board still PATCHes `{sortOrder}` / `{priority, sortOrder}` / `{status:'backlog', sortOrder}` / `{status:'pending', priority, sortOrder}` via `useUpdateTaskMutation`; subtasks still PATCH `{sortOrder}` via `useUpdateSubtaskMutation`; drag-to-schedule still POSTs via `useCreateScheduledBlockMutation`. **No new optimistic cache writes and none removed** — note that `useUpdateTaskMutation` / `useUpdateSubtaskMutation` have *no* `onMutate`; they invalidate on success. (The brief's phrase "optimistic commit" describes the *visual* in-drag reflow, which dnd-kit now owns; the data path stays invalidate-on-success. Do not add `onMutate` in this phase.)
- **Keyboard drag-to-schedule is out of scope.** Sortable lists get keyboard reordering for free via `KeyboardSensor` + `sortableKeyboardCoordinates`; day columns have no keyboard coordinate story and none is invented. `useDragToScheduleSensors()` therefore omits `KeyboardSensor` on purpose.
- Tailwind v3 **literal utility class strings only** — never compute a class name. Every conditional below picks between two whole literal strings.
- `packages/web` imports are **extensionless** and never `import React` (automatic JSX runtime; named hook imports are fine).
- jsdom does **not** evaluate Tailwind CSS or media queries, and `getBoundingClientRect` returns all zeros. Assert **class presence/absence**, attributes and testids; never assert "not visible" and never rely on measured geometry in a component test.
- **No synthetic dnd-kit gestures in tests.** Do not `fireEvent.mouseDown` + `mouseMove` + `mouseUp` at a sortable and assert a PATCH — dnd-kit needs real rects and a real rAF/measuring cycle. Pure modules + wiring assertions + the live-check gate, per spec §5.
- TypeScript is strict with `noUncheckedIndexedAccess`: index accesses in test code need `!`. Test files are type-checked by `npm run build -w @notreclaim/web`.
- Never run branch-switching or history-rewriting git commands (`checkout`/`switch`/`restore`/`reset`/`stash`). `git add <explicit paths>` only — the working tree contains untracked local-only files (`seed-dev.mjs`, `review/`, `*.tsbuildinfo`) that must never be committed. `package-lock.json` **is** committed (Task 1).
- Every commit message ends with the trailer line `Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828`.
- **Task order is load-bearing.** Card subtasks (Task 3) must land **before** the board (Task 4). While the card is still natively `draggable`, a dnd-kit press on a subtask instantiates its sensor, whose `attach()` adds a window `dragstart` → `preventDefault` listener that suppresses the card's native drag — so both work during the gap. Reversing the order would leave card-subtask reorder broken for one commit.
- **Out of scope for this phase (do not touch):** `InteractiveBlock`'s pointer-event drag/resize (it stays raw pointer events — that is the whole point of the convention change); `TaskDrawer`/`EventDrawer`/`HabitDrawer`/`NewTaskModal` full-screen sheets, the `coarse:` Tailwind variant, `useClickOutside` `mousedown`→`pointerdown`, `overscroll-behavior` base CSS (all Phase 4).

---

## Task 1 — dnd-kit dependencies + the shared sensor / collision module

**Files:**
- Modify: `packages/web/package.json` (via `npm install`)
- Modify: `package-lock.json` (via `npm install`)
- Create: `packages/web/src/app/dnd/sensors.ts`
- Create (test): `packages/web/src/app/dnd/sensors.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/dnd/sensors.ts`:
  - `export const FINE_DRAG_ACTIVATION: { distance: number }` — `{ distance: 4 }`
  - `export const COARSE_DRAG_ACTIVATION: { delay: number; tolerance: number }` — `{ delay: 250, tolerance: 8 }`
  - `export function useAppSensors(): SensorDescriptor<SensorOptions>[]`
  - `export function useDragToScheduleSensors(): SensorDescriptor<SensorOptions>[]`
  - `export const pointerFirstCollision: CollisionDetection`
- Consumes: `@dnd-kit/core`, `@dnd-kit/sortable`.
- No component consumes this yet — Tasks 2–6 do.

**Steps:**

- [ ] Install the three packages from the repo root:

```sh
npm install -w @notreclaim/web @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
```

- [ ] Confirm the install resolved as expected. Run:

```sh
node -e "const p=require('./packages/web/package.json');console.log(p.dependencies['@dnd-kit/core'],p.dependencies['@dnd-kit/sortable'],p.dependencies['@dnd-kit/utilities'])"
npm ls @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities -w @notreclaim/web
```

  Expected: `^6.3.1 ^10.0.0 ^3.2.2`, and `npm ls` shows `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` with **no** `UNMET PEER DEPENDENCY` line.

- [ ] Write the failing test `packages/web/src/app/dnd/sensors.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MouseSensor, TouchSensor, KeyboardSensor, type ClientRect } from '@dnd-kit/core';
import {
  useAppSensors, useDragToScheduleSensors, pointerFirstCollision,
  FINE_DRAG_ACTIVATION, COARSE_DRAG_ACTIVATION,
} from './sensors';

const rect = (top: number, left: number, height: number, width: number): ClientRect => ({
  top, left, height, width, right: left + width, bottom: top + height,
});

/**
 * Both strategies read only `collisionRect`, `droppableRects`, `droppableContainers[].id` and
 * `pointerCoordinates`; the rest of the args object is never touched, so one cast at the boundary
 * keeps the fixture honest and small.
 */
type CollisionArgs = Parameters<typeof pointerFirstCollision>[0];

function collisionArgs(pointer: { x: number; y: number } | null): CollisionArgs {
  const rects = new Map<string, ClientRect>([
    ['column', rect(0, 0, 600, 300)],
    ['card', rect(200, 0, 60, 300)],
  ]);
  return {
    active: { id: 'a', data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(1000, 1000, 60, 300), // far away: closestCenter must not tie with pointerWithin
    droppableRects: rects,
    droppableContainers: [
      { id: 'column', key: 'column', data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: rects.get('column')! } },
      { id: 'card', key: 'card', data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: rects.get('card')! } },
    ],
    pointerCoordinates: pointer,
  } as unknown as CollisionArgs;
}

describe('drag activation constants', () => {
  it('fine pointers need a small movement so a click stays a click', () => {
    expect(FINE_DRAG_ACTIVATION).toEqual({ distance: 4 });
  });

  it('coarse pointers need a hold so a scroll stays a scroll', () => {
    expect(COARSE_DRAG_ACTIVATION).toEqual({ delay: 250, tolerance: 8 });
  });
});

describe('useAppSensors', () => {
  it('registers mouse, touch and keyboard sensors with the shared constraints', () => {
    const { result } = renderHook(() => useAppSensors());
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
    expect(result.current[0]!.options).toEqual({ activationConstraint: FINE_DRAG_ACTIVATION });
    expect(result.current[1]!.options).toEqual({ activationConstraint: COARSE_DRAG_ACTIVATION });
  });

  it('gives the keyboard sensor the sortable coordinate getter', () => {
    const { result } = renderHook(() => useAppSensors());
    expect(typeof (result.current[2]!.options as { coordinateGetter?: unknown }).coordinateGetter).toBe('function');
  });
});

describe('useDragToScheduleSensors', () => {
  it('omits the keyboard sensor — day columns have no keyboard coordinate story', () => {
    const { result } = renderHook(() => useDragToScheduleSensors());
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor]);
  });
});

describe('pointerFirstCollision', () => {
  it('prefers the smallest droppable under the pointer', () => {
    const hits = pointerFirstCollision(collisionArgs({ x: 150, y: 230 }));
    expect(hits[0]!.id).toBe('card'); // inside both; the card's corners are nearer
  });

  it('returns only the enclosing container when the pointer is in its empty area', () => {
    const hits = pointerFirstCollision(collisionArgs({ x: 150, y: 500 }));
    expect(hits.map((h) => h.id)).toEqual(['column']);
  });

  it('falls back to closestCenter when there are no pointer coordinates (keyboard drags)', () => {
    const hits = pointerFirstCollision(collisionArgs(null));
    expect(hits.length).toBe(2); // pointerWithin would have returned []
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/dnd/sensors.test.tsx`. Expected failure: `Failed to resolve import "./sensors"`.

- [ ] Create `packages/web/src/app/dnd/sensors.ts` with exactly:

```ts
import {
  KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Fine pointers (mouse/trackpad/pen): a few pixels of travel before a press becomes a drag, so a
 * plain click still opens the drawer / popover it always did.
 */
export const FINE_DRAG_ACTIVATION = { distance: 4 };

/**
 * Coarse pointers: a short hold before a press becomes a drag, and a movement tolerance that
 * cancels the pending drag if the finger travels first — so a flick stays a scroll. This is the
 * same idiom the planner's own long-press uses, and it is why no `touch-action` is needed on
 * sortable items (setting `touch-none` would kill the board's horizontal scroll).
 */
export const COARSE_DRAG_ACTIVATION = { delay: 250, tolerance: 8 };

/**
 * Shared sensors for the sortable surfaces (priorities board, card subtasks, drawer subtasks).
 *
 * `MouseSensor` rather than `PointerSensor` on purpose: a pointer sensor also receives touch
 * input, so its distance constraint would steal every touch scroll. Splitting mouse (onMouseDown)
 * from touch (onTouchStart) picks the right constraint per gesture rather than per device.
 */
export function useAppSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: FINE_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: COARSE_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/**
 * Sensors for drag-to-schedule. Same two pointer sensors, no keyboard sensor: a day column is a
 * continuous 24-hour surface with no discrete keyboard coordinates, and inventing one is out of
 * scope (spec section 3 covers list reordering only).
 */
export function useDragToScheduleSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: FINE_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: COARSE_DRAG_ACTIVATION }),
  );
}

/**
 * Pointer-first collision detection with a centre-distance fallback.
 *
 * `pointerWithin` is what nested targets want: hovering a card inside a column returns both, sorted
 * by distance from the pointer to the rect corners, so the small card wins and the tall column only
 * wins in its own empty area — exactly the old dragover/`stopPropagation` layering. But it returns
 * nothing without pointer coordinates, which is every keyboard drag, so fall back to `closestCenter`.
 */
export const pointerFirstCollision: CollisionDetection = (args) => {
  const withinPointer = pointerWithin(args);
  return withinPointer.length > 0 ? withinPointer : closestCenter(args);
};
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/dnd/sensors.test.tsx`. Expected: 8 tests pass.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **597 passed (597), 67 files** — nothing consumes the module yet.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Commit:

```sh
git add package-lock.json packages/web/package.json packages/web/src/app/dnd/sensors.ts packages/web/src/app/dnd/sensors.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add dnd-kit and the shared sensor/collision module

@dnd-kit/core 6.3.1 + @dnd-kit/sortable 10.0.0 + @dnd-kit/utilities 3.2.2.

useAppSensors (mouse 4px / touch 250ms+8px / keyboard) for the sortable
surfaces and useDragToScheduleSensors (no keyboard) for the planner, plus a
pointerWithin-then-closestCenter collision strategy. MouseSensor rather than
PointerSensor so a touch scroll is never stolen by a distance constraint.

No consumers yet.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 2 — Drawer subtask reorder on dnd-kit (proves the pattern)

The smallest surface: `TaskDrawer` owns its own `DndContext`, so it works standalone (which is how its tests render it).

**Files:**
- Create: `packages/web/src/app/tasks/subtaskDnd.ts`
- Create (test): `packages/web/src/app/tasks/subtaskDnd.test.ts`
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`
- Modify (test, 2 deletions + 2 additions): `packages/web/src/app/tasks/TaskDrawer.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/tasks/subtaskDnd.ts`:
  - `export interface SortOrdered { id: string; sortOrder: number }`
  - `export function subtaskDropSortOrder<T extends SortOrdered>(items: T[], activeId: string, overId: string): number | null`
- Consumes: `arrayMove` from `@dnd-kit/sortable`, `insertionSortOrder` from `../priorities/priorityBucket`.

**Steps:**

- [ ] Write the failing test `packages/web/src/app/tasks/subtaskDnd.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { subtaskDropSortOrder } from './subtaskDnd';

const two = [
  { id: 's1', sortOrder: 0 },
  { id: 's2', sortOrder: 1 },
];

describe('subtaskDropSortOrder', () => {
  it('dragging the last item onto the first lands above it', () => {
    // Ported verbatim from the deleted TaskDrawer HTML5 test: s2 above s1 => 0 - 1 = -1.
    expect(subtaskDropSortOrder(two, 's2', 's1')).toBe(-1);
  });

  it('dragging the first item onto the second lands BELOW it', () => {
    // Semantic change from the HTML5 path (which said 0): arrayMove puts the dragged item where
    // the live preview showed it, so a downward drag lands after the hovered row => 1 + 1 = 2.
    expect(subtaskDropSortOrder(two, 's1', 's2')).toBe(2);
  });

  it('landing between two items takes the midpoint', () => {
    const three = [
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ];
    // c upward onto b => lands above b, between a(10) and b(20).
    expect(subtaskDropSortOrder(three, 'c', 'b')).toBe(15);
  });

  it('returns null when the item is dropped on itself', () => {
    expect(subtaskDropSortOrder(two, 's1', 's1')).toBeNull();
  });

  it('returns null for an unknown active or over id', () => {
    expect(subtaskDropSortOrder(two, 'nope', 's1')).toBeNull();
    expect(subtaskDropSortOrder(two, 's1', 'nope')).toBeNull();
  });

  it('returns null for a single-item list', () => {
    expect(subtaskDropSortOrder([{ id: 'only', sortOrder: 3 }], 'only', 'only')).toBeNull();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/tasks/subtaskDnd.test.ts`. Expected failure: `Failed to resolve import "./subtaskDnd"`.

- [ ] Create `packages/web/src/app/tasks/subtaskDnd.ts` with exactly:

```ts
import { arrayMove } from '@dnd-kit/sortable';
import { insertionSortOrder } from '../priorities/priorityBucket';

export interface SortOrdered {
  id: string;
  sortOrder: number;
}

/**
 * The `sortOrder` to PATCH after a sortable drop, or null when nothing moved.
 *
 * Semantics follow dnd-kit rather than the old HTML5 handlers: the dragged item lands exactly
 * where the live preview put it (`arrayMove(from, to)`), so an upward drag lands above the hovered
 * row and a downward drag lands below it. The value itself is the midpoint of the item's new
 * neighbours, which keeps the existing sparse-`sortOrder` scheme and its server contract intact.
 */
export function subtaskDropSortOrder<T extends SortOrdered>(
  items: T[],
  activeId: string,
  overId: string,
): number | null {
  const from = items.findIndex((i) => i.id === activeId);
  const to = items.findIndex((i) => i.id === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const moved = arrayMove(items, from, to);
  const at = moved.findIndex((i) => i.id === activeId);
  // Removing the dragged item shifts everything after it left by one, so its index in `moved` is
  // also its insertion index among the remaining items.
  const others = moved.filter((i) => i.id !== activeId);
  return insertionSortOrder(others, at);
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/tasks/subtaskDnd.test.ts`. Expected: 6 tests pass.

- [ ] **Delete both pre-existing HTML5 tests** from `packages/web/src/app/tasks/TaskDrawer.test.tsx`. Remove the entire final `describe` block, i.e. everything from `describe('TaskDrawer subtask drag-reorder', () => {` through its closing `});` at the end of the file — the two tests named *"drag last subtask above first → PATCH sortOrder = first.sortOrder - 1"* and *"drag first subtask below second (downward) → midpoint of remaining neighbors (off-by-one guard)"*. Their arithmetic now lives in `subtaskDnd.test.ts` (the first with the same value `-1`, the second with the corrected value `2`).

- [ ] Append the two replacement wiring tests to `packages/web/src/app/tasks/TaskDrawer.test.tsx`:

```tsx
describe('TaskDrawer subtask drag handles', () => {
  const subtasks = [
    { id: 's1', taskId: 't', title: 'First', done: false, sortOrder: 0 },
    { id: 's2', taskId: 't', title: 'Last', done: false, sortOrder: 1 },
  ];

  it('each subtask row is a dnd-kit draggable, in sortOrder order', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    const first = screen.getByTestId('subtask-li-s1');
    const second = screen.getByTestId('subtask-li-s2');
    expect(first).toHaveAttribute('aria-roledescription', 'sortable');
    expect(second).toHaveAttribute('aria-roledescription', 'sortable');
    // Keyboard reordering comes free with the KeyboardSensor; the row must be focusable for it.
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no longer uses native HTML5 drag attributes or an insert line', () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([]) } as never);
    renderWithProviders(<TaskDrawer task={task({ id: 't', subtasks }) as never} onSave={() => {}} onCancel={() => {}} />, { api });
    expect(screen.getByTestId('subtask-li-s1')).not.toHaveAttribute('draggable');
    expect(screen.queryByTestId('subtask-insert-line')).toBeNull();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/tasks/TaskDrawer.test.tsx`. Expected failure: 2 failures in the new describe — `aria-roledescription` is absent and `draggable` is present.

- [ ] Edit `packages/web/src/app/tasks/TaskDrawer.tsx`. Replace the import block (lines 1–10):

  old:
```tsx
import { useRef, useState } from 'react';
import type { Task, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { formatDurationShort } from '../lib/duration';
import { useClickOutside } from '../components/useClickOutside';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';
import { insertionSortOrder } from '../priorities/priorityBucket';
```
  new:
```tsx
import { useRef, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Subtask, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { formatDurationShort } from '../lib/duration';
import { useClickOutside } from '../components/useClickOutside';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { subtaskDropSortOrder } from './subtaskDnd';
```

- [ ] Add the sortable row component just above `export interface TaskDrawerProps` in `packages/web/src/app/tasks/TaskDrawer.tsx`:

```tsx
function SortableSubtask({ subtask, onToggle, onDelete }: {
  subtask: Subtask;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  return (
    <li
      ref={setNodeRef}
      data-testid={`subtask-li-${subtask.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex flex-col ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" data-testid={`subtask-toggle-${subtask.id}`} checked={subtask.done} onChange={onToggle} className="h-4 w-4 accent-indigo" />
        <span className={`flex-1 ${subtask.done ? 'text-inkSoft line-through' : 'text-ink'}`}>{subtask.title}</span>
        <button type="button" data-testid={`subtask-delete-${subtask.id}`} aria-label="delete subtask" onClick={onDelete} className="text-[13px] font-bold text-crit">×</button>
      </div>
    </li>
  );
}
```

- [ ] Remove the HTML5 drag state from `packages/web/src/app/tasks/TaskDrawer.tsx` and add the sensors. Replace these three lines (the `dragId` / `overIndex` state plus the `subtasks` binding):

  old:
```tsx
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const subtasks = task.subtasks ?? [];
```
  new:
```tsx
  const sensors = useAppSensors();
  const subtasks = task.subtasks ?? [];
  const onSubtaskDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const sortOrder = subtaskDropSortOrder(subtasks, String(e.active.id), String(e.over.id));
    if (sortOrder !== null) updateSubtaskM.mutate({ id: String(e.active.id), patch: { sortOrder } });
  };
```

- [ ] Replace the whole subtask `<ul>` in `packages/web/src/app/tasks/TaskDrawer.tsx`. Old block (the complete list, from `<ul className="mb-1.5 space-y-1.5">` through the closing `</ul>`):

```tsx
        <ul className="mb-1.5 space-y-1.5">
          {subtasks.map((s, i) => (
            <li
              key={s.id}
              data-testid={`subtask-li-${s.id}`}
              draggable
              onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', s.id); setDragId(s.id); }}
              onDragEnd={() => { setDragId(null); setOverIndex(null); }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                const idx = r.height > 0 && e.clientY >= r.top + r.height / 2 ? i + 1 : i;
                setOverIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId === null || overIndex === null) return;
                const srcIndex = subtasks.findIndex((x) => x.id === dragId);
                let insertIdx = overIndex;
                if (srcIndex !== -1 && srcIndex < insertIdx) insertIdx -= 1;
                const others = subtasks.filter((x) => x.id !== dragId);
                const sortOrder = insertionSortOrder(others, insertIdx);
                updateSubtaskM.mutate({ id: dragId, patch: { sortOrder } });
                setDragId(null);
                setOverIndex(null);
              }}
              className="flex flex-col"
            >
              {overIndex === i && dragId !== null && dragId !== s.id && (
                <div data-testid="subtask-insert-line" className="h-0.5 bg-indigo mb-1" />
              )}
              <div className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" data-testid={`subtask-toggle-${s.id}`} checked={s.done} onChange={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })} className="h-4 w-4 accent-indigo" />
                <span className={`flex-1 ${s.done ? 'text-inkSoft line-through' : 'text-ink'}`}>{s.title}</span>
                <button type="button" data-testid={`subtask-delete-${s.id}`} aria-label="delete subtask" onClick={() => deleteSubtaskM.mutate(s.id)} className="text-[13px] font-bold text-crit">×</button>
              </div>
            </li>
          ))}
          {overIndex === subtasks.length && dragId !== null && (
            <li><div data-testid="subtask-insert-line" className="h-0.5 bg-indigo" /></li>
          )}
        </ul>
```

  new:
```tsx
        <DndContext sensors={sensors} collisionDetection={pointerFirstCollision} onDragEnd={onSubtaskDragEnd}>
          <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="mb-1.5 space-y-1.5">
              {subtasks.map((s) => (
                <SortableSubtask
                  key={s.id}
                  subtask={s}
                  onToggle={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })}
                  onDelete={() => deleteSubtaskM.mutate(s.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/tasks/TaskDrawer.test.tsx src/app/tasks/subtaskDnd.test.ts`. Expected: all pass (`TaskDrawer.test.tsx` now has 14 tests, `subtaskDnd.test.ts` 6).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **603 passed (603), 68 files**.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Commit:

```sh
git add packages/web/src/app/tasks/subtaskDnd.ts packages/web/src/app/tasks/subtaskDnd.test.ts packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): drawer subtask reorder on dnd-kit

TaskDrawer owns a DndContext + vertical SortableContext; the drop arithmetic
moves into a pure subtaskDropSortOrder (arrayMove + the existing sparse
insertionSortOrder), so the PATCH payload is unchanged.

Two HTML5 tests are replaced by pure tests: the upward case keeps its exact
old value (-1); the downward case moves 0 -> 2 because dnd-kit lands the item
where the live preview shows it instead of always above the hovered row.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 3 — Card subtask reorder on dnd-kit

Same pure module, second consumer. `TaskRow` gets a **nested** `DndContext` for its checklist; the card itself stays natively `draggable` for one more task (see the ordering note in Global Constraints — the subtask sensor's window `dragstart` guard keeps the two from fighting during the gap).

**Files:**
- Modify: `packages/web/src/app/priorities/TaskRow.tsx`
- Modify (test, 4 deletions + 2 additions): `packages/web/src/app/priorities/TaskRow.test.tsx`
- Modify (test, 2 additions): `packages/web/src/app/tasks/subtaskDnd.test.ts`
- Modify (test, 1 deletion): `packages/web/src/app/pages/Priorities.test.tsx`

**Interfaces:**
- No new exports. `TaskRow`'s public props are unchanged in this task (`onReorderSubtask(subtaskId, sortOrder)` still fires with the same shape).
- Consumes: `subtaskDropSortOrder` (Task 2), `useAppSensors` / `pointerFirstCollision` (Task 1).

**Steps:**

- [ ] Append the two ported arithmetic tests to `packages/web/src/app/tasks/subtaskDnd.test.ts` (they carry the numbers from the `TaskRow` tests deleted below):

```ts
describe('subtaskDropSortOrder — card checklist cases', () => {
  const three = [
    { id: 's1', sortOrder: 10 },
    { id: 's2', sortOrder: 20 },
    { id: 's3', sortOrder: 30 },
  ];

  it('dragging the last subtask onto the first lands above it', () => {
    // Ported verbatim from the deleted TaskRow HTML5 test: 10 - 1 = 9.
    expect(subtaskDropSortOrder(three, 's3', 's1')).toBe(9);
  });

  it('dragging the first subtask onto the last lands BELOW it', () => {
    // Semantic change from the HTML5 path (which said 25): a downward drag now lands after the
    // hovered row, so the value is past the tail => 30 + 1 = 31.
    expect(subtaskDropSortOrder(three, 's1', 's3')).toBe(31);
  });
});
```

- [ ] **Delete all four pre-existing HTML5 tests** from `packages/web/src/app/priorities/TaskRow.test.tsx`: remove the entire final block, from `const threeSubtasks = [` through the closing `});` of `describe('TaskRow card subtask drag-reorder', …)` at the end of the file. That is the four tests named *"dragging last subtask above first calls onReorderSubtask(id, first.sortOrder-1)"*, *"dragging first subtask downward (over third) calls onReorderSubtask with midpoint"*, *"subtask dragStart does NOT trigger the task-card drag (stopPropagation)"* and *"task-card drag still works after a subtask drag ends"*. The first two are ported above; the last two are obsolete — dnd-kit's `nativeEvent.dndKit` capture flag replaces the hand-rolled `stopPropagation` guard structurally.

- [ ] Append the two replacement wiring tests to `packages/web/src/app/priorities/TaskRow.test.tsx`:

```tsx
const threeSubtasks = [
  { id: 's1', taskId: 't', title: 'first', done: false, sortOrder: 10 },
  { id: 's2', taskId: 't', title: 'second', done: false, sortOrder: 20 },
  { id: 's3', taskId: 't', title: 'third', done: false, sortOrder: 30 },
];

describe('TaskRow card subtask drag handles', () => {
  it('each checklist row is a dnd-kit sortable with a stable testid', () => {
    renderRow({ ...base, subtasks: threeSubtasks } as Task);
    const first = screen.getByTestId('card-subtask-li-s1');
    expect(first).toHaveAttribute('aria-roledescription', 'sortable');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('card-subtask-li-s3')).toBeInTheDocument();
  });

  it('drops the native HTML5 drag attributes from the checklist', () => {
    renderRow({ ...base, subtasks: threeSubtasks } as Task);
    for (const id of ['s1', 's2', 's3']) {
      expect(screen.getByTestId(`card-subtask-li-${id}`)).not.toHaveAttribute('draggable');
    }
  });
});
```

- [ ] **Delete the pre-existing card-subtask HTML5 test** from `packages/web/src/app/pages/Priorities.test.tsx`: remove the test named *"card subtask drag-reorder PATCHes updateSubtask with {sortOrder}"* (the last `it(...)` block in the file, which uses `fireEvent.dragStart`/`dragOver`/`drop` on `getAllByRole('listitem')`). Its value (`{sortOrder: 9}`) is the same case now covered by `subtaskDropSortOrder(three, 's3', 's1') === 9`.

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/TaskRow.test.tsx`. Expected failure: 2 failures in the new describe — `card-subtask-li-s1` is not in the document.

- [ ] Edit `packages/web/src/app/priorities/TaskRow.tsx`. Replace the import block (lines 1–4):

  old:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../api/types';
import { Icons } from '../shell/icons';
import { type BoardColumnKey, columnMeta, relativeDayTimeLabel, insertionSortOrder } from './priorityBucket';
```
  new:
```tsx
import { useEffect, useRef, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Subtask } from '../../api/types';
import { Icons } from '../shell/icons';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { subtaskDropSortOrder } from '../tasks/subtaskDnd';
import { type BoardColumnKey, columnMeta, relativeDayTimeLabel } from './priorityBucket';
```

- [ ] Add the sortable checklist row component to `packages/web/src/app/priorities/TaskRow.tsx`, just above `export interface TaskRowProps`:

```tsx
function SortableCardSubtask({ subtask, onToggle }: { subtask: Subtask; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  return (
    <li
      ref={setNodeRef}
      data-testid={`card-subtask-li-${subtask.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex flex-col ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          data-testid={`card-subtask-${subtask.id}`}
          checked={subtask.done}
          onChange={onToggle}
          className="h-3.5 w-3.5 accent-indigo"
        />
        <span className={subtask.done ? 'text-inkSoft line-through' : 'text-ink'}>{subtask.title}</span>
      </div>
    </li>
  );
}
```

- [ ] Remove the checklist's HTML5 drag state from `packages/web/src/app/priorities/TaskRow.tsx` and add the sensors. Replace these two lines:

  old:
```tsx
  const [subtaskDragId, setSubtaskDragId] = useState<string | null>(null);
  const [subtaskOverIndex, setSubtaskOverIndex] = useState<number | null>(null);
```
  new:
```tsx
  const subtaskSensors = useAppSensors();
```

- [ ] Add the drop handler in `packages/web/src/app/priorities/TaskRow.tsx`, immediately after the `const colMeta = columnMeta(columnKey);` line:

```tsx
  const onSubtaskDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const sortOrder = subtaskDropSortOrder(subtasks, String(e.active.id), String(e.over.id));
    if (sortOrder !== null) onReorderSubtask(String(e.active.id), sortOrder);
  };
```

- [ ] Replace the whole checklist `<ul>` in `packages/web/src/app/priorities/TaskRow.tsx`. Old block (from `{subtasks.length > 0 && (` on the line after the meta row, through its closing `)}`):

```tsx
        {subtasks.length > 0 && (
          <ul data-testid="card-subtasks" className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
            {subtasks.map((s, i) => (
              <li
                key={s.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }
                  setSubtaskDragId(s.id);
                }}
                onDragEnd={(e) => { e.stopPropagation(); setSubtaskDragId(null); setSubtaskOverIndex(null); }}
                onDragOver={(e) => {
                  if (subtaskDragId === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  const idx = r.height > 0 && e.clientY >= r.top + r.height / 2 ? i + 1 : i;
                  setSubtaskOverIndex(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (subtaskDragId === null || subtaskOverIndex === null) return;
                  const srcIndex = subtasks.findIndex((x) => x.id === subtaskDragId);
                  let insertIdx = subtaskOverIndex;
                  if (srcIndex !== -1 && srcIndex < insertIdx) insertIdx -= 1;
                  const others = subtasks.filter((x) => x.id !== subtaskDragId);
                  const sortOrder = insertionSortOrder(others, insertIdx);
                  onReorderSubtask(subtaskDragId, sortOrder);
                  setSubtaskDragId(null);
                  setSubtaskOverIndex(null);
                }}
                className="flex flex-col"
              >
                {subtaskOverIndex === i && subtaskDragId !== null && subtaskDragId !== s.id && (
                  <div className="mb-0.5 h-0.5 bg-indigo" />
                )}
                <div className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    data-testid={`card-subtask-${s.id}`}
                    checked={s.done}
                    onChange={() => onToggleSubtask(s.id, !s.done)}
                    className="h-3.5 w-3.5 accent-indigo"
                  />
                  <span className={s.done ? 'text-inkSoft line-through' : 'text-ink'}>{s.title}</span>
                </div>
              </li>
            ))}
            {subtaskOverIndex === subtasks.length && subtaskDragId !== null && (
              <li><div className="h-0.5 bg-indigo" /></li>
            )}
          </ul>
        )}
```

  new:
```tsx
        {subtasks.length > 0 && (
          // Nested inside the board's DndContext (Task 4). Safe: dnd-kit stamps `dndKit` on the
          // native event when a sensor captures it, so the enclosing card's activator declines —
          // structurally what the old stopPropagation calls were doing by hand.
          <DndContext sensors={subtaskSensors} collisionDetection={pointerFirstCollision} onDragEnd={onSubtaskDragEnd}>
            <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul data-testid="card-subtasks" className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
                {subtasks.map((s) => (
                  <SortableCardSubtask key={s.id} subtask={s} onToggle={() => onToggleSubtask(s.id, !s.done)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/TaskRow.test.tsx src/app/tasks/subtaskDnd.test.ts src/app/pages/Priorities.test.tsx`. Expected: all pass (`TaskRow.test.tsx` 10 tests, `subtaskDnd.test.ts` 8, `Priorities.test.tsx` 20).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **602 passed (602), 68 files**.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Commit:

```sh
git add packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx packages/web/src/app/tasks/subtaskDnd.test.ts packages/web/src/app/pages/Priorities.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): card checklist reorder on dnd-kit

Second consumer of subtaskDropSortOrder: TaskRow nests its own DndContext for
the on-card checklist. The nested context is safe because dnd-kit marks the
native event as captured, so the enclosing card declines the same press --
replacing the hand-rolled stopPropagation guards (their two tests retire).

The two arithmetic cases are ported to subtaskDnd.test.ts: upward keeps 9,
downward moves 25 -> 31 for the same reason as the drawer.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 4 — Priorities board on dnd-kit; the FLIP drag path retires

The biggest surface. `Board` owns the `DndContext`, each `Column` is a droppable wrapping a `SortableContext`, each `TaskRow` is a sortable item. `Board`'s `drag` state, `ColumnDnd`, `InsertGap` and every HTML5 handler are deleted. `useFlip` stays, now the *only* owner of non-drag movement animation.

**Files:**
- Create: `packages/web/src/app/priorities/boardDnd.ts`
- Create (test): `packages/web/src/app/priorities/boardDnd.test.ts`
- Modify: `packages/web/src/app/priorities/Board.tsx`
- Modify: `packages/web/src/app/priorities/Column.tsx`
- Modify: `packages/web/src/app/priorities/TaskRow.tsx`
- Modify: `packages/web/src/app/pages/Priorities.tsx`
- Modify (test, helper edit + 1 addition): `packages/web/src/app/priorities/TaskRow.test.tsx`
- Modify (test, 7 deletions + 1 addition): `packages/web/src/app/pages/Priorities.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/priorities/boardDnd.ts`:
  - `export const COLUMN_DROPPABLE_PREFIX = 'col:'`
  - `export function columnDroppableId(key: BoardColumnKey): string`
  - `export interface BoardDropColumn { key: BoardColumnKey; tasks: { id: string }[] }`
  - `export interface BoardDrop { taskId: string; to: BoardColumnKey; index: number }`
  - `export function overColumnKey(columns: BoardDropColumn[], overId: string | null): BoardColumnKey | null`
  - `export function resolveBoardDrop(columns: BoardDropColumn[], activeId: string, overId: string | null): BoardDrop | null`
  - `export function taskMovePatch(args: { task: Pick<Task, 'priority' | 'status'>; to: BoardColumnKey; index: number; columnTasks: Pick<Task, 'id' | 'sortOrder'>[]; taskId: string }): UpdateTaskInput | null`
- `TaskRow` props change: **removes** `dragging`, `onDragStart`, `onDragEnd`; keeps everything else including `draggable?: boolean`.
- `Column` props change: **removes** `dnd: ColumnDnd`; **adds** `isTarget: boolean`.
- `Board` props are unchanged (`onMove(taskId, to, index)` keeps its exact signature).
- `ColumnDnd` and `InsertGap` are deleted.

**Steps:**

- [ ] Write the failing test `packages/web/src/app/priorities/boardDnd.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Task, UpdateTaskInput } from '../../api/types';
import { columnDroppableId, overColumnKey, resolveBoardDrop, taskMovePatch, type BoardDropColumn } from './boardDnd';

const cols: BoardDropColumn[] = [
  { key: 'critical', tasks: [{ id: 'c1' }] },
  { key: 'high', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { key: 'low', tasks: [{ id: 'l1' }] },
  { key: 'backlog', tasks: [] },
  { key: 'completed', tasks: [{ id: 'd1' }] },
];

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'T', priority: 2, sortOrder: 0, durationMs: 1,
  dueBy: null, minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending',
  completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '', ...over,
});

describe('columnDroppableId / overColumnKey', () => {
  it('round-trips a column key through its droppable id', () => {
    expect(columnDroppableId('backlog')).toBe('col:backlog');
    expect(overColumnKey(cols, 'col:backlog')).toBe('backlog');
  });

  it('resolves a card id to the column that holds it', () => {
    expect(overColumnKey(cols, 'b')).toBe('high');
  });

  it('is null for no target and for an unknown id', () => {
    expect(overColumnKey(cols, null)).toBeNull();
    expect(overColumnKey(cols, 'ghost')).toBeNull();
  });
});

describe('resolveBoardDrop', () => {
  it('dropping on a column container appends to it', () => {
    expect(resolveBoardDrop(cols, 'l1', 'col:critical')).toEqual({ taskId: 'l1', to: 'critical', index: 1 });
  });

  it('same-column upward move inserts at the hovered index', () => {
    expect(resolveBoardDrop(cols, 'c', 'a')).toEqual({ taskId: 'c', to: 'high', index: 0 });
  });

  it('same-column downward move inserts after the hovered index', () => {
    expect(resolveBoardDrop(cols, 'a', 'c')).toEqual({ taskId: 'a', to: 'high', index: 3 });
  });

  it('cross-column drop on a card inserts at that card', () => {
    expect(resolveBoardDrop(cols, 'l1', 'b')).toEqual({ taskId: 'l1', to: 'high', index: 1 });
  });

  it('is null when the drag is released outside every target', () => {
    expect(resolveBoardDrop(cols, 'a', null)).toBeNull();
  });

  it('is null for the completed column — it rejects drops', () => {
    expect(resolveBoardDrop(cols, 'a', 'col:completed')).toBeNull();
    expect(resolveBoardDrop(cols, 'a', 'd1')).toBeNull();
  });

  it('is null when the dragged id is not on the board', () => {
    expect(resolveBoardDrop(cols, 'ghost', 'a')).toBeNull();
  });
});

describe('taskMovePatch', () => {
  const neighbours = [{ id: 'x', sortOrder: 1 }, { id: 'y', sortOrder: 3 }];

  it('within the same bucket patches only sortOrder', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 2 }), to: 'high', index: 1, columnTasks: neighbours });
    expect(patch).toEqual({ sortOrder: 2 });
  });

  it('across buckets patches the priority too', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 2 }), to: 'critical', index: 1, columnTasks: neighbours });
    expect(patch).toEqual({ priority: 1, sortOrder: 2 });
  });

  it('into the backlog patches status without touching priority', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 4 }), to: 'backlog', index: 0, columnTasks: [] });
    expect(patch).toEqual({ status: 'backlog', sortOrder: 0 });
    expect(patch).not.toHaveProperty('priority');
  });

  it('out of the backlog reactivates the task', () => {
    const patch = taskMovePatch({ taskId: 'b1', task: task({ priority: 4, status: 'backlog' }), to: 'critical', index: 0, columnTasks: [] });
    expect(patch).toEqual({ status: 'pending', priority: 1, sortOrder: 0 });
  });

  it('into the completed column does nothing', () => {
    expect(taskMovePatch({ taskId: 't1', task: task(), to: 'completed', index: 0, columnTasks: [] })).toBeNull();
  });
});

describe('board drop → PATCH (ported from the deleted Priorities drag tests)', () => {
  const move = (columns: { key: string; tasks: Task[] }[], activeId: string, overId: string | null): UpdateTaskInput | null => {
    const shape = columns.map((c) => ({ key: c.key, tasks: c.tasks })) as unknown as BoardDropColumn[];
    const drop = resolveBoardDrop(shape, activeId, overId);
    if (!drop) return null;
    const all = columns.flatMap((c) => c.tasks);
    const t = all.find((x) => x.id === drop.taskId)!;
    const columnTasks = columns.find((c) => c.key === drop.to)?.tasks ?? [];
    return taskMovePatch({ taskId: drop.taskId, task: t, to: drop.to, index: drop.index, columnTasks });
  };

  const board = [
    { key: 'critical', tasks: [task({ id: 'c1', priority: 1, sortOrder: 0 })] },
    { key: 'high', tasks: [task({ id: 'a', priority: 2, sortOrder: 1 }), task({ id: 'b', priority: 2, sortOrder: 2 }), task({ id: 'c', priority: 2, sortOrder: 3 })] },
    { key: 'low', tasks: [task({ id: 'l1', priority: 4, sortOrder: 0 }), task({ id: 'lonely', priority: 4, sortOrder: 7 })] },
    { key: 'backlog', tasks: [] },
    { key: 'completed', tasks: [task({ id: 'd1', priority: 4, status: 'completed' })] },
  ];

  it('reprioritizes onto an empty area of another column', () => {
    expect(move(board, 'l1', 'col:critical')).toEqual({ priority: 1, sortOrder: 1 });
  });

  it('reorders within a column upward (midpoint, same priority)', () => {
    expect(move(board, 'c', 'a')).toEqual({ sortOrder: 0 });
  });

  it('drags the first task DOWN within a column past the last one', () => {
    // Was 2.5 under HTML5 ("always insert above the hovered row"); dnd-kit lands the card where
    // the preview showed it, i.e. after Gamma(3) => 4.
    expect(move(board, 'a', 'c')).toEqual({ sortOrder: 4 });
  });

  it('cross-column drop on the container gets a bottom sortOrder', () => {
    expect(move(board, 'a', 'col:low')).toEqual({ priority: 4, sortOrder: 8 });
  });

  it('dropping a pending task onto the backlog sets status without priority', () => {
    const patch = move(board, 'l1', 'col:backlog');
    expect(patch).toEqual({ status: 'backlog', sortOrder: 0 });
  });

  it('dropping onto the completed column produces no patch', () => {
    expect(move(board, 'l1', 'col:completed')).toBeNull();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/boardDnd.test.ts`. Expected failure: `Failed to resolve import "./boardDnd"`.

- [ ] Create `packages/web/src/app/priorities/boardDnd.ts` with exactly:

```ts
import type { Task, UpdateTaskInput } from '../../api/types';
import { type BucketKey, type BoardColumnKey, bucketToPriority, insertionSortOrder, priorityToBucket } from './priorityBucket';

/** Column droppables are prefixed so a drop id is unambiguously a column, not a card. */
export const COLUMN_DROPPABLE_PREFIX = 'col:';

export function columnDroppableId(key: BoardColumnKey): string {
  return `${COLUMN_DROPPABLE_PREFIX}${key}`;
}

export interface BoardDropColumn {
  key: BoardColumnKey;
  tasks: { id: string }[];
}

export interface BoardDrop {
  taskId: string;
  to: BoardColumnKey;
  index: number;
}

/** Which column a dnd-kit `over.id` names — the column itself, or the column holding that card. */
export function overColumnKey(columns: BoardDropColumn[], overId: string | null): BoardColumnKey | null {
  if (overId === null) return null;
  if (overId.startsWith(COLUMN_DROPPABLE_PREFIX)) {
    const key = overId.slice(COLUMN_DROPPABLE_PREFIX.length);
    return columns.some((c) => c.key === key) ? (key as BoardColumnKey) : null;
  }
  return columns.find((c) => c.tasks.some((t) => t.id === overId))?.key ?? null;
}

/**
 * Turn a dnd-kit drop into the board's existing `(taskId, to, index)` contract, where `index` is
 * the insertion index **in the target column as currently rendered** (i.e. still including the
 * dragged card when the column is its own). `Priorities.onMove` / `taskMovePatch` already handle
 * the off-by-one for that case, so the downstream arithmetic is untouched.
 *
 * A same-column downward drag inserts *after* the hovered card, matching what dnd-kit's live
 * preview showed; an upward drag inserts before it, exactly as the old HTML5 path did.
 */
export function resolveBoardDrop(
  columns: BoardDropColumn[],
  activeId: string,
  overId: string | null,
): BoardDrop | null {
  const to = overColumnKey(columns, overId);
  if (to === null || to === 'completed') return null;

  const fromColumn = columns.find((c) => c.tasks.some((t) => t.id === activeId));
  if (!fromColumn) return null;
  const activeIndex = fromColumn.tasks.findIndex((t) => t.id === activeId);

  const target = columns.find((c) => c.key === to)!;
  const isContainerDrop = overId!.startsWith(COLUMN_DROPPABLE_PREFIX);
  if (isContainerDrop) return { taskId: activeId, to, index: target.tasks.length };

  const overIndex = target.tasks.findIndex((t) => t.id === overId);
  if (overIndex === -1) return null;
  const sameColumn = fromColumn.key === to;
  const index = sameColumn && activeIndex < overIndex ? overIndex + 1 : overIndex;
  return { taskId: activeId, to, index };
}

/**
 * The PATCH a board move produces, or null when the move is a no-op (the completed column rejects
 * drops). Lifted verbatim out of `Priorities.onMove` so the payloads stay testable without a
 * gesture — the shapes are unchanged: `{sortOrder}`, `{priority, sortOrder}`,
 * `{status:'backlog', sortOrder}`, `{status:'pending', priority, sortOrder}`.
 */
export function taskMovePatch({ taskId, task, to, index, columnTasks }: {
  taskId: string;
  task: Pick<Task, 'priority' | 'status'>;
  to: BoardColumnKey;
  index: number;
  columnTasks: Pick<Task, 'id' | 'sortOrder'>[];
}): UpdateTaskInput | null {
  if (to === 'completed') return null;

  const sourceIndex = columnTasks.findIndex((x) => x.id === taskId);
  const adjustedIndex = sourceIndex !== -1 && sourceIndex < index ? index - 1 : index;
  const neighbors = columnTasks.filter((x) => x.id !== taskId);
  const sortOrder = insertionSortOrder(neighbors, adjustedIndex);

  if (to === 'backlog') return { status: 'backlog', sortOrder };

  const targetBucket = to as BucketKey;
  const patch: UpdateTaskInput = { sortOrder };
  if (priorityToBucket(task.priority) !== targetBucket) patch.priority = bucketToPriority(targetBucket);
  if (task.status === 'backlog' || task.status === 'completed') patch.status = 'pending';
  return patch;
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/boardDnd.test.ts`. Expected: 21 tests pass.

- [ ] **Delete the seven pre-existing board-drag tests** from `packages/web/src/app/pages/Priorities.test.tsx`, by name:
  1. *"reprioritizes via drag and drop"*
  2. *"reorders within a column via drag (midpoint sortOrder, same priority)"*
  3. *"drags the first task DOWN within a column without off-by-one"*
  4. *"cross-column drop sets priority AND a bottom sortOrder"*
  5. *"dragging a pending task onto the backlog column patches {status:\"backlog\", sortOrder}"*
  6. *"dragging a backlog task to a bucket column patches {status:\"pending\", priority, sortOrder}"*
  7. *"dropping onto the completed column does nothing (no updateTask call)"*

  Also delete the now-unused helper on the line `const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });` and drop `fireEvent` from the `@testing-library/react` import **only if** no surviving test uses it (it does — `fireEvent.click` is used throughout — so **keep the `fireEvent` import**). All seven payload assertions are already ported into `boardDnd.test.ts` above.

- [ ] Append the replacement wiring test to `packages/web/src/app/pages/Priorities.test.tsx`, inside `describe('Priorities board', …)`:

```tsx
  it('board cards are dnd-kit sortables, except in the Completed column', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const active = screen.getByText('Low thing').closest('[data-testid="task-row"]')!;
    expect(active).toHaveAttribute('aria-roledescription', 'sortable');
    const doneRow = within(screen.getByTestId('column-completed')).getByTestId('task-row');
    expect(doneRow).not.toHaveAttribute('aria-roledescription');
    expect(doneRow).not.toHaveAttribute('draggable');
  });
```

- [ ] Edit the `renderRow` helper in `packages/web/src/app/priorities/TaskRow.test.tsx` to drop the removed props.

  old:
```tsx
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void; onReorderSubtask?: (subtaskId: string, sortOrder: number) => void; onDragStart?: (taskId: string) => void; onDragEnd?: () => void } = {}) {
  return render(
    <TaskRow
      task={task} columnKey="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')} dragging={false}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop}
      onDragStart={over.onDragStart ?? noop} onDragEnd={over.onDragEnd ?? noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
      onReorderSubtask={over.onReorderSubtask ?? noop}
    />,
  );
}
```
  new:
```tsx
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void; onReorderSubtask?: (subtaskId: string, sortOrder: number) => void; draggable?: boolean } = {}) {
  return render(
    <TaskRow
      task={task} columnKey="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')}
      draggable={over.draggable ?? true}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
      onReorderSubtask={over.onReorderSubtask ?? noop}
    />,
  );
}
```

- [ ] Append one wiring test to `packages/web/src/app/priorities/TaskRow.test.tsx`:

```tsx
describe('TaskRow sortable wiring', () => {
  it('carries the sortable attributes when draggable and none when not', () => {
    const { unmount } = renderRow(base as Task);
    expect(screen.getByTestId('task-row')).toHaveAttribute('aria-roledescription', 'sortable');
    unmount();
    renderRow(base as Task, { draggable: false });
    expect(screen.getByTestId('task-row')).not.toHaveAttribute('aria-roledescription');
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/TaskRow.test.tsx src/app/pages/Priorities.test.tsx`. Expected failure: the new tests fail — `aria-roledescription` is absent on the row, and `draggable` is still present on completed rows.

- [ ] Edit `packages/web/src/app/priorities/TaskRow.tsx` to make the card row a sortable. **No import change is needed** — Task 3 already imported `useSortable`, `CSS` and `DndContext` into this file; `useSortable` is simply called twice from now on (once for the card row, once per checklist row). Replace the `TaskRowProps` interface:

  old:
```tsx
export interface TaskRowProps {
  task: Task;
  columnKey: BoardColumnKey;
  nextMs: number | null;
  now: number;
  dragging: boolean;
  draggable?: boolean;
  muted?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}
```
  new:
```tsx
export interface TaskRowProps {
  task: Task;
  columnKey: BoardColumnKey;
  nextMs: number | null;
  now: number;
  /** False in the Completed column: no sortable listeners, no drag affordance. */
  draggable?: boolean;
  muted?: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}
```

- [ ] Replace the `TaskRow` signature line in `packages/web/src/app/priorities/TaskRow.tsx`:

  old:
```tsx
export function TaskRow({ task, columnKey, nextMs, now, dragging, draggable = true, muted = false, onComplete, onEdit, onDelete, onDragStart, onDragEnd, onToggleSubtask, onReorderSubtask }: TaskRowProps) {
```
  new:
```tsx
export function TaskRow({ task, columnKey, nextMs, now, draggable = true, muted = false, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: TaskRowProps) {
  const {
    attributes: cardAttributes, listeners: cardListeners, setNodeRef: setCardRef,
    transform: cardTransform, transition: cardTransition, isDragging,
  } = useSortable({
    id: task.id,
    disabled: !draggable,
    // dnd-kit owns the in-drag reflow; `useFlip` (in Column) owns post-PATCH re-sorts. Leaving
    // both on would double-animate the same movement.
    animateLayoutChanges: () => false,
  });
```

- [ ] Replace the root `<div>` opening tag of `packages/web/src/app/priorities/TaskRow.tsx`:

  old:
```tsx
    <div
      data-testid="task-row" data-task-id={task.id} data-bucket={columnKey}
      draggable={draggable}
      onDragStart={(e) => { if (!draggable) return; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); } onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      onClick={() => onEdit(task)}
      className={`flex items-start gap-3 border-t border-l-4 border-t-line ${colMeta.leftBorder} bg-card last:rounded-b-xl py-3.5 pl-4 pr-3.5 transition-colors hover:bg-[#fafbfc] ${draggable ? 'cursor-grab' : 'cursor-default'} ${dragging ? 'opacity-40' : muted ? 'opacity-70' : done ? 'opacity-45' : ''}`}
    >
```
  new:
```tsx
    <div
      ref={setCardRef}
      data-testid="task-row" data-task-id={task.id} data-bucket={columnKey}
      style={{ transform: CSS.Transform.toString(cardTransform), transition: cardTransition }}
      {...(draggable ? cardAttributes : {})}
      {...(draggable ? cardListeners : {})}
      onClick={() => onEdit(task)}
      className={`flex items-start gap-3 border-t border-l-4 border-t-line ${colMeta.leftBorder} bg-card last:rounded-b-xl py-3.5 pl-4 pr-3.5 transition-colors hover:bg-[#fafbfc] ${draggable ? 'cursor-grab' : 'cursor-default'} ${isDragging ? 'opacity-40' : muted ? 'opacity-70' : done ? 'opacity-45' : ''}`}
    >
```

- [ ] Replace `packages/web/src/app/priorities/Column.tsx` **in full** with:

```tsx
import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task } from '../../api/types';
import { type BoardColumnKey, columnMeta } from './priorityBucket';
import { columnDroppableId } from './boardDnd';
import { TasksCard } from './TasksCard';
import { TaskRow } from './TaskRow';
import { useFlip } from './useFlip';

export interface ColumnProps {
  columnKey: BoardColumnKey;
  tasks: Task[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  /** True while a drag is hovering this column (Board resolves it once for the whole board). */
  isTarget: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}

export function Column({ columnKey, tasks, now, nextMsFor, isTarget, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCompleted = columnKey === 'completed';
  const meta = columnMeta(columnKey);
  // `useFlip` no longer animates the drag itself (dnd-kit's sorting strategy does). It survives
  // for movement the user did not drag: the post-PATCH refetch, a WS-driven re-sort, a filter.
  const setFlipRef = useFlip(tasks.map((t) => t.id).join('|'));
  // The whole column is a drop target so a card can land in its empty area (the old
  // `onDragOver` → `setOver(columnKey, tasks.length)` behaviour). Completed rejects drops.
  const { setNodeRef } = useDroppable({ id: columnDroppableId(columnKey), disabled: isCompleted });

  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${columnKey}`}
      className={`shrink-0 transition-[width] ${collapsed ? 'w-[250px]' : 'w-[372px]'}`}
    >
      <div className="mb-3 flex items-center pr-1">
        <span className="flex-1 text-[16.5px] font-bold text-inkSoft">{meta.label}</span>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)} className="text-[15.5px] font-bold text-indigo">
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className={`rounded-[13px] ${isTarget ? 'outline-dashed outline-2 outline-offset-[3px] outline-indigo' : ''}`}>
          <SortableContext id={columnKey} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.length > 0 ? (
              <TasksCard count={tasks.length}>
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    ref={setFlipRef(t.id)}
                    className="last:[&>[data-testid=task-row]]:rounded-b-xl"
                  >
                    <TaskRow
                      task={t} columnKey={columnKey} now={now} nextMs={nextMsFor(t.id)}
                      draggable={!isCompleted}
                      muted={columnKey === 'backlog'}
                      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
                      onReorderSubtask={onReorderSubtask}
                    />
                  </div>
                ))}
              </TasksCard>
            ) : (
              <div className={`rounded-xl border-[1.5px] px-1 py-[22px] text-center text-[14.5px] ${isTarget ? 'border-dashed border-indigo font-bold text-indigo' : 'border-transparent text-[#aeb2c0]'}`}>
                {isTarget ? 'Drop to move here' : 'Nothing here yet'}
              </div>
            )}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
```

- [ ] Replace `packages/web/src/app/priorities/Board.tsx` **in full** with:

```tsx
import { useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { type BoardColumnKey, BUCKET_META, priorityToBucket } from './priorityBucket';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { overColumnKey, resolveBoardDrop } from './boardDnd';
import { Column } from './Column';

export interface BoardColumn { key: BoardColumnKey; tasks: Task[]; }

export interface BoardProps {
  columns: BoardColumn[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  onMove: (taskId: string, to: BoardColumnKey, index: number) => void;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleSubtask: (subtaskId: string, done: boolean) => void;
  onReorderSubtask: (subtaskId: string, sortOrder: number) => void;
}

export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete, onToggleSubtask, onReorderSubtask }: BoardProps) {
  const sensors = useAppSensors();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardColumnKey | null>(null);
  const activeTask = columns.flatMap((c) => c.tasks).find((t) => t.id === activeId) ?? null;

  const clear = () => { setActiveId(null); setOverColumn(null); };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOverColumn(overColumnKey(columns, e.over ? String(e.over.id) : null));
  const onDragEnd = (e: DragEndEvent) => {
    const drop = resolveBoardDrop(columns, String(e.active.id), e.over ? String(e.over.id) : null);
    clear();
    if (drop) onMove(drop.taskId, drop.to, drop.index);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={clear}
    >
      <div className="flex items-start gap-[26px]" style={{ minWidth: 'min-content' }}>
        {columns.map((c) => (
          <Column
            key={c.key} columnKey={c.key} tasks={c.tasks} now={now} nextMsFor={nextMsFor}
            isTarget={overColumn === c.key && activeId !== null && c.key !== 'completed'}
            onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} onToggleSubtask={onToggleSubtask}
            onReorderSubtask={onReorderSubtask}
          />
        ))}
      </div>
      {/* The board is inside a horizontally scrolling pane, so a card dragged between columns
          would be clipped by that scroll container. The overlay is portalled above everything. */}
      <DragOverlay>
        {activeTask ? (
          <div
            data-testid="board-drag-overlay"
            className={`w-[340px] rounded-xl border border-l-4 border-line ${BUCKET_META[priorityToBucket(activeTask.priority)].leftBorder} bg-card px-4 py-3.5 text-[16px] font-semibold text-ink shadow-pop`}
          >
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
```

- [ ] Edit `packages/web/src/app/pages/Priorities.tsx` to delegate the patch shape. Replace the `priorityBucket` import (line 8):

  old:
```tsx
import { type BucketKey, type BoardColumnKey, BUCKETS, priorityToBucket, bucketToPriority, nextBlockMsForTask, sortBucket, sortCompleted, insertionSortOrder } from '../priorities/priorityBucket';
```
  new:
```tsx
import { type BoardColumnKey, BUCKETS, priorityToBucket, nextBlockMsForTask, sortBucket, sortCompleted } from '../priorities/priorityBucket';
import { taskMovePatch } from '../priorities/boardDnd';
```

- [ ] Replace the `onMove` body in `packages/web/src/app/pages/Priorities.tsx`:

  old:
```tsx
  const onMove = (taskId: string, to: BoardColumnKey, index: number) => {
    const all = tasksQ.data ?? [];
    const t = all.find((x) => x.id === taskId);
    if (!t) return;

    if (to === 'completed') return; // completed column rejects drops

    const column = columns.find((c) => c.key === to);
    const colTasks = column?.tasks ?? [];
    const sourceIndex = colTasks.findIndex((x) => x.id === taskId);
    const adjustedIndex = sourceIndex !== -1 && sourceIndex < index ? index - 1 : index;
    const neighbors = colTasks.filter((x) => x.id !== taskId);
    const sortOrder = insertionSortOrder(neighbors, adjustedIndex);

    if (to === 'backlog') {
      updateM.mutate({ id: taskId, patch: { status: 'backlog', sortOrder } });
    } else {
      // Dropping on a bucket column
      const targetBucket = to as BucketKey;
      const patch: UpdateTaskInput = { sortOrder };
      if (priorityToBucket(t.priority) !== targetBucket) patch.priority = bucketToPriority(targetBucket);
      // If task was backlog or completed, reactivate it
      if (t.status === 'backlog' || t.status === 'completed') patch.status = 'pending';
      updateM.mutate({ id: taskId, patch });
    }
  };
```
  new:
```tsx
  const onMove = (taskId: string, to: BoardColumnKey, index: number) => {
    const t = (tasksQ.data ?? []).find((x) => x.id === taskId);
    if (!t) return;
    const patch = taskMovePatch({
      taskId, task: t, to, index,
      columnTasks: columns.find((c) => c.key === to)?.tasks ?? [],
    });
    if (patch) updateM.mutate({ id: taskId, patch });
  };
```

- [ ] Remove the now-unused `UpdateTaskInput` type import from `packages/web/src/app/pages/Priorities.tsx`:

  old: `import type { Task, UpdateTaskInput } from '../../api/types';`
  new: `import type { Task } from '../../api/types';`

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities src/app/pages/Priorities.test.tsx`. Expected: all pass (`boardDnd.test.ts` 21, `TaskRow.test.tsx` 11, `Priorities.test.tsx` 14).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **618 passed (618), 69 files**.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Confirm the HTML5 board machinery is gone. Run and expect **no matches** for each:

```sh
grep -rn "InsertGap\|ColumnDnd" packages/web/src
grep -rn "dataTransfer" packages/web/src/app/priorities packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx
grep -rn "draggable=" packages/web/src/app/priorities
```

- [ ] Commit:

```sh
git add packages/web/src/app/priorities/boardDnd.ts packages/web/src/app/priorities/boardDnd.test.ts packages/web/src/app/priorities/Board.tsx packages/web/src/app/priorities/Column.tsx packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): priorities board on dnd-kit; retire the FLIP drag path

Board owns the DndContext, each Column is a droppable wrapping a vertical
SortableContext, each TaskRow is a sortable. Board's drag state, ColumnDnd,
InsertGap and every HTML5 handler are deleted; a DragOverlay carries the card
above the board's horizontal scroll container. useFlip stays, now the sole
owner of non-drag movement (post-PATCH refetch, WS re-sort) -- which is why
useSortable gets animateLayoutChanges: () => false.

Drop resolution and the PATCH shape move into pure boardDnd.ts, so all seven
deleted Priorities drag tests keep their exact payload assertions. The one
value that moves is the downward same-column drag (2.5 -> 4): dnd-kit lands
the card where its live preview showed it.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 5 — Drag-to-schedule on dnd-kit (desktop path)

`Planner` owns the `DndContext`; panel task cards become draggables; day columns become droppables through a `pointer-events-none absolute inset-0` child; the drop indicator and the `onScheduleTaskAt` clamp are reused unchanged.

**Files:**
- Create: `packages/web/src/app/planner/scheduleDrop.ts`
- Create (test): `packages/web/src/app/planner/scheduleDrop.test.ts`
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx`
- Modify: `packages/web/src/app/planner/WeekGrid.tsx`
- Modify: `packages/web/src/app/pages/Planner.tsx`
- Modify (test, 1 rewrite): `packages/web/src/app/planner/PlannerTaskPanel.test.tsx`
- Modify (test, 2 deletions + 2 additions): `packages/web/src/app/planner/WeekGrid.test.tsx`
- Modify (test, 1 deletion): `packages/web/src/app/pages/Planner.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/planner/scheduleDrop.ts`:
  - `export const PANEL_TASK_DRAG_TYPE = 'panel-task'`
  - `export interface PanelTaskDragData { type: 'panel-task'; taskId: string }`
  - `export interface DayColumnDropData { type: 'day-col'; dayIndex: number; dayStartMs: number }`
  - `export interface DayDropTarget { dayIndex: number; dayStartMs: number; startMin: number }`
  - `export function draggedTaskId(data: unknown): string | null`
  - `export function pointerClientY(activatorEvent: Event | null, delta: { y: number }): number | null`
  - `export function dayDropFromOver(args: { overData: unknown; overRect: { top: number; height: number } | null; pointerY: number | null }): DayDropTarget | null`
  - `export function pinnedBlockTimes(args: { durationMs: number; dayStartMs: number; startMin: number }): { startsAt: string; endsAt: string }`
- `WeekGridProps` change: **removes** `onScheduleTaskAt`; **adds** `taskDrop?: { dayIndex: number; startMin: number } | null`.
- `PlannerTaskPanelProps` unchanged.

**Steps:**

- [ ] Write the failing test `packages/web/src/app/planner/scheduleDrop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayDropFromOver, draggedTaskId, pinnedBlockTimes, pointerClientY, PANEL_TASK_DRAG_TYPE } from './scheduleDrop';

const DAY = Date.parse('2026-01-07T00:00:00.000Z');
const dayCol = { type: 'day-col', dayIndex: 2, dayStartMs: DAY };

describe('draggedTaskId', () => {
  it('reads the task id off a panel-task drag', () => {
    expect(draggedTaskId({ type: PANEL_TASK_DRAG_TYPE, taskId: 't1' })).toBe('t1');
  });

  it('is null for any other drag payload', () => {
    expect(draggedTaskId({ type: 'sortable' })).toBeNull();
    expect(draggedTaskId(undefined)).toBeNull();
    expect(draggedTaskId(null)).toBeNull();
  });
});

describe('pointerClientY', () => {
  it('adds the drag delta to the activator event coordinates', () => {
    const ev = new MouseEvent('mousedown', { clientX: 10, clientY: 200 });
    expect(pointerClientY(ev, { y: 45 })).toBe(245);
  });

  it('is null without an activator event', () => {
    expect(pointerClientY(null, { y: 45 })).toBeNull();
  });
});

describe('dayDropFromOver', () => {
  it('snaps the pointer offset inside the column to a create slot', () => {
    // 1392px column, pointer 348px down = 25% = 06:00.
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: 348 });
    expect(target).toEqual({ dayIndex: 2, dayStartMs: DAY, startMin: 360 });
  });

  it('accounts for the column being scrolled down the page', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 100, height: 1392 }, pointerY: 448 });
    expect(target!.startMin).toBe(360);
  });

  it('clamps a pointer above the column to the first slot', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: -500 });
    expect(target!.startMin).toBe(0);
  });

  it('clamps a pointer below the column to the last slot', () => {
    const target = dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: 9999 });
    expect(target!.startMin).toBe(24 * 60 - 15);
  });

  it('is null when the drag is not over a day column', () => {
    expect(dayDropFromOver({ overData: { type: 'sortable' }, overRect: { top: 0, height: 1392 }, pointerY: 300 })).toBeNull();
    expect(dayDropFromOver({ overData: null, overRect: null, pointerY: 300 })).toBeNull();
  });

  it('is null without pointer coordinates or a measured column', () => {
    expect(dayDropFromOver({ overData: dayCol, overRect: { top: 0, height: 1392 }, pointerY: null })).toBeNull();
    expect(dayDropFromOver({ overData: dayCol, overRect: null, pointerY: 300 })).toBeNull();
  });
});

describe('pinnedBlockTimes', () => {
  it('places a one-hour task at the dropped slot', () => {
    // Ported from the deleted Planner drop test (jsdom 0-height column => 00:00 slot).
    expect(pinnedBlockTimes({ durationMs: 3_600_000, dayStartMs: DAY, startMin: 0 })).toEqual({
      startsAt: '2026-01-07T00:00:00.000Z',
      endsAt: '2026-01-07T01:00:00.000Z',
    });
  });

  it('pulls a block back so it never runs past the end of the day', () => {
    expect(pinnedBlockTimes({ durationMs: 3_600_000, dayStartMs: DAY, startMin: 23 * 60 + 45 })).toEqual({
      startsAt: '2026-01-07T23:00:00.000Z',
      endsAt: '2026-01-08T00:00:00.000Z',
    });
  });

  it('floors a sub-15-minute task at 15 minutes', () => {
    const { startsAt, endsAt } = pinnedBlockTimes({ durationMs: 60_000, dayStartMs: DAY, startMin: 600 });
    expect(Date.parse(endsAt) - Date.parse(startsAt)).toBe(15 * 60_000);
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/scheduleDrop.test.ts`. Expected failure: `Failed to resolve import "./scheduleDrop"`.

- [ ] Create `packages/web/src/app/planner/scheduleDrop.ts` with exactly:

```ts
import { getEventCoordinates } from '@dnd-kit/utilities';
import { clampToWindow, snapClickToSlot, WINDOW_END_MIN, WINDOW_START_MIN } from './weekModel';

/** Marks a drag that started on a task card in the planner side panel / Tasks sheet. */
export const PANEL_TASK_DRAG_TYPE = 'panel-task';

export interface PanelTaskDragData {
  type: typeof PANEL_TASK_DRAG_TYPE;
  taskId: string;
}

export interface DayColumnDropData {
  type: 'day-col';
  dayIndex: number;
  dayStartMs: number;
}

export interface DayDropTarget {
  dayIndex: number;
  dayStartMs: number;
  startMin: number;
}

/** The task id behind an active drag, or null when the drag is anything else. */
export function draggedTaskId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<PanelTaskDragData>;
  return d.type === PANEL_TASK_DRAG_TYPE && typeof d.taskId === 'string' ? d.taskId : null;
}

/**
 * Viewport Y of the pointer mid-drag. dnd-kit reports the original activator event plus a running
 * translate rather than live coordinates, so the pointer is the sum of the two.
 */
export function pointerClientY(activatorEvent: Event | null, delta: { y: number }): number | null {
  if (!activatorEvent) return null;
  const coords = getEventCoordinates(activatorEvent);
  return coords ? coords.y + delta.y : null;
}

/**
 * Which day column and which 15-minute slot a drag is currently over. Uses the same
 * fraction → `snapClickToSlot` maths the grid's click-to-create has always used, so a dropped card
 * and a tapped slot land on identical times.
 *
 * `pointerY` is reconstructed from dnd-kit's scroll-adjusted `delta` and `overRect` is the rect as
 * measured at drag start (dnd-kit's default WhileDragging strategy does not re-measure on scroll).
 * That pairing is exact, not approximate: if the hours-scroll container scrolls by S mid-drag, the
 * reconstructed pointer is S too high and the stale rect top is S too low, and the two cancel.
 * Do NOT switch the planner context to MeasuringStrategy.Always — it would break the cancellation.
 */
export function dayDropFromOver({ overData, overRect, pointerY }: {
  overData: unknown;
  overRect: { top: number; height: number } | null;
  pointerY: number | null;
}): DayDropTarget | null {
  if (!overData || typeof overData !== 'object') return null;
  const d = overData as Partial<DayColumnDropData>;
  if (d.type !== 'day-col' || typeof d.dayIndex !== 'number' || typeof d.dayStartMs !== 'number') return null;
  if (overRect === null || pointerY === null) return null;
  const fraction = overRect.height > 0 ? (pointerY - overRect.top) / overRect.height : 0;
  return { dayIndex: d.dayIndex, dayStartMs: d.dayStartMs, startMin: snapClickToSlot(fraction) };
}

/**
 * ISO start/end for the pinned block a dropped task creates: at least 15 minutes, never longer
 * than the day window, and pulled back so it cannot spill past the end of the column.
 */
export function pinnedBlockTimes({ durationMs, dayStartMs, startMin }: {
  durationMs: number;
  dayStartMs: number;
  startMin: number;
}): { startsAt: string; endsAt: string } {
  const windowSpan = WINDOW_END_MIN - WINDOW_START_MIN;
  const durationMin = Math.min(Math.max(15, Math.round(durationMs / 60_000)), windowSpan);
  const { startMin: s, endMin: e } = clampToWindow(startMin, durationMin);
  return {
    startsAt: new Date(dayStartMs + s * 60_000).toISOString(),
    endsAt: new Date(dayStartMs + e * 60_000).toISOString(),
  };
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/scheduleDrop.test.ts`. Expected: 13 tests pass.

- [ ] **Rewrite the one pre-existing HTML5 test** in `packages/web/src/app/planner/PlannerTaskPanel.test.tsx`. Replace the test named *"task cards are draggable and seed the dataTransfer with the task id"* in full:

  old:
```tsx
  it('task cards are draggable and seed the dataTransfer with the task id', () => {
    renderPanel([task({ id: 'drag-me', title: 'Grab me' })]);
    const card = screen.getByTestId('panel-task');
    expect(card).toHaveAttribute('draggable', 'true');
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'drag-me');
    expect(setData).toHaveBeenCalledWith('application/x-nr-task', 'drag-me');
  });
```
  new:
```tsx
  it('task cards are dnd-kit draggables keyed by the task id', () => {
    renderPanel([task({ id: 'drag-me', title: 'Grab me' })]);
    const card = screen.getByTestId('panel-task');
    expect(card).toHaveAttribute('aria-roledescription', 'draggable');
    expect(card).toHaveAttribute('data-task-id', 'drag-me');
    expect(card).not.toHaveAttribute('draggable');
  });
```

- [ ] Edit `packages/web/src/app/planner/PlannerTaskPanel.tsx`. Replace the import block (lines 1–6):

  old:
```tsx
import { useMemo, useState } from 'react';
import type { Task, SchedulePreview, UnscheduledItem } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
import {
  BUCKETS, BUCKET_META, priorityToBucket, sortBucket, relativeDayTimeLabel, nextBlockMsForTask,
} from '../priorities/priorityBucket';
```
  new:
```tsx
import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task, SchedulePreview, UnscheduledItem } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
import { PANEL_TASK_DRAG_TYPE } from './scheduleDrop';
import {
  BUCKETS, BUCKET_META, priorityToBucket, sortBucket, relativeDayTimeLabel, nextBlockMsForTask,
} from '../priorities/priorityBucket';
```

- [ ] Replace the `TaskCard` opening of `packages/web/src/app/planner/PlannerTaskPanel.tsx` — from the `const due = dueLabel(task);` line through the card's opening `<div … >` tag.

  old:
```tsx
  const due = dueLabel(task);
  const next = nextMs != null ? `Next: ${relativeDayTimeLabel(nextMs, nowMs)}` : null;
  const meta = [due, next].filter(Boolean).join(' · ');
  return (
    <div
      data-testid="panel-task"
      draggable
      onDragStart={(e) => {
        // Firefox aborts HTML5 drags without setData; the custom type lets the grid
        // distinguish a task-card drag from anything else during dragover.
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.setData('application/x-nr-task', task.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title="Drag onto the calendar to schedule"
      className={`group relative flex cursor-grab items-center gap-2.5 border-l-[3px] ${leftBorder} rounded-r-[10px] border-y border-r border-line bg-card px-3 py-2.5 shadow-card active:cursor-grabbing`}
    >
```
  new:
```tsx
  const due = dueLabel(task);
  const next = nextMs != null ? `Next: ${relativeDayTimeLabel(nextMs, nowMs)}` : null;
  const meta = [due, next].filter(Boolean).join(' · ');
  // The overlay card follows the pointer, so this one stays put and only dims.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `panel-task:${task.id}`,
    data: { type: PANEL_TASK_DRAG_TYPE, taskId: task.id },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="panel-task"
      data-task-id={task.id}
      {...attributes}
      {...listeners}
      title="Drag onto the calendar to schedule"
      className={`group relative flex cursor-grab items-center gap-2.5 border-l-[3px] ${leftBorder} rounded-r-[10px] border-y border-r border-line bg-card px-3 py-2.5 shadow-card active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
```

- [ ] **Delete the two pre-existing HTML5 tests** from `packages/web/src/app/planner/WeekGrid.test.tsx`: the tests named *"dropping a task card on a day column calls onScheduleTaskAt with the day + slot"* and *"ignores dragover that is not a task card (no indicator)"*. Their behaviour is now split between `scheduleDrop.test.ts` (`dayDropFromOver` snapping, and its null result for a non-day-column drag) and the two replacements below.

- [ ] Add the two replacement tests to `packages/web/src/app/planner/WeekGrid.test.tsx`, at the position the deleted pair occupied:

```tsx
  it('registers a drop zone spanning each day column', () => {
    renderGrid();
    const zone = screen.getByTestId('day-drop-0');
    expect(screen.getByTestId('day-col-0').contains(zone)).toBe(true);
    // Rect maths only: the zone must never eat the column's click-to-create tap.
    expect(zone.className).toContain('pointer-events-none');
    expect(zone.className).toContain('absolute');
    expect(zone.className).toContain('inset-0');
  });

  it('renders the drop indicator from the taskDrop prop and highlights that column', () => {
    renderGrid({ taskDrop: { dayIndex: 1, startMin: 360 } });
    const indicator = screen.getByTestId('task-drop-indicator');
    expect(indicator.style.top).toBe('25%'); // 06:00 of a 24h column
    expect(screen.getByTestId('day-col-1').className).toContain('bg-indigoSoft/60');
    expect(screen.getByTestId('day-col-0').className).not.toContain('bg-indigoSoft/60');
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`. Expected failure: 2 failures — `day-drop-0` is not in the document and `taskDrop` is not a `WeekGridProps` key (a `tsc` error surfaces at build time; the test fails at runtime because no indicator renders).

- [ ] Edit `packages/web/src/app/planner/WeekGrid.tsx`. Replace the import block (lines 1–8):

  old:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { InteractiveBlock } from './InteractiveBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign, swipeDecision } from './weekModel';
import { CreatePopover } from './CreatePopover';
import { layoutOverlaps } from './overlapLayout';
import { Icons } from '../shell/icons';
```
  new:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { InteractiveBlock } from './InteractiveBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign, swipeDecision } from './weekModel';
import { CreatePopover } from './CreatePopover';
import { layoutOverlaps } from './overlapLayout';
import { Icons } from '../shell/icons';

/**
 * Registers a day column as a dnd-kit droppable without restructuring the grid: hooks cannot run
 * inside the `days.map` loop, and the column has only a `border-l`, so an `inset-0` child has
 * exactly the rect the old `slotFromEvent` measured. Collision detection is rect maths, never DOM
 * hit-testing, so `pointer-events-none` keeps the column's click-to-create tap completely intact.
 */
function DayDropZone({ dayIndex, dayStartMs }: { dayIndex: number; dayStartMs: number }) {
  const { setNodeRef } = useDroppable({
    id: `day-col:${dayIndex}`,
    data: { type: 'day-col', dayIndex, dayStartMs },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`day-drop-${dayIndex}`}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    />
  );
}
```

- [ ] Replace the drag-to-schedule props in `WeekGridProps` in `packages/web/src/app/planner/WeekGrid.tsx`:

  old:
```tsx
  onScheduleTaskAt?: (taskId: string, dayStartMs: number, startMin: number) => void;
```
  new:
```tsx
  /** Live drop target while a task card is dragged over the grid (owned by Planner's DndContext). */
  taskDrop?: { dayIndex: number; startMin: number } | null;
```

- [ ] Replace the destructuring line and the drag state in `packages/web/src/app/planner/WeekGrid.tsx`:

  old:
```tsx
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, onScheduleTaskAt, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false, coarse = false } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events, zone);
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
  // Live drop indicator while dragging a task card from the side panel over the grid.
  const [taskDrop, setTaskDrop] = useState<{ dayIndex: number; startMin: number } | null>(null);
```
  new:
```tsx
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, taskDrop = null, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false, coarse = false } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
  const items = toItems(blocks, events, zone);
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
```

- [ ] Delete the window `dragend` effect from `packages/web/src/app/planner/WeekGrid.tsx` — remove this whole block:

```tsx
  // Always clear the drop indicator when any drag ends — covers ESC-cancel and drops that
  // land off the grid, where no column `dragleave`/`drop` fires (dragend fires on the source).
  useEffect(() => {
    const clear = () => setTaskDrop(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
```

- [ ] Replace the day-column opening tag in `packages/web/src/app/planner/WeekGrid.tsx` (deleting the three HTML5 handlers and adding the drop zone).

  old:
```tsx
                <div key={d} data-testid={`day-col-${i}`}
                  className={`relative border-l border-line ${taskDrop?.dayIndex === i ? 'bg-indigoSoft/60' : ''}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-testid="event-block"],[data-testid="create-popover"]')) return;
                    setCreating({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                  onDragOver={(e) => {
                    // Only react to task cards dragged from the side panel.
                    if (!onScheduleTaskAt || !e.dataTransfer.types.includes('application/x-nr-task')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setTaskDrop({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                  onDragLeave={(e) => {
                    // Ignore leaves into child elements of the same column.
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setTaskDrop((p) => (p?.dayIndex === i ? null : p));
                  }}
                  onDrop={(e) => {
                    if (!onScheduleTaskAt) return;
                    const taskId = e.dataTransfer.getData('application/x-nr-task') || e.dataTransfer.getData('text/plain');
                    setTaskDrop(null);
                    if (!taskId) return;
                    e.preventDefault();
                    onScheduleTaskAt(taskId, d, slotFromEvent(e));
                  }}
                >
                  {HOURS.map((h) => <div key={h} className="h-[58px] border-t border-[#f1f2f6]" />)}
```
  new:
```tsx
                <div key={d} data-testid={`day-col-${i}`}
                  className={`relative border-l border-line ${taskDrop?.dayIndex === i ? 'bg-indigoSoft/60' : ''}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[data-testid="event-block"],[data-testid="create-popover"]')) return;
                    setCreating({ dayIndex: i, startMin: slotFromEvent(e) });
                  }}
                >
                  <DayDropZone dayIndex={i} dayStartMs={d} />
                  {HOURS.map((h) => <div key={h} className="h-[58px] border-t border-[#f1f2f6]" />)}
```

- [ ] **Delete the pre-existing HTML5 drop test** from `packages/web/src/app/pages/Planner.test.tsx`: the test named *"dragging a task from the panel onto a day column creates a pinned block at the slot"*. Its payload assertion (`{taskId:'t1', startsAt:'2026-01-07T00:00:00.000Z', endsAt:'2026-01-07T01:00:00.000Z'}`) is ported verbatim into `scheduleDrop.test.ts`'s `pinnedBlockTimes` test.

- [ ] Edit `packages/web/src/app/pages/Planner.tsx`. Replace the import block (lines 1–15):

  old:
```tsx
import { useMemo, useState, useEffect, useRef } from 'react';
import type { CalendarEvent, Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useHabitsQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, dayAnchor, clampToWindow, rangeLabel, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { useCompactWidth, usePointerCoarse } from '../lib/useMediaQuery';
import { Sheet } from '../components/Sheet';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { UnscheduledWarning } from '../planner/UnscheduledWarning';
import { summarizeUnscheduled } from '../planner/unscheduledSummary';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { EventDrawer } from '../planner/EventDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';
```
  new:
```tsx
import { useMemo, useState, useEffect, useRef } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import type { CalendarEvent, Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useHabitsQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, dayAnchor, rangeLabel, MS_PER_DAY } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { useCompactWidth, usePointerCoarse } from '../lib/useMediaQuery';
import { useDragToScheduleSensors, pointerFirstCollision } from '../dnd/sensors';
import { dayDropFromOver, draggedTaskId, pinnedBlockTimes, pointerClientY, type DayDropTarget } from '../planner/scheduleDrop';
import { Sheet } from '../components/Sheet';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { UnscheduledWarning } from '../planner/UnscheduledWarning';
import { summarizeUnscheduled } from '../planner/unscheduledSummary';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { EventDrawer } from '../planner/EventDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';
```

- [ ] Replace the `onScheduleTaskAt` handler in `packages/web/src/app/pages/Planner.tsx` with the dnd-kit wiring:

  old:
```tsx
  // Drag a task card from the side panel onto a day column → create a pinned block at the slot.
  const onScheduleTaskAt = (taskId: string, dayStartMs: number, startMin: number) => {
    const task = (tasksQ.data ?? []).find((t) => t.id === taskId);
    if (!task) return;
    const windowSpan = WINDOW_END_MIN - WINDOW_START_MIN;
    const durationMin = Math.min(Math.max(15, Math.round(task.durationMs / 60_000)), windowSpan);
    const { startMin: s, endMin: e } = clampToWindow(startMin, durationMin);
    createBlock.mutate({
      taskId,
      startsAt: new Date(dayStartMs + s * 60_000).toISOString(),
      endsAt: new Date(dayStartMs + e * 60_000).toISOString(),
    });
  };
```
  new:
```tsx
  // Drag a task card from the side panel / Tasks sheet onto a day column → pinned block at the slot.
  const dragSensors = useDragToScheduleSensors();
  const [taskDrop, setTaskDrop] = useState<DayDropTarget | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const draggingTask = (tasksQ.data ?? []).find((t) => t.id === draggingTaskId) ?? null;

  const onScheduleTaskAt = (taskId: string, dayStartMs: number, startMin: number) => {
    const task = (tasksQ.data ?? []).find((t) => t.id === taskId);
    if (!task) return;
    createBlock.mutate({ taskId, ...pinnedBlockTimes({ durationMs: task.durationMs, dayStartMs, startMin }) });
  };

  const targetFrom = (e: DragMoveEvent | DragEndEvent): DayDropTarget | null => dayDropFromOver({
    overData: e.over?.data.current ?? null,
    overRect: e.over?.rect ?? null,
    pointerY: pointerClientYOf(e),
  });

  const onDragStart = (e: DragStartEvent) => setDraggingTaskId(draggedTaskId(e.active.data.current));
  const onDragMove = (e: DragMoveEvent) => setTaskDrop(draggedTaskId(e.active.data.current) ? targetFrom(e) : null);
  const endDrag = () => { setTaskDrop(null); setDraggingTaskId(null); };
  const onDragEnd = (e: DragEndEvent) => {
    const taskId = draggedTaskId(e.active.data.current);
    const target = taskId ? targetFrom(e) : null;
    endDrag();
    if (taskId && target) onScheduleTaskAt(taskId, target.dayStartMs, target.startMin);
  };
```

- [ ] Add the small `pointerClientYOf` adapter just above `export function Planner(` in `packages/web/src/app/pages/Planner.tsx`:

```tsx
/** dnd-kit reports an activator event plus a running translate; the pure helper turns that into Y. */
function pointerClientYOf(e: { activatorEvent: Event; delta: { y: number } }): number | null {
  return pointerClientY(e.activatorEvent, e.delta);
}
```

- [ ] Wrap the Planner tree in the `DndContext` and swap the WeekGrid prop. Replace the returned JSX of `packages/web/src/app/pages/Planner.tsx` — from `  return (\n    <div className="flex h-full min-h-0 gap-3 p-2 md:p-4">` through the closing `  );\n}` — with:

```tsx
  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
    <div className="flex h-full min-h-0 gap-3 p-2 md:p-4">
      <div ref={gridRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isLoading && <div className="shrink-0 p-2 text-sm text-gray-500">Loading your days…</div>}
        <UnscheduledWarning entries={unscheduledEntries} />
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={rangeLabel(days, zone)}
          blocks={labeledBlocks}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setViewStartMs((ms) => shiftDays(ms, -dayCount, zone))}
          onNext={() => setViewStartMs((ms) => shiftDays(ms, dayCount, zone))}
          onToday={() => setViewStartMs(dayAnchor(now(), zone, dayStartMinute))}
          zone={zone}
          dayStartMinute={dayStartMinute}
          onReplan={() => replan.mutate()}
          onCommit={(id, patch) => updateBlock.mutate({ id, patch })}
          onDeleteBlock={(id) => deleteBlock.mutate(id)}
          onCommitEvent={(id, patch) => updateEvent.mutate({ id, ...patch })}
          onEditEvent={openEventDrawer}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          taskDrop={taskDrop}
          accents={accents}
          compact={compact}
          coarse={coarse}
          // Compact: the toggle reflects the sheet, so `panelHidden` (its aria-expanded source)
          // must track the sheet rather than the persisted desktop hide flag.
          panelHidden={compact ? !taskSheetOpen : panelHidden}
          onTogglePanel={() => (compact ? setTaskSheetOpen((o) => !o) : setPanelHidden((h) => !h))}
        />
        {replan.isError && <p className="mt-2 shrink-0 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      {/* Below md the panel never renders inline — it becomes the bottom sheet below. */}
      {!compact && !panelHidden && <PlannerTaskPanel {...panelProps} />}
      {compact && taskSheetOpen && (
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)}>
          <PlannerTaskPanel {...panelProps} compact />
        </Sheet>
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
      {editingEvent && (
        <div className="fixed right-3 top-[84px] z-40">
          {/* Key on the event's times: a background refetch (or a drag) that moves the event
              remounts the drawer so its fields re-seed instead of holding stale values. */}
          <EventDrawer
            key={`${editingEvent.id}:${editingEvent.startsAt}:${editingEvent.endsAt}`}
            event={editingEvent} zone={zone} onClose={() => setEditingEventId(null)}
          />
        </div>
      )}
    </div>
    <DragOverlay>
      {draggingTask ? (
        <div
          data-testid="schedule-drag-overlay"
          className="rounded-[10px] border border-line bg-card px-3 py-2 text-[14px] font-bold text-ink shadow-pop"
        >
          {draggingTask.title}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner src/app/pages/Planner.test.tsx`. Expected: all pass (`scheduleDrop.test.ts` 13, `WeekGrid.test.tsx` unchanged count, `Planner.test.tsx` one fewer).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **630 passed (630), 70 files**.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Confirm the last HTML5 DnD is gone. Run and expect **no matches** for each:

```sh
grep -rn "dataTransfer" packages/web/src
grep -rn "application/x-nr-task" packages/web/src
grep -rn "addEventListener('dragend'" packages/web/src
grep -rn "onDragLeave" packages/web/src
grep -rn "draggable=" packages/web/src
```

- [ ] Commit:

```sh
git add packages/web/src/app/planner/scheduleDrop.ts packages/web/src/app/planner/scheduleDrop.test.ts packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): drag-to-schedule on dnd-kit

Planner owns a DndContext; panel cards are draggables; each day column
registers a droppable through a pointer-events-none inset-0 child, so the
column's click-to-create tap is untouched and the rect stays exactly what the
old slotFromEvent measured. A DragOverlay follows the pointer and the drop
indicator now renders from a `taskDrop` prop.

The slot maths, the pointer reconstruction and the pinned-block clamp move
into pure scheduleDrop.ts -- the deleted Planner drop test's exact ISO payload
is asserted there instead.

Removes the last dataTransfer, the application/x-nr-task type and the window
dragend listener from the codebase.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 6 — The Tasks sheet collapses to a strip while a drag is in flight (mobile)

Spec §3, migration 4: *"when a drag starts inside the task sheet, the sheet collapses to a slim bottom strip for the drag's duration (grid visible), then restores."*

The sheet **slides down** rather than shrinking or unmounting its children: the dragged card must stay mounted or dnd-kit loses the active draggable node mid-gesture and aborts the drag.

**Files:**
- Create: `packages/web/src/app/planner/dragSheet.ts`
- Create (test): `packages/web/src/app/planner/dragSheet.test.ts`
- Modify: `packages/web/src/app/components/Sheet.tsx`
- Modify (test, 2 additions): `packages/web/src/app/components/Sheet.test.tsx`
- Modify: `packages/web/src/app/pages/Planner.tsx`

**Interfaces:**
- Produces `packages/web/src/app/planner/dragSheet.ts`:
  - `export const COLLAPSED_SHEET_STRIP_PX = 56`
  - `export function shouldCollapseSheet(args: { compact: boolean; sheetOpen: boolean; isTaskDrag: boolean }): boolean`
- `SheetProps` change: **adds** `collapsed?: boolean` (default `false`).

**Steps:**

- [ ] Write the failing test `packages/web/src/app/planner/dragSheet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COLLAPSED_SHEET_STRIP_PX, shouldCollapseSheet } from './dragSheet';

describe('shouldCollapseSheet', () => {
  it('collapses when a task drag starts inside an open sheet on the compact layout', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: true, isTaskDrag: true })).toBe(true);
  });

  it('never collapses on the desktop layout — the panel is inline there', () => {
    expect(shouldCollapseSheet({ compact: false, sheetOpen: true, isTaskDrag: true })).toBe(false);
  });

  it('does nothing when the sheet is already closed', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: false, isTaskDrag: true })).toBe(false);
  });

  it('ignores drags that are not task cards', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: true, isTaskDrag: false })).toBe(false);
  });

  it('leaves a strip tall enough to grab the sheet back', () => {
    expect(COLLAPSED_SHEET_STRIP_PX).toBe(56);
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/dragSheet.test.ts`. Expected failure: `Failed to resolve import "./dragSheet"`.

- [ ] Create `packages/web/src/app/planner/dragSheet.ts` with exactly:

```ts
/**
 * How much of the Tasks sheet stays on screen while it is collapsed for a drag. Must match the
 * `translate-y-[calc(100%_-_56px)]` literal in `Sheet` — Tailwind needs the literal string, so the
 * constant is the documentation, not the source of the class.
 */
export const COLLAPSED_SHEET_STRIP_PX = 56;

/**
 * Whether the Tasks bottom sheet should drop to a strip for the duration of a drag. Only on the
 * compact layout (on desktop the panel is an inline column that never covers the grid) and only
 * for a task-card drag — the grid has to be visible and droppable underneath.
 */
export function shouldCollapseSheet({ compact, sheetOpen, isTaskDrag }: {
  compact: boolean;
  sheetOpen: boolean;
  isTaskDrag: boolean;
}): boolean {
  return compact && sheetOpen && isTaskDrag;
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/dragSheet.test.ts`. Expected: 5 tests pass.

- [ ] Append the two new tests to `packages/web/src/app/components/Sheet.test.tsx`:

```tsx
describe('Sheet collapsed for a drag', () => {
  it('slides down to a strip while keeping its children mounted', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()} collapsed><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet.className).toContain('translate-y-[calc(100%_-_56px)]');
    // Unmounting the children would drop the dragged card out of the DOM and abort the drag.
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('lets the grid underneath receive the drag and does not dismiss on a stray click', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose} collapsed><p>body</p></Sheet>);
    const backdrop = screen.getByTestId('sheet-backdrop');
    expect(backdrop.className).toContain('pointer-events-none');
    expect(backdrop.className).not.toContain('bg-black/30');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx`. Expected failure: 2 failures — `collapsed` is not a `SheetProps` key and neither class is present.

- [ ] Replace `packages/web/src/app/components/Sheet.tsx` **in full** with:

```tsx
import type { ReactElement, ReactNode } from 'react';

export interface SheetProps {
  /** Accessible name; also used for the close button's label. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Literal Tailwind height class for the sheet body (JIT-visible at every call site). */
  heightClass?: string;
  /**
   * Slide the sheet down to a strip and make the backdrop inert, for the duration of a drag that
   * started inside it. The children stay mounted on purpose: unmounting the dragged card would
   * remove dnd-kit's active draggable node and abort the gesture.
   */
  collapsed?: boolean;
}

/**
 * Bottom sheet for phones: full-width, anchored to the bottom edge, drag-handle header, backdrop
 * tap dismisses. Sits on the app's modal tier (`z-50`, same as NewTaskModal) — MobileTabBar is a
 * z-40 bar pinned to the same bottom edge and rendered later in AppShell, so anything below z-50
 * would let taps in the bottom strip fall through to the tabs and navigate away.
 * Only rendered on the compact layout — desktop surfaces keep their inline panels.
 * Drawers (Task/Event/Habit) are NOT sheets yet; that is Phase 4.
 */
export function Sheet({ label, onClose, children, heightClass = 'h-[70dvh]', collapsed = false }: SheetProps): ReactElement {
  return (
    <div
      data-testid="sheet-backdrop"
      onClick={collapsed ? undefined : onClose}
      className={collapsed ? 'pointer-events-none fixed inset-0 z-50' : 'fixed inset-0 z-50 bg-black/30'}
    >
      <div
        data-testid="sheet"
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 flex ${heightClass} flex-col rounded-t-[18px] border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-pop transition-transform duration-200 ${collapsed ? 'translate-y-[calc(100%_-_56px)]' : 'translate-y-0'}`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2">
          <span className="w-10" />
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
          <button
            type="button"
            data-testid="sheet-close"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="w-10 rounded-[9px] p-2 text-inkSoft"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx`. Expected: 6 tests pass.

- [ ] Wire the collapse into `packages/web/src/app/pages/Planner.tsx`. Extend the `scheduleDrop` import line added in Task 5 with the new module:

  old:
```tsx
import { dayDropFromOver, draggedTaskId, pinnedBlockTimes, pointerClientY, type DayDropTarget } from '../planner/scheduleDrop';
```
  new:
```tsx
import { dayDropFromOver, draggedTaskId, pinnedBlockTimes, pointerClientY, type DayDropTarget } from '../planner/scheduleDrop';
import { shouldCollapseSheet } from '../planner/dragSheet';
```

- [ ] Replace the drag lifecycle handlers in `packages/web/src/app/pages/Planner.tsx` (as they stand after Task 5):

  old:
```tsx
  const onDragStart = (e: DragStartEvent) => setDraggingTaskId(draggedTaskId(e.active.data.current));
  const onDragMove = (e: DragMoveEvent) => setTaskDrop(draggedTaskId(e.active.data.current) ? targetFrom(e) : null);
  const endDrag = () => { setTaskDrop(null); setDraggingTaskId(null); };
```
  new:
```tsx
  const onDragStart = (e: DragStartEvent) => {
    const taskId = draggedTaskId(e.active.data.current);
    setDraggingTaskId(taskId);
    if (shouldCollapseSheet({ compact, sheetOpen: taskSheetOpen, isTaskDrag: taskId !== null })) setSheetCollapsed(true);
  };
  const onDragMove = (e: DragMoveEvent) => setTaskDrop(draggedTaskId(e.active.data.current) ? targetFrom(e) : null);
  const endDrag = () => { setTaskDrop(null); setDraggingTaskId(null); setSheetCollapsed(false); };
```

- [ ] Add the collapse state to `packages/web/src/app/pages/Planner.tsx`, immediately after the `taskSheetOpen` declaration:

  old:
```tsx
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
```
  new:
```tsx
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  // Dropped to a strip while a card is dragged out of the sheet, so the grid below is visible and
  // droppable. Cleared on drag end and on cancel; never persisted.
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
```

- [ ] Pass the flag to the sheet in `packages/web/src/app/pages/Planner.tsx`:

  old:
```tsx
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)}>
```
  new:
```tsx
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)} collapsed={sheetCollapsed}>
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx src/app/components/Sheet.test.tsx src/app/planner/dragSheet.test.ts`. Expected: all pass.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **637 passed (637), 71 files**.

- [ ] Run `npm run build -w @notreclaim/web`. Expected: `tsc` clean, then a successful `vite build`.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/dragSheet.ts packages/web/src/app/planner/dragSheet.test.ts packages/web/src/app/components/Sheet.tsx packages/web/src/app/components/Sheet.test.tsx packages/web/src/app/pages/Planner.tsx
git commit -m "$(cat <<'EOF'
feat(web): collapse the Tasks sheet while dragging a card onto the grid

Spec section 3: on the compact layout a drag that starts inside the Tasks
sheet slides it down to a 56px strip and makes the backdrop inert, so the day
columns underneath are visible and droppable; drag end or cancel restores it.

The sheet slides rather than unmounting its children -- removing the dragged
card from the DOM would drop dnd-kit's active draggable node and abort the
gesture mid-drag.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 7 — CLAUDE.md convention change + phase gate

**Files:**
- Modify: `CLAUDE.md`

**Steps:**

- [ ] Edit `CLAUDE.md`. Replace line 66 exactly:

  old:
```
- Frontend drag-and-drop uses native HTML5 DnD; `dragstart` must call `dataTransfer.setData` or Firefox won't drag.
```
  new:
```
- Frontend drag-and-drop: **list / cross-container DnD uses dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`; shared sensors and collision strategy in `packages/web/src/app/dnd/sensors.ts` — `MouseSensor` 4px + `TouchSensor` 250ms/8px + `KeyboardSensor`). **Continuous geometric drag (planner blocks) uses raw pointer events** (`InteractiveBlock`). Drop decisions live in pure modules (`boardDnd.ts`, `subtaskDnd.ts`, `scheduleDrop.ts`) because jsdom cannot drive a real gesture — component tests assert wiring, gestures are verified live.
```

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **637 passed (637), 71 files**.

- [ ] Run the whole monorepo suite `npm test`. Expected: every workspace green, `@notreclaim/web` at 637/71. (`@notreclaim/db` needs `packages/db/.env.test`; it is present in the main checkout.)

- [ ] Run the build gate `npm run build`. Expected: every workspace compiles; `@notreclaim/web` finishes `tsc` then `vite build`.

- [ ] Run the grep guards and confirm each result:

```sh
# every trace of native HTML5 DnD is gone from the web source
grep -rn "dataTransfer" packages/web/src                      # expect: no matches
grep -rn "draggable=" packages/web/src                        # expect: no matches
grep -rn "onDragLeave" packages/web/src                       # expect: no matches
grep -rn "application/x-nr-task" packages/web/src             # expect: no matches
grep -rn "'dragend'\|\"dragend\"" packages/web/src            # expect: no matches
# the retired board machinery is gone
grep -rn "InsertGap\|ColumnDnd" packages/web/src              # expect: no matches
# useFlip survives, and only in the priorities board
grep -rln "useFlip" packages/web/src                          # expect: exactly useFlip.ts and priorities/Column.tsx
# the planner block drag is still raw pointer events (NOT migrated)
grep -c "setPointerCapture" packages/web/src/app/planner/InteractiveBlock.tsx   # expect: 1 or more
grep -rn "@dnd-kit" packages/web/src/app/planner/InteractiveBlock.tsx           # expect: no matches
# the CLAUDE.md convention actually changed
grep -n "dnd-kit" CLAUDE.md                                   # expect: the new bullet
grep -n "dataTransfer.setData" CLAUDE.md                      # expect: no matches
# no `import React` crept in
grep -rn "^import React" packages/web/src                     # expect: no matches
# no computed Tailwind class names in the files this phase touched
grep -rnE "className=\{\`[^\`]*\$\{[a-zA-Z]+\}(px|rem)" packages/web/src/app/priorities packages/web/src/app/planner packages/web/src/app/components/Sheet.tsx   # expect: no matches
# the new pure modules are Date.now-free
grep -rn "Date.now()" packages/web/src/app/priorities/boardDnd.ts packages/web/src/app/tasks/subtaskDnd.ts packages/web/src/app/planner/scheduleDrop.ts packages/web/src/app/planner/dragSheet.ts   # expect: no matches
# Phase 4 surfaces untouched apart from TaskDrawer's subtask list
git diff --name-only HEAD~6..HEAD | grep -E "EventDrawer|HabitDrawer|NewTaskModal|useClickOutside"   # expect: no matches
```

- [ ] Commit:

```sh
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: dnd-kit is the frontend DnD convention

Replaces the HTML5 setData/Firefox bullet: list and cross-container DnD uses
dnd-kit with the shared sensors in src/app/dnd/sensors.ts; continuous
geometric drag (planner blocks) stays on raw pointer events.

Completes mobile Phase 3: web suite 637 / 71 files.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

### Live verification (after the last commit)

**Restart Vite before looking at anything** — stale Vite state has produced false "not fixed" reports three times in this project's history (R13, R14, Phase 2). Rebuild and restart the API too if it is running from `dist/`.

- [ ] **1280 × 900, mouse — desktop regression, the primary gate.** Priorities route.
  - A single **click** on a card opens the drawer (the 4px threshold must not eat it); a click on ✓ completes; a click on the kebab opens the menu; a click on a subtask checkbox toggles it without opening the drawer.
  - Drag a card **within** a column: the gap opens live and the other cards slide; drop and the position sticks after the refetch (watch for a double-animation — dnd-kit's in-drag reflow plus `useFlip` — there must be exactly one movement).
  - Drag a card **down** past the last card in its column: it lands **last**, not second-to-last. (This is the deliberate `2.5 → 4` semantic change.)
  - Drag a card **across** columns onto another card, and onto the empty area below a column's cards: the target column shows the dashed outline; the priority chip/border changes on drop.
  - Drag a card into **Backlog** and back out; drag onto **Completed** — the completed column must show no outline and reject the drop.
  - Drag a **subtask** on a card: only the subtask moves, the card never lifts.
  - Drag a card from one column and release over nothing (outside the board): no PATCH, everything returns.
- [ ] **1280 × 900, mouse — planner.** Drag a task card from the right panel over the grid: the day column tints, the indicator tracks the pointer at 15-minute granularity, the overlay card follows the cursor, and the drop creates a pinned block at the indicated time. Tap an empty grid slot afterwards — the create popover must still open at the tapped time (the drop zone must not have eaten it). Drag and release outside the grid: nothing is created and the tint clears.
- [ ] **1280 × 900 — TaskDrawer.** Open a task with 3+ subtasks; drag one up and one down; both persist after the refetch.
- [ ] **Keyboard, desktop.** Tab to a board card → press **Space** (it lifts, a live-region announcement appears) → **↓ ↓** → **Space** to drop → the PATCH fires and the order sticks. **Esc** mid-lift cancels cleanly. Repeat once on a drawer subtask list. *(Keyboard drag-to-schedule is deliberately absent — a day column cannot be reached this way and that is expected.)*
- [ ] **390 × 844, touch emulation on.** Planner route.
  - Tap "Tasks" → the sheet rises. **Long-press a card ~300ms and drag** → the sheet slides down to a strip, the grid is visible and the indicator tracks the finger; release over a day column → a pinned block appears and the sheet slides back up.
  - **Flick** (fast swipe) on a task card inside the sheet → the sheet's list scrolls; no drag starts and the sheet does not collapse.
  - Cancel a drag (drag back over the sheet strip and release, or press Escape) → the sheet restores and nothing is created.
- [ ] **390 × 844 — Priorities route.** Long-press a card → it lifts; drag within the column and across to the neighbouring column (the board scrolls horizontally — check that a horizontal flick still scrolls the board rather than lifting a card). Long-press a subtask → only it moves.

**Deferred to the user's real Android device (per spec §5 — emulated long-press and drag are not trustworthy):**

- [ ] Chrome **and** Firefox on Android: board reorder within and across columns, card-subtask reorder, drawer-subtask reorder, and drag-from-sheet-to-grid.
- [ ] Confirm scroll is never stolen: a quick vertical flick anywhere on the board or a subtask list scrolls; a quick horizontal flick pans the board between columns.
- [ ] Report whether `COARSE_DRAG_ACTIVATION` (`{delay: 250, tolerance: 8}`) feels right — it is the single tuning knob, exported from `src/app/dnd/sensors.ts`, and it is shared by all four surfaces. If a 250ms hold feels laggy next to the planner block's 350ms long-press, say so; if drags fire while scrolling, the tolerance is what to lower.
- [ ] Documented fallback if Android Firefox proves flaky mid-drag inside the hours-scroll container: add `touch-action: none` (`touch-none`) to the *draggable card only* on coarse pointers. Do **not** add it to the board columns — that would kill the board's horizontal scroll.

---

## Phase-3 coverage check (spec §3 + brief)

| Requirement | Where |
| --- | --- |
| `@dnd-kit/core` + `@dnd-kit/sortable` dependency, pinned | Task 1 (6.3.1 / 10.0.0 / utilities 3.2.2) |
| Pointer sensor, small distance threshold on fine pointers | Task 1 (`MouseSensor` + `FINE_DRAG_ACTIVATION`, with the PointerSensor rationale) |
| Touch sensor ~250ms delay + tolerance on coarse | Task 1 (`TouchSensor` + `COARSE_DRAG_ACTIVATION`) |
| Keyboard sensor → reorders become keyboard-accessible | Task 1 (`useAppSensors`); verified in the live-check keyboard step |
| **1.** Priorities board: `SortableContext` per column | Task 4 (`Column`) |
| **1.** FLIP *drag* path retires; `useFlip` stays for server-driven re-sorts | Task 4 (`InsertGap`/`ColumnDnd`/`drag` state deleted; `animateLayoutChanges: () => false`; grep guard in Task 7) |
| **1.** Same optimistic commit + `sortOrder` PATCH on drop | Task 4 (`taskMovePatch` lifted verbatim; no `onMutate` added or removed) |
| **2.** Card subtask reorder, same persistence | Task 3 |
| **3.** Drawer subtask reorder, same persistence | Task 2 |
| **4.** `DndContext` at Planner level, day columns as droppables | Task 5 (`DayDropZone`) |
| **4.** Reuses the drop indicator and the `onScheduleTaskAt` clamp | Task 5 (`taskDrop` prop; `pinnedBlockTimes`) |
| **4.** `DragOverlay` card follows the pointer | Task 5 (planner) + Task 4 (board, for its scroll container) |
| **4. Mobile:** drag from the sheet collapses it to a slim strip, then restores | Task 6 |
| Convention change in CLAUDE.md | Task 7 |
| jsdom testability: pure decision modules, wiring-only component tests, gestures live | Tasks 2–6 (`subtaskDnd`, `boardDnd`, `scheduleDrop`, `dragSheet`); live-check gate in Task 7 |
| Clicks/taps that open drawers and popovers survive the sensors | Task 1 (distance constraint) + Task 5 (`pointer-events-none` drop zone); verified in the desktop and touch live-checks |
| Keyboard drag-to-schedule explicitly out of scope | Task 1 (`useDragToScheduleSensors`) + the live-check note |
