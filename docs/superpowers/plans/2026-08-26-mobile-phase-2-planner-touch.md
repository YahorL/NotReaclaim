# Mobile Phase 2 — Planner Touch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner *usable* on a phone (~375–430px, touch-only) without changing anything at `md+` on a fine pointer: a today-anchored 1-day column window with a 44px time gutter, long-press-armed block drag with edge auto-scroll, a drag-immediate enlarged resize target, `CreatePopover` and `PlannerTaskPanel` as bottom sheets, always-visible deletes on coarse pointers, a readable unscheduled banner, and an hours-scroll height that is correct under **both** chromes (desktop 70px TopBar vs. mobile 56px top bar + 56px fixed tab bar).

**Architecture:** Two orthogonal switches, both introduced here.

- **Width** — `useCompactWidth()` = `matchMedia('(max-width: 767.98px)')`, i.e. exactly "below Tailwind `md`". It is a **viewport** query, deliberately *not* derived from `useElementWidth`: the planner's grid pane is already ~640px on a 1280px desktop (sidebar 280 + panel 330), so a container-width test would flip a real desktop onto the mobile geometry. `useElementWidth` + `daysThatFit` stay the container-query sizing brain; `compact` only selects *which constants* `daysThatFit` uses.
- **Input** — `usePointerCoarse()` = `matchMedia('(pointer: coarse)')` drives affordances (long-press arming, `touch-action`, enlarged resize target, always-visible deletes). A desktop-width touch device therefore gets the desktop layout with touch affordances.

Both are thin wrappers over one `useMediaQuery(query)` primitive. In jsdom `window.matchMedia` is **undefined**, so both hooks return `false` and every existing test keeps the desktop/fine-pointer path — which is why the whole existing suite stays green unmodified. Tests that need the mobile path install a fake `matchMedia` explicitly.

Every gesture *decision* lives in a pure, fully-tested module (`weekModel.ts`, `longPress.ts`, `edgeScroll.ts`); the components only wire refs, timers and rAF. jsdom cannot produce a real touch gesture, so the pure modules carry the tests and the component tests assert the wiring.

**Tech Stack:** React 18 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite 5, Tailwind **v3.4.19** (arbitrary values like `max-h-[calc(100dvh_-_260px_-_env(safe-area-inset-bottom))]` work on the v3 JIT; `_` becomes a space; `touch-pan-y` / `touch-none` / `h-dvh` all exist), TanStack Query v5, react-router-dom v6, vitest 1.6 + jsdom 24 + @testing-library/react **v16** (`renderHook` and `act` are available and already used in `src/api/categories.test.tsx`). Icons are hand-rolled inline SVGs in `src/app/shell/icons.tsx` — **no icon library is installed; do not add one.**

**Spec:** docs/superpowers/specs/2026-08-25-mobile-adaptation-design.md (section 2 "Planner on a phone", plus the section-1 `usePointerCoarse()` switch and the Phase-2 line of the phase list).

## Global Constraints

- Web suite **baseline: 511 tests / 62 files green** (`npm test -w @notreclaim/web`, verified 2026-08-26 on `main`). It must be green after **every** task; the expected count is stated per task. Final expected: **578 tests / 66 files**.
- Tests run under `TZ=UTC` via the package `test` script — never bypass it.
- Tailwind v3 **literal utility class strings only** — never compute a class name. Every conditional below picks between two whole literal strings.
- `packages/web` imports are **extensionless** and never `import React` (automatic JSX runtime; named hook imports are fine).
- **Desktop at `md+` on a fine pointer must stay behavior-identical.** Every new prop defaults to the current behaviour (`compact = false`, `coarse = false`, `getScrollContainer` omitted → scroll delta 0). jsdom has no `matchMedia` and `useElementWidth` returns the `-1` sentinel, so every pre-existing test keeps the desktop path.
- **Exactly one pre-existing test file needs an expected edit** and it is called out inline where it happens (Task 3, the `WeekGrid` legend query — see the step; no assertion in `weekModel.test.ts`, `InteractiveBlock.test.tsx`, `CreatePopover.test.tsx`, `PlannerTaskPanel.test.tsx` or `Planner.test.tsx` changes). `CreatePopover.test.tsx`'s `toContain('w-[340px]')` / `toContain('left-1')` assertions keep passing because the desktop branch keeps those exact literals.
- jsdom does **not** evaluate Tailwind CSS or media queries: `md:hidden` / `hidden` have no effect on visibility in tests. Assert **class presence/absence** or scope with `within(...)`; never assert "not visible".
- All times render in `settings.timezone` (luxon/Intl); pure modules take `now`/`zone` as parameters — no `Date.now()` inside them.
- `settings.dayStartMinute` must keep working in the 1-day view: the day-column anchors arrive from `dayColumns(viewStartMs, dayCount, zone, dayStartMinute)` and paging uses `shiftDays(ms, ±dayCount, zone)`. Nothing in this phase touches that path — the only change is that `dayCount` can now be 1.
- TypeScript is strict with `noUncheckedIndexedAccess`: index accesses in test code need `!`. Test files are type-checked by `npm run build -w @notreclaim/web`.
- Never run branch-switching or history-rewriting git commands (`checkout`/`switch`/`restore`/`reset`/`stash`). `git add <explicit paths>` only — the working tree contains untracked local-only files (`seed-dev.mjs`, `review/`, `*.tsbuildinfo`) that must never be committed.
- Every commit message ends with the trailer line `Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828`.
- **Out of scope for this phase (do not touch):** `TaskDrawer`, `EventDrawer`, `HabitDrawer`, `NewTaskModal` (Phase 4 full-screen sheets); the four HTML5-DnD surfaces (Phase 3 dnd-kit); `useClickOutside` / `mousedown` → `pointerdown` (Phase 4); the `coarse:` Tailwind variant plugin and global tap-target bumps (Phase 4); `overscroll-behavior` base CSS (Phase 4).

---

## Task 1 — `useMediaQuery` / `usePointerCoarse` / `useCompactWidth` + a `matchMedia` test util

**Files:**
- Create: `packages/web/src/test/matchMedia.ts`
- Create: `packages/web/src/app/lib/useMediaQuery.ts`
- Create (test): `packages/web/src/app/lib/useMediaQuery.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/lib/useMediaQuery.ts`:
  - `export const COARSE_POINTER_QUERY = '(pointer: coarse)'`
  - `export const COMPACT_WIDTH_QUERY = '(max-width: 767.98px)'`
  - `export function useMediaQuery(query: string): boolean`
  - `export function usePointerCoarse(): boolean`
  - `export function useCompactWidth(): boolean`
- Produces `packages/web/src/test/matchMedia.ts`:
  - `export interface FakeMatchMedia { set(query: string, matches: boolean): void; queries(): string[]; restore(): void }`
  - `export function installMatchMedia(initial?: Record<string, boolean>): FakeMatchMedia`
- Consumes: nothing (React only).

**Steps:**

- [ ] Create the test util `packages/web/src/test/matchMedia.ts` with exactly:

```ts
type Listener = (e: MediaQueryListEvent) => void;

export interface FakeMatchMedia {
  /** Flip a query's result and notify every listener registered for it. */
  set(query: string, matches: boolean): void;
  /** Every query the code under test has asked about, in first-ask order. */
  queries(): string[];
  /** Put `window.matchMedia` back the way jsdom had it (undefined). */
  restore(): void;
}

/**
 * jsdom implements no `matchMedia` at all, which is exactly why the production hook treats a
 * missing `matchMedia` as "no match" and every existing test keeps the desktop / fine-pointer
 * path. Tests that need the mobile path install this fake and MUST call `restore()` afterwards.
 */
export function installMatchMedia(initial: Record<string, boolean> = {}): FakeMatchMedia {
  const state = new Map<string, boolean>(Object.entries(initial));
  const listeners = new Map<string, Set<Listener>>();
  const asked: string[] = [];
  const had = Object.prototype.hasOwnProperty.call(window, 'matchMedia');
  const previous = (window as { matchMedia?: unknown }).matchMedia;

  const impl = (query: string): MediaQueryList => {
    if (!asked.includes(query)) asked.push(query);
    const set = listeners.get(query) ?? new Set<Listener>();
    listeners.set(query, set);
    return {
      media: query,
      get matches() { return state.get(query) ?? false; },
      onchange: null,
      addEventListener: (_type: string, fn: Listener) => { set.add(fn); },
      removeEventListener: (_type: string, fn: Listener) => { set.delete(fn); },
      addListener: (fn: Listener) => { set.add(fn); },
      removeListener: (fn: Listener) => { set.delete(fn); },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };

  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: impl });

  return {
    set(query, matches) {
      state.set(query, matches);
      for (const fn of listeners.get(query) ?? []) fn({ matches, media: query } as MediaQueryListEvent);
    },
    queries: () => [...asked],
    restore() {
      if (had) Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: previous });
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
```

- [ ] Write the failing test `packages/web/src/app/lib/useMediaQuery.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import {
  useMediaQuery, usePointerCoarse, useCompactWidth,
  COARSE_POINTER_QUERY, COMPACT_WIDTH_QUERY,
} from './useMediaQuery';

let mm: FakeMatchMedia | null = null;
afterEach(() => { mm?.restore(); mm = null; });

describe('useMediaQuery', () => {
  it('returns false when the environment has no matchMedia (jsdom default)', () => {
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);
  });

  it('reads the initial match', () => {
    mm = installMatchMedia({ '(min-width: 900px)': true });
    const { result } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    expect(result.current).toBe(true);
  });

  it('reacts when the query flips', () => {
    mm = installMatchMedia({ '(min-width: 900px)': false });
    const { result } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    expect(result.current).toBe(false);
    act(() => { mm!.set('(min-width: 900px)', true); });
    expect(result.current).toBe(true);
  });

  it('stops listening after unmount', () => {
    mm = installMatchMedia({ '(min-width: 900px)': false });
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    unmount();
    act(() => { mm!.set('(min-width: 900px)', true); });
    expect(result.current).toBe(false); // no post-unmount state update
  });

  it('usePointerCoarse asks the coarse-pointer query', () => {
    mm = installMatchMedia({ [COARSE_POINTER_QUERY]: true });
    const { result } = renderHook(() => usePointerCoarse());
    expect(result.current).toBe(true);
    expect(mm.queries()).toContain('(pointer: coarse)');
  });

  it('useCompactWidth asks the below-md width query', () => {
    mm = installMatchMedia({ [COMPACT_WIDTH_QUERY]: true });
    const { result } = renderHook(() => useCompactWidth());
    expect(result.current).toBe(true);
    expect(mm.queries()).toContain('(max-width: 767.98px)');
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/lib/useMediaQuery.test.tsx`. Expected failure: `Failed to resolve import "./useMediaQuery"`.

- [ ] Create `packages/web/src/app/lib/useMediaQuery.ts` with exactly:

```ts
import { useEffect, useState } from 'react';

/** Touch/pen input. Drives affordances (long-press arming, tap targets), never layout. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** "Below Tailwind `md`" — 767.98px so it can never overlap `md` (768px) on fractional zoom. */
export const COMPACT_WIDTH_QUERY = '(max-width: 767.98px)';

function currentMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * Reactive media query. jsdom implements no `matchMedia`, so under test this is always `false`
 * and every component keeps its desktop / fine-pointer branch unless a test installs a fake.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => currentMatch(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches); // the query may have flipped between render and effect
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 / older jsdom shims only have the deprecated pair.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
}

/** True on touch/pen devices, regardless of viewport width (a landscape tablet is both). */
export function usePointerCoarse(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

/** True below Tailwind's `md` breakpoint — the mobile chrome / mobile planner geometry. */
export function useCompactWidth(): boolean {
  return useMediaQuery(COMPACT_WIDTH_QUERY);
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/lib/useMediaQuery.test.tsx`. Expected: 6 tests pass.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **517 passed (517), 63 files** — nothing consumes the hooks yet.

- [ ] Commit:

```sh
git add packages/web/src/app/lib/useMediaQuery.ts packages/web/src/app/lib/useMediaQuery.test.tsx packages/web/src/test/matchMedia.ts
git commit -m "$(cat <<'EOF'
feat(web): useMediaQuery + usePointerCoarse/useCompactWidth

The two orthogonal mobile switches from the adaptation spec: input (pointer:
coarse) and width (below md). Both fall back to false where matchMedia is
absent, so jsdom keeps the desktop path. Adds an installMatchMedia test util.
No consumers yet.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 2 — `weekModel` mobile geometry (pure)

Mobile constants, a `compact`-parameterised `daysThatFit`, a dayCount-aware popover side rule, and a range label that reads as a single date in the 1-day view.

**Chosen constants and why.** `MOBILE_TIME_GUTTER_PX = 44`, `MOBILE_MIN_DAY_COL_PX = 175`. The measured grid width is the viewport minus the planner's mobile padding (`p-2` → 16px total, Task 4). The window `(173, 177]` for the minimum column is what makes a 390px phone show **1** day even at full bleed while a 430px phone shows **2**; 175 sits in the middle of it:

| measured width | `daysThatFit(w, true)` | arithmetic |
| --- | --- | --- |
| 358 (390 − `p-4`) | 1 | ⌊(358−44)/175⌋ = ⌊1.79⌋ |
| 374 (390 − `p-2`) | 1 | ⌊(374−44)/175⌋ = ⌊1.88⌋ |
| 390 (full bleed)  | 1 | ⌊(390−44)/175⌋ = ⌊1.97⌋ |
| 398 (430 − `p-4`) | 2 | ⌊(398−44)/175⌋ = ⌊2.02⌋ |
| 414 (430 − `p-2`) | 2 | ⌊(414−44)/175⌋ = ⌊2.11⌋ |
| 430 (full bleed)  | 2 | ⌊(430−44)/175⌋ = ⌊2.20⌋ |
| 767 (widest compact) | 4 | ⌊(767−44)/175⌋ = ⌊4.13⌋ |

Desktop (`compact = false`) keeps `TIME_GUTTER_PX = 64` / `MIN_DAY_COL_PX = 120` untouched: 768 → ⌊(768−64)/120⌋ = 5, 1280 → ⌊(1280−64)/120⌋ = 10 → capped at 7. Because `compact` defaults to `false`, **every existing `daysThatFit` assertion passes unmodified** (including `daysThatFit(64 + 120 * 3 + 10) === 3`, which would have broken had compactness been inferred from the width itself).

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts` (lines 115–126 — the geometry constants and `daysThatFit`; new exports appended after `clampToWindow` at line 202)
- Modify (test): `packages/web/src/app/planner/weekModel.test.ts` (import list lines 3–9; new `describe` blocks appended)

**Interfaces:**
- Produces (all in `weekModel.ts`):
  - `export const MOBILE_TIME_GUTTER_PX = 44`
  - `export const MOBILE_MIN_DAY_COL_PX = 175`
  - `export function timeGutterPx(compact?: boolean): number`
  - `export function daysThatFit(widthPx: number, compact?: boolean): number` — **signature widened**, second parameter defaults to `false`
  - `export function popoverAlign(dayIndex: number, dayCount: number): 'left' | 'right'`
  - `export function rangeLabel(days: number[], zone?: string): string`
- Consumes: nothing new.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/planner/weekModel.test.ts` (at the very end of the file, after the closing `});` of the `dayStartMinute` describe on line 335):

```ts
describe('mobile geometry (Phase 2)', () => {
  it('exports the mobile gutter and column-minimum constants', () => {
    expect(MOBILE_TIME_GUTTER_PX).toBe(44);
    expect(MOBILE_MIN_DAY_COL_PX).toBe(175);
  });

  it('timeGutterPx narrows the gutter only in the compact layout', () => {
    expect(timeGutterPx()).toBe(64);
    expect(timeGutterPx(false)).toBe(64);
    expect(timeGutterPx(true)).toBe(44);
  });

  it('compact widths: a 390px phone shows one day, a 430px phone shows two', () => {
    expect(daysThatFit(358, true)).toBe(1);  // 390 - p-4
    expect(daysThatFit(374, true)).toBe(1);  // 390 - p-2
    expect(daysThatFit(390, true)).toBe(1);  // full bleed
    expect(daysThatFit(398, true)).toBe(2);  // 430 - p-4
    expect(daysThatFit(414, true)).toBe(2);  // 430 - p-2
    expect(daysThatFit(430, true)).toBe(2);  // full bleed
    expect(daysThatFit(767, true)).toBe(4);  // widest compact viewport
  });

  it('compact keeps the unmeasured sentinel and the 1-day floor', () => {
    expect(daysThatFit(-1, true)).toBe(7);
    expect(daysThatFit(0, true)).toBe(1);
    expect(daysThatFit(50, true)).toBe(1);
  });

  it('desktop widths are untouched by the new parameter', () => {
    expect(daysThatFit(768)).toBe(5);
    expect(daysThatFit(768, false)).toBe(5);
    expect(daysThatFit(1280)).toBe(7);
    expect(daysThatFit(640)).toBe(4);   // the real grid pane at 1280 with both side panels
    expect(daysThatFit(640, false)).toBe(4);
  });
});

describe('popoverAlign', () => {
  it('reproduces the old hardcoded 7-day rule (i <= 3 opens left)', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => popoverAlign(i, 7)))
      .toEqual(['left', 'left', 'left', 'left', 'right', 'right', 'right']);
  });

  it('follows the rendered day count in the narrow windows', () => {
    expect(popoverAlign(0, 1)).toBe('left');
    expect([0, 1].map((i) => popoverAlign(i, 2))).toEqual(['left', 'right']);
    expect([0, 1, 2].map((i) => popoverAlign(i, 3))).toEqual(['left', 'left', 'right']);
    expect([0, 1, 2, 3].map((i) => popoverAlign(i, 4))).toEqual(['left', 'left', 'right', 'right']);
  });
});

describe('rangeLabel', () => {
  it('renders a single date for a one-day window', () => {
    expect(rangeLabel([MON])).toBe('Jan 5');
  });

  it('renders first – last for a multi-day window', () => {
    expect(rangeLabel(dayColumns(MON))).toBe('Jan 5 – Jan 11');
    expect(rangeLabel(dayColumns(MON, 2))).toBe('Jan 5 – Jan 6');
  });
});
```

- [ ] Extend the import list at the top of `packages/web/src/app/planner/weekModel.test.ts`. Replace line 8:

  old: `  daysThatFit, formatHm, weekdayLabel, dayOfMonth, dayAnchor, hourRowLabel,`
  new: `  daysThatFit, formatHm, weekdayLabel, dayOfMonth, dayAnchor, hourRowLabel,`
  `  MOBILE_TIME_GUTTER_PX, MOBILE_MIN_DAY_COL_PX, timeGutterPx, popoverAlign, rangeLabel,`

  (i.e. append the second line immediately after the existing line 8, still inside the `{ … }`).

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`. Expected failure: TypeScript/vitest reports the new names are not exported (`SyntaxError: The requested module './weekModel' does not provide an export named 'timeGutterPx'`).

- [ ] Edit `packages/web/src/app/planner/weekModel.ts`. Replace lines 115–126:

  old:
```ts
/** Time-gutter width (px) — must match WeekGrid's first column. */
export const TIME_GUTTER_PX = 64;
/** Minimum readable width (px) for one day column. */
export const MIN_DAY_COL_PX = 120;

/** How many day columns fit in `widthPx` (1..7). A negative width is the "not measured yet"
 *  sentinel (SSR/jsdom/before first paint) → show the full week. A measured width of 0 (e.g. the
 *  grid squeezed out by the side panels at a tiny viewport) is real → floor to a single day. */
export function daysThatFit(widthPx: number): number {
  if (widthPx < 0) return 7;
  return Math.max(1, Math.min(7, Math.floor((widthPx - TIME_GUTTER_PX) / MIN_DAY_COL_PX)));
}
```

  new:
```ts
/** Time-gutter width (px) — must match WeekGrid's first column. */
export const TIME_GUTTER_PX = 64;
/** Minimum readable width (px) for one day column. */
export const MIN_DAY_COL_PX = 120;

/** Time-gutter width on the compact (below-md) layout: smaller hour labels, less stolen width. */
export const MOBILE_TIME_GUTTER_PX = 44;
/**
 * Minimum day-column width on the compact layout. Chosen so a 390px phone lands on ONE day even
 * at full bleed (⌊(390−44)/175⌋ = 1) while a 430px phone gets two (⌊(430−44)/175⌋ = 2). The whole
 * usable window is (173, 177]; 175 sits in the middle of it.
 */
export const MOBILE_MIN_DAY_COL_PX = 175;

/** Gutter width for the layout in play. `compact` is the viewport switch, not the pane width. */
export function timeGutterPx(compact = false): number {
  return compact ? MOBILE_TIME_GUTTER_PX : TIME_GUTTER_PX;
}

/**
 * How many day columns fit in `widthPx` (1..7). A negative width is the "not measured yet"
 * sentinel (SSR/jsdom/before first paint) → show the full week. A measured width of 0 (e.g. the
 * grid squeezed out by the side panels at a tiny viewport) is real → floor to a single day.
 *
 * `compact` selects the mobile constants. It is deliberately a parameter rather than something
 * inferred from `widthPx`: the grid pane is only ~640px wide on a 1280px desktop (sidebar 280 +
 * task panel 330), so a width-inferred switch would put a real desktop on the phone geometry.
 */
export function daysThatFit(widthPx: number, compact = false): number {
  if (widthPx < 0) return 7;
  const gutter = timeGutterPx(compact);
  const minCol = compact ? MOBILE_MIN_DAY_COL_PX : MIN_DAY_COL_PX;
  return Math.max(1, Math.min(7, Math.floor((widthPx - gutter) / minCol)));
}
```

- [ ] Append to the end of `packages/web/src/app/planner/weekModel.ts` (after `clampToWindow`, line 202):

```ts
/**
 * Which side of its day column the create-popover opens on. Columns in the first half open to
 * the left so the popover grows into the grid rather than off-screen. Replaces WeekGrid's
 * hardcoded `i <= 3`, which silently assumed a 7-day week.
 */
export function popoverAlign(dayIndex: number, dayCount: number): 'left' | 'right' {
  return dayIndex <= Math.floor((dayCount - 1) / 2) ? 'left' : 'right';
}

/** Toolbar label for the rendered window: one date in the 1-day view, `first – last` otherwise. */
export function rangeLabel(days: number[], zone = 'UTC'): string {
  if (days.length === 0) return '';
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone });
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`. Expected: the file's tests pass, including the 9 new ones; no pre-existing assertion changed.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **526 passed (526), 63 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "$(cat <<'EOF'
feat(web): mobile planner geometry in weekModel

44px gutter + 175px column minimum behind a `compact` parameter, so a 390px
phone renders one day and a 430px phone two, while every desktop width keeps
the 64/120 constants. Adds a dayCount-aware popoverAlign (replacing the
hardcoded 7-day `i <= 3` rule) and rangeLabel for the 1-day toolbar label.
Pure module only — no component consumes these yet.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 3 — `WeekGrid` compact chrome: gutter, toolbar, hours-scroll height, popover side

This is the ledger item: `WeekGrid.tsx:172`'s inline `maxHeight: 'calc(100dvh - 230px)'` encodes the 70px desktop TopBar and knows nothing about the mobile chrome. It becomes a breakpoint-differentiated Tailwind arbitrary value.

**Height arithmetic.** Desktop keeps `100dvh − 230px` byte-for-byte (TopBar 70 + planner `p-4` 16 + toolbar 54 + day header ~66 + borders/slack ~24). Compact: mobile top bar 56 + fixed tab bar 56 (the shell reserves it with `pb-[calc(56px_+_env(safe-area-inset-bottom))]`, which sits *below* this box) + planner `p-2` 16 + toolbar 54 + day header ~66 + slack ~12 = **260**, plus `env(safe-area-inset-bottom)` for the home indicator. Written as `max-h-[calc(100dvh_-_260px_-_env(safe-area-inset-bottom))] md:max-h-[calc(100dvh_-_230px)]` — Tailwind turns each `_` into a space, so the emitted CSS is valid `calc()`.

**Files:**
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (import line 5; props interface lines 19–45; destructure line 77; `gridCols` line 78; toolbar lines 110–143; header grid line 148; day-header cell lines 153–167; hours-scroll line 172; gutter label line 177; popover align line 293)
- Modify (test): `packages/web/src/app/planner/WeekGrid.test.tsx` (append a `describe`; **one expected edit** to the legend-free existing suite is called out below)

**Interfaces:**
- Produces: `WeekGridProps` gains `compact?: boolean` (default `false`). New test ids: `day-header-row` on the header grid, `panel-sheet-toggle` on the compact tasks button. Desktop test ids `panel-hide` / `panel-show` are unchanged and still rendered whenever `compact` is false.
- Consumes: `timeGutterPx`, `popoverAlign` from `./weekModel`.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/planner/WeekGrid.test.tsx` (at the end of the file, after the `WeekGrid blocked time` describe closes on line 336):

```tsx
describe('WeekGrid compact (below md)', () => {
  it('uses the 44px gutter when compact and the 64px gutter otherwise', () => {
    const { unmount } = renderGrid({ days: [days[0]!], compact: true });
    expect(screen.getByTestId('day-header-row').style.gridTemplateColumns).toMatch(/^44px /);
    unmount();
    renderGrid({ days: [days[0]!] });
    expect(screen.getByTestId('day-header-row').style.gridTemplateColumns).toMatch(/^64px /);
  });

  it('sizes the hours-scroll for both chromes', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    // mobile: 56px top bar + 56px tab bar + page padding + toolbar + day header, plus the inset
    expect(scroller.className).toContain('max-h-[calc(100dvh_-_260px_-_env(safe-area-inset-bottom))]');
    // desktop: byte-identical to the value the inline style used to carry
    expect(scroller.className).toContain('md:max-h-[calc(100dvh_-_230px)]');
    expect(scroller.getAttribute('style')).toBeNull();
  });

  it('hides the legend below md', () => {
    renderGrid();
    const legend = screen.getByTestId('grid-legend');
    expect(legend.className).toContain('hidden');
    expect(legend.className).toContain('md:flex');
  });

  it('compact swaps the panel toggle for a Tasks sheet button', () => {
    const onTogglePanel = vi.fn();
    renderGrid({ compact: true, onTogglePanel, panelHidden: false });
    expect(screen.queryByTestId('panel-hide')).toBeNull();
    const toggle = screen.getByTestId('panel-sheet-toggle');
    fireEvent.click(toggle);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it('desktop keeps the panel hide/show toggle', () => {
    renderGrid({ onTogglePanel: vi.fn(), panelHidden: false });
    expect(screen.getByTestId('panel-hide')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-sheet-toggle')).toBeNull();
  });

  it('opens the create popover on the left of a one-day window', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    expect(screen.getByTestId('create-popover').className).toContain('left-1');
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`. Expected failure: 6 failures — `Unable to find an element by: [data-testid="day-header-row"]`, `[data-testid="grid-legend"]`, `[data-testid="panel-sheet-toggle"]`, plus the `max-h-…` class assertions (the scroller still carries the inline style).

- [ ] Edit `packages/web/src/app/planner/WeekGrid.tsx` — imports. Replace line 5:

  old: `import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, TIME_GUTTER_PX, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel } from './weekModel';`
  new: `import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign } from './weekModel';`

- [ ] Add the prop. Replace lines 43–44:

  old:
```tsx
  panelHidden?: boolean;
  onTogglePanel?: () => void;
```
  new:
```tsx
  panelHidden?: boolean;
  onTogglePanel?: () => void;
  /** Below-md layout: narrow gutter, wrapped toolbar, Tasks sheet button, no legend. */
  compact?: boolean;
```

- [ ] Replace lines 77–78:

  old:
```tsx
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, onScheduleTaskAt, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel } = props;
  const gridCols = `${TIME_GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;
```
  new:
```tsx
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan, onCommit, onCommitEvent, onEditEvent, onDeleteBlock, onDeleteEvent, onScheduleTaskAt, accents = {}, zone = 'UTC', dayStartMinute = 0, panelHidden, onTogglePanel, compact = false } = props;
  const gridCols = `${timeGutterPx(compact)}px repeat(${days.length}, minmax(0, 1fr))`;
```

- [ ] Replace the whole toolbar, lines 110–143:

  old:
```tsx
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">‹</button>
          <button onClick={onNext} aria-label="Next" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">›</button>
        </div>
        <span className="text-[18px] font-bold text-ink">{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        <div className="ml-2 flex items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[14px] font-semibold text-inkSoft">
              <span className={`h-[11px] w-[11px] rounded-[3px] ${l.swatch}`} /> {l.label}
            </span>
          ))}
        </div>
        {onTogglePanel && (
          <button
            type="button"
            data-testid={panelHidden ? 'panel-show' : 'panel-hide'}
            aria-label={panelHidden ? 'Show tasks panel' : 'Hide tasks panel'}
            onClick={onTogglePanel}
            className="ml-1 shrink-0 rounded-[9px] p-2 text-inkSoft hover:bg-line hover:text-ink"
          >
            <Icons.panelRight size={20} />
          </button>
        )}
      </div>
```
  new:
```tsx
      <div className="mb-3 flex flex-wrap items-center gap-2 md:mb-4 md:gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>‹</button>
          <button onClick={onNext} aria-label="Next" className={`flex items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft ${compact ? 'h-11 w-11' : 'h-[38px] w-[38px]'}`}>›</button>
        </div>
        <span className={`min-w-0 truncate font-bold text-ink ${compact ? 'text-[15px]' : 'text-[18px]'}`}>{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        {/* The legend needs ~700px of toolbar; below md it is dropped entirely (spec §4). */}
        <div data-testid="grid-legend" className="ml-2 hidden items-center gap-3 md:flex">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[14px] font-semibold text-inkSoft">
              <span className={`h-[11px] w-[11px] rounded-[3px] ${l.swatch}`} /> {l.label}
            </span>
          ))}
        </div>
        {onTogglePanel && (compact ? (
          <button
            type="button"
            data-testid="panel-sheet-toggle"
            onClick={onTogglePanel}
            className="shrink-0 rounded-[9px] border border-line bg-card px-3 py-2 text-[14px] font-bold text-ink"
          >
            Tasks
          </button>
        ) : (
          <button
            type="button"
            data-testid={panelHidden ? 'panel-show' : 'panel-hide'}
            aria-label={panelHidden ? 'Show tasks panel' : 'Hide tasks panel'}
            onClick={onTogglePanel}
            className="ml-1 shrink-0 rounded-[9px] p-2 text-inkSoft hover:bg-line hover:text-ink"
          >
            <Icons.panelRight size={20} />
          </button>
        ))}
      </div>
```

  **Note on the desktop diff:** the toolbar row's own classes change from `mb-4 flex items-center gap-3` to `mb-3 flex flex-wrap items-center gap-2 md:mb-4 md:gap-3`, which resolves to the same margin and gap at `md+`; `flex-wrap` only engages when the row cannot fit, which at `md+` it already could. No test asserts these classes.

- [ ] Add the header-row test id. Replace line 148:

  old: `          <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>`
  new: `          <div data-testid="day-header-row" className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>`

- [ ] Shrink the day-header cell on compact. Replace lines 158–164:

  old:
```tsx
                  className="border-l border-line py-3 text-center"
                >
                  <div className="text-[13px] font-bold uppercase tracking-wide text-inkSoft">{weekdayLabel(d, zone)}</div>
                  <div className="mt-0.5 text-[21px] font-extrabold">
                    {today
                      ? <span className="rounded-[9px] bg-indigo px-[9px] py-[1px] text-white">{date}</span>
                      : <span className="text-ink">{date}</span>}
```
  new:
```tsx
                  className={`border-l border-line text-center ${compact ? 'py-2' : 'py-3'}`}
                >
                  <div className={`font-bold uppercase tracking-wide text-inkSoft ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{weekdayLabel(d, zone)}</div>
                  <div className={`mt-0.5 font-extrabold ${compact ? 'text-[18px]' : 'text-[21px]'}`}>
                    {today
                      ? <span className="rounded-[9px] bg-indigo px-[9px] py-[1px] text-white">{date}</span>
                      : <span className="text-ink">{date}</span>}
```

- [ ] Replace the hours-scroll container, line 172:

  old: `          <div ref={scrollRef} data-testid="hours-scroll" className="overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 230px)' }}>`
  new:
```tsx
          {/* Height must be right under BOTH chromes. Desktop: 70px TopBar + p-4 + toolbar +
              day header ≈ 230px (byte-identical to the value this used to carry inline).
              Compact: 56px mobile top bar + 56px fixed tab bar + p-2 + toolbar + day header
              ≈ 260px, plus the home-indicator inset. Tailwind turns `_` into a space. */}
          <div ref={scrollRef} data-testid="hours-scroll" className="max-h-[calc(100dvh_-_260px_-_env(safe-area-inset-bottom))] overflow-y-auto md:max-h-[calc(100dvh_-_230px)]">
```

- [ ] Shrink the gutter labels on compact. Replace line 177:

  old: `                  <span className="absolute right-[10px] -top-[8px] text-[12px] font-semibold text-[#a6aab8]">{hourRowLabel(h, dayStartMinute)}</span>`
  new: `                  <span className={`absolute -top-[8px] font-semibold text-[#a6aab8] ${compact ? 'right-[6px] text-[10px]' : 'right-[10px] text-[12px]'}`}>{hourRowLabel(h, dayStartMinute)}</span>`

- [ ] Make the popover side dayCount-aware. Replace line 293:

  old: `                      align={i <= 3 ? 'left' : 'right'}`
  new: `                      align={popoverAlign(i, days.length)}`

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`. Expected: all pass, including the 6 new ones. **If the pre-existing `renders one column per day for a 3-day window…` test now fails on the popover side, stop** — it must not: it asserts only column presence and the `Wed` label.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **532 passed (532), 63 files**.

  *(Expected-edit ledger for this task: none. The one pre-existing file touched is `WeekGrid.test.tsx`, and only by appending a new describe block.)*

- [ ] Commit:

```sh
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): compact WeekGrid chrome for phones

44px gutter + smaller hour/day labels, a wrapping toolbar with 44px prev/next
targets and a Tasks button in place of the panel toggle, and the legend hidden
below md. Replaces the hardcoded `i <= 3` popover side with popoverAlign.

Fixes the hours-scroll height ledger item: the inline calc(100dvh - 230px)
encoded the 70px desktop TopBar and ignored the mobile 56px top bar + 56px
fixed tab bar, so the grid scrolled under the tab bar. Now a
breakpoint-differentiated max-h, desktop value unchanged.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 4 — Planner compact layout: `Sheet`, the task panel as a bottom sheet, full-width grid

The interim "hide `PlannerTaskPanel` below md" idea is subsumed here: below `md` the panel is **not rendered inline at all** — the toolbar's `Tasks` button opens it as a bottom sheet.

**Files:**
- Create: `packages/web/src/app/components/Sheet.tsx`
- Create (test): `packages/web/src/app/components/Sheet.test.tsx`
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx` (props interface lines 8–15; signature line 82; `<aside>` line 127)
- Modify (test): `packages/web/src/app/planner/PlannerTaskPanel.test.tsx` (append one test)
- Modify: `packages/web/src/app/planner/UnscheduledWarning.tsx` (line 18)
- Modify: `packages/web/src/app/pages/Planner.tsx` (imports lines 5–9; `weekLabel` helper lines 15–18; `dayCount` line 28; panel state lines 43–48; render lines 132–171)
- Modify (test): `packages/web/src/app/pages/Planner.test.tsx` (append a describe)

**Interfaces:**
- Produces `packages/web/src/app/components/Sheet.tsx`:
  - `export interface SheetProps { label: string; onClose: () => void; children: ReactNode; heightClass?: string }`
  - `export function Sheet({ label, onClose, children, heightClass }: SheetProps): ReactElement` — root `data-testid="sheet-backdrop"`, panel `data-testid="sheet"` with `role="dialog"` + `aria-label={label}`, close button `data-testid="sheet-close"`. `heightClass` defaults to the literal `'h-[70dvh]'`.
- Produces: `PlannerTaskPanelProps` gains `compact?: boolean` (default `false`).
- Consumes: `useCompactWidth` from `../lib/useMediaQuery`; `rangeLabel` from `../planner/weekModel`; `Sheet` from `../components/Sheet`.

**Steps:**

- [ ] Write the failing test `packages/web/src/app/components/Sheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('renders a labelled dialog anchored to the bottom edge', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const sheet = screen.getByRole('dialog', { name: 'Tasks' });
    expect(sheet.className).toContain('bottom-0');
    expect(sheet.className).toContain('h-[70dvh]');
    expect(sheet.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('dismisses on a backdrop tap', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on a tap inside the sheet', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses from the close button', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx`. Expected failure: `Failed to resolve import "./Sheet"`.

- [ ] Create `packages/web/src/app/components/Sheet.tsx` with exactly:

```tsx
import type { ReactElement, ReactNode } from 'react';

export interface SheetProps {
  /** Accessible name; also used for the close button's label. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Literal Tailwind height class for the sheet body (JIT-visible at every call site). */
  heightClass?: string;
}

/**
 * Bottom sheet for phones: full-width, anchored to the bottom edge, drag-handle header, backdrop
 * tap dismisses. Only rendered on the compact layout — desktop surfaces keep their inline panels.
 * Drawers (Task/Event/Habit) are NOT sheets yet; that is Phase 4.
 */
export function Sheet({ label, onClose, children, heightClass = 'h-[70dvh]' }: SheetProps): ReactElement {
  return (
    <div data-testid="sheet-backdrop" onClick={onClose} className="fixed inset-0 z-40 bg-black/30">
      <div
        data-testid="sheet"
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 flex ${heightClass} flex-col rounded-t-[18px] border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-pop`}
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

- [ ] Run `npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx`. Expected: 4 tests pass.

- [ ] Append the failing panel test to `packages/web/src/app/planner/PlannerTaskPanel.test.tsx` (inside the existing `describe('PlannerTaskPanel', …)`, before its closing `});` on line 107):

```tsx
  it('fills its container in the compact (bottom-sheet) layout', () => {
    const { unmount } = render(
      <PlannerTaskPanel tasks={[task()]} preview={undefined} nowMs={NOW} compact
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const aside = screen.getByTestId('planner-task-panel');
    expect(aside.className).toContain('w-full');
    expect(aside.className).not.toContain('w-[330px]');
    unmount();
    renderPanel([task()]);
    expect(screen.getByTestId('planner-task-panel').className).toContain('w-[330px]');
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/PlannerTaskPanel.test.tsx`. Expected failure: TypeScript rejects the `compact` prop / the assertion `w-full` fails.

- [ ] Edit `packages/web/src/app/planner/PlannerTaskPanel.tsx`. Replace lines 8–15:

  old:
```tsx
export interface PlannerTaskPanelProps {
  tasks: Task[];
  preview: SchedulePreview | undefined;
  nowMs: number;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}
```
  new:
```tsx
export interface PlannerTaskPanelProps {
  tasks: Task[];
  preview: SchedulePreview | undefined;
  nowMs: number;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Rendered inside a bottom sheet: fill the sheet instead of holding the 330px desktop width. */
  compact?: boolean;
}
```

- [ ] Replace line 82:

  old: `export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete }: PlannerTaskPanelProps) {`
  new: `export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete, compact = false }: PlannerTaskPanelProps) {`

- [ ] Replace line 127:

  old: `    <aside data-testid="planner-task-panel" className="flex w-[330px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-bg/40">`
  new: `    <aside data-testid="planner-task-panel" className={`flex flex-col overflow-hidden rounded-[14px] border border-line bg-bg/40 ${compact ? 'min-h-0 w-full flex-1' : 'w-[330px] shrink-0'}`}>`

- [ ] Make the unscheduled banner immune to a squeezed parent. Replace `packages/web/src/app/planner/UnscheduledWarning.tsx` line 18:

  old: `      className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-800"`
  new: `      className="mb-2 flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-800"`

  (The one-word-per-line column in the phone screenshot was the banner inheriting a ~40px-wide grid pane. The real fix is the full-width grid below; `w-full min-w-0` keeps it honest if a parent ever squeezes again.)

- [ ] Append the failing Planner tests to `packages/web/src/app/pages/Planner.test.tsx` (at the end of the file, after the `describe('Planner', …)` closes on line 246):

```tsx
describe('Planner compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('does not render the task panel inline; the Tasks button opens it as a sheet', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('panel-sheet-toggle'));
    expect(screen.getByRole('dialog', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument();
  });

  it('closes the task sheet on a backdrop tap', async () => {
    const api = makeApi();
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-sheet-toggle'));
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
  });
});
```

- [ ] Extend `packages/web/src/app/pages/Planner.test.tsx`'s imports. Replace line 1:

  old: `import { describe, it, expect, vi } from 'vitest';`
  new: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`

  and add after line 5 (`import { Planner } from './Planner';`):

```ts
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx`. Expected failure: 2 failures — `Unable to find an element by: [data-testid="panel-sheet-toggle"]` (the Planner does not pass `compact` yet, and still renders the panel inline).

- [ ] Edit `packages/web/src/app/pages/Planner.tsx` — imports. Replace lines 5–9:

  old:
```tsx
import { dayColumns, daysThatFit, shiftDays, dayAnchor, clampToWindow, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { UnscheduledWarning } from '../planner/UnscheduledWarning';
```
  new:
```tsx
import { dayColumns, daysThatFit, shiftDays, dayAnchor, clampToWindow, rangeLabel, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { useCompactWidth } from '../lib/useMediaQuery';
import { Sheet } from '../components/Sheet';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { UnscheduledWarning } from '../planner/UnscheduledWarning';
```

- [ ] Delete the now-duplicated local helper, lines 15–18:

  old:
```tsx
function weekLabel(days: number[], zone = 'UTC'): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone });
  return `${fmt(days[0]!)} – ${fmt(days[days.length - 1]!)}`;
}

```
  new: *(remove these four lines and the blank line after them entirely — `rangeLabel` replaces it and additionally collapses a 1-day window to a single date)*

- [ ] Wire the width switch. Replace lines 27–28:

  old:
```tsx
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  const dayCount = daysThatFit(gridWidth);
```
  new:
```tsx
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  // Viewport switch, not pane width: the grid pane is only ~640px on a 1280px desktop, so
  // inferring "compact" from gridWidth would put a real desktop on the phone geometry.
  const compact = useCompactWidth();
  const dayCount = daysThatFit(gridWidth, compact);
```

- [ ] Add the sheet state. Replace lines 43–48:

  old:
```tsx
  const [panelHidden, setPanelHidden] = useState(() => {
    try { return localStorage.getItem('nr.plannerPanelHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nr.plannerPanelHidden', panelHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [panelHidden]);
```
  new:
```tsx
  const [panelHidden, setPanelHidden] = useState(() => {
    try { return localStorage.getItem('nr.plannerPanelHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nr.plannerPanelHidden', panelHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [panelHidden]);
  // On the compact layout the panel is a bottom sheet instead of an inline column; its
  // open/closed state is per-visit, not persisted (the desktop hide toggle stays persisted).
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
```

- [ ] Replace the render block, lines 132–171:

  old:
```tsx
  return (
    <div className="flex gap-3 p-4">
      <div ref={gridRef} className="min-w-0 flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your days…</div>}
        <UnscheduledWarning entries={unscheduledEntries} />
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days, zone)}
```
  new:
```tsx
  const panelProps = {
    tasks: tasksQ.data ?? [],
    preview: preview.data,
    nowMs,
    onComplete: onCompleteTask,
    onEdit: (t: Task) => openTaskDrawer(t.id),
    onDelete: onDeleteTask,
  };

  return (
    <div className="flex gap-3 p-2 md:p-4">
      <div ref={gridRef} className="min-w-0 flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your days…</div>}
        <UnscheduledWarning entries={unscheduledEntries} />
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={rangeLabel(days, zone)}
```

- [ ] In the same `<WeekGrid …>` element, replace lines 157–158 (the last two props):

  old:
```tsx
          panelHidden={panelHidden}
          onTogglePanel={() => setPanelHidden((h) => !h)}
```
  new:
```tsx
          compact={compact}
          panelHidden={panelHidden}
          onTogglePanel={() => (compact ? setTaskSheetOpen((o) => !o) : setPanelHidden((h) => !h))}
```

- [ ] Replace the inline panel, lines 162–171:

  old:
```tsx
      {!panelHidden && (
        <PlannerTaskPanel
          tasks={tasksQ.data ?? []}
          preview={preview.data}
          nowMs={nowMs}
          onComplete={onCompleteTask}
          onEdit={(t) => openTaskDrawer(t.id)}
          onDelete={onDeleteTask}
        />
      )}
```
  new:
```tsx
      {/* Below md the panel never renders inline — it becomes the bottom sheet below. */}
      {!compact && !panelHidden && <PlannerTaskPanel {...panelProps} />}
      {compact && taskSheetOpen && (
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)}>
          <PlannerTaskPanel {...panelProps} compact />
        </Sheet>
      )}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Planner.test.tsx src/app/planner/PlannerTaskPanel.test.tsx src/app/components/Sheet.test.tsx`. Expected: all pass (the 9 pre-existing Planner tests keep the desktop path because they do not install `matchMedia`).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **539 passed (539), 64 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/components/Sheet.tsx packages/web/src/app/components/Sheet.test.tsx packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx packages/web/src/app/planner/UnscheduledWarning.tsx packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): planner task panel becomes a bottom sheet on phones

Below md the panel is not rendered inline at all — the toolbar's Tasks button
opens it in a new shared Sheet container (70dvh, drag handle, backdrop
dismiss), so the grid finally gets the full width instead of a sliver. Adds
p-2 page padding on mobile, a single-date toolbar label in the 1-day view via
rangeLabel, and w-full/min-w-0 on the unscheduled banner so it wraps as a row
instead of a one-word column.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 5 — Long-press gesture module (pure) + `InteractiveBlock` move wiring

The pointer-event model stays exactly as it is. On coarse pointers a **body move** waits for a ~350ms long press before it arms; before arming, a finger that travels beyond the slop cancels the press and the browser keeps the scroll. The resize handle is untouched here (Task 6) — it stays drag-immediate.

**Why a non-passive `touchmove` blocker.** `touch-action` is latched by the browser when the finger lands, so flipping the class at arm time does not release an in-flight gesture. The block carries `touch-pan-y` so a pre-arm swipe scrolls the hours list; the moment the press arms we attach a `{ passive: false }` `touchmove` listener that `preventDefault()`s, which is what actually stops the scroll from starting. The finger has not moved yet at that point (movement would have disarmed the press), so there is no scroll in flight to fight. **If real-device trials show this is flaky, the documented fallback is `touch-none` on coarse blocks** — the grid then scrolls only between tiles. `LONG_PRESS_MS` and `LONG_PRESS_SLOP_PX` are exported constants precisely so they can be tuned after the device pass.

**Files:**
- Create: `packages/web/src/app/planner/longPress.ts`
- Create (test): `packages/web/src/app/planner/longPress.test.ts`
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx` (module header after line 8; props interface line 32; destructure line 39; refs after line 67; unmount effect lines 98–103; `begin` lines 129–140; `onPointerMove` lines 150–155; `onPointerUp` lines 168–201; `onPointerCancel` line 203; className line 249; transform line 250)
- Modify (test): `packages/web/src/app/planner/InteractiveBlock.test.tsx` (append a describe)
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (props interface; destructure; both `<InteractiveBlock>` usages)
- Modify: `packages/web/src/app/pages/Planner.tsx` (import; `coarse`; `<WeekGrid>` prop)

**Interfaces:**
- Produces `packages/web/src/app/planner/longPress.ts`:
  - `export const LONG_PRESS_MS = 350`
  - `export const LONG_PRESS_SLOP_PX = 8`
  - `export type PressPhase = 'idle' | 'pending' | 'armed'`
  - `export interface PressState { phase: PressPhase; originX: number; originY: number }`
  - `export const IDLE: PressState`
  - `export function beginPress(x: number, y: number, deferred: boolean): PressState`
  - `export function pressDistance(s: PressState, x: number, y: number): number`
  - `export function pressMove(s: PressState, x: number, y: number, slop?: number): PressState`
  - `export function pressArm(s: PressState): PressState`
  - `export function endPress(): PressState`
  - `export function isArmed(s: PressState): boolean`
  - `export function isTap(s: PressState): boolean`
- Produces: `InteractiveBlockProps` gains `coarse?: boolean` (default `false`); `WeekGridProps` gains `coarse?: boolean` (default `false`).
- Consumes: `usePointerCoarse` from `../lib/useMediaQuery` (in `Planner.tsx` only — one media-query subscription for the whole page rather than one per tile).

**Steps:**

- [ ] Write the failing test `packages/web/src/app/planner/longPress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  IDLE, beginPress, pressDistance, pressMove, pressArm, endPress, isArmed, isTap,
  LONG_PRESS_MS, LONG_PRESS_SLOP_PX,
} from './longPress';

describe('longPress', () => {
  it('exports tunable constants', () => {
    expect(LONG_PRESS_MS).toBe(350);
    expect(LONG_PRESS_SLOP_PX).toBe(8);
  });

  it('a non-deferred press (mouse) arms immediately', () => {
    const s = beginPress(10, 20, false);
    expect(s.phase).toBe('armed');
    expect(isArmed(s)).toBe(true);
    expect(isTap(s)).toBe(false);
  });

  it('a deferred press (touch) starts pending and remembers its origin', () => {
    const s = beginPress(10, 20, true);
    expect(s.phase).toBe('pending');
    expect(isArmed(s)).toBe(false);
    expect(s.originX).toBe(10);
    expect(s.originY).toBe(20);
  });

  it('pressDistance is the euclidean travel from the origin', () => {
    const s = beginPress(10, 20, true);
    expect(pressDistance(s, 13, 24)).toBe(5);
    expect(pressDistance(s, 10, 20)).toBe(0);
  });

  it('a pending press survives movement inside the slop', () => {
    const s = beginPress(10, 20, true);
    expect(pressMove(s, 14, 20).phase).toBe('pending'); // 4px
    expect(pressMove(s, 10, 28).phase).toBe('pending'); // 8px, exactly the slop
  });

  it('a pending press beyond the slop cancels — that gesture is a scroll', () => {
    const s = beginPress(10, 20, true);
    expect(pressMove(s, 10, 30)).toEqual(IDLE); // 10px > 8px
    expect(pressMove(s, 10, 30, 20).phase).toBe('pending'); // slop is tunable
  });

  it('movement never disturbs an armed press', () => {
    const s = beginPress(10, 20, false);
    expect(pressMove(s, 400, 900)).toBe(s);
  });

  it('pressArm promotes only a pending press; isTap marks a release before arming', () => {
    expect(pressArm(beginPress(0, 0, true)).phase).toBe('armed');
    expect(pressArm(IDLE)).toBe(IDLE);
    expect(pressArm(beginPress(0, 0, false)).phase).toBe('armed');
    expect(isTap(beginPress(0, 0, true))).toBe(true);
    expect(isTap(beginPress(0, 0, false))).toBe(false);
    expect(isTap(IDLE)).toBe(false);
    expect(endPress()).toEqual(IDLE);
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/longPress.test.ts`. Expected failure: `Failed to resolve import "./longPress"`.

- [ ] Create `packages/web/src/app/planner/longPress.ts` with exactly:

```ts
/**
 * The arming decisions behind touch drag on the planner grid, kept pure so they can be tested:
 * jsdom cannot produce a real gesture, so the component only wires timers/capture around this.
 *
 * Both constants are exported for tuning after a real-device pass (spec §5 flags long-press vs.
 * scroll as needing device iteration).
 */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP_PX = 8;

export type PressPhase =
  /** No press, or a press we abandoned because the finger started scrolling. */
  | 'idle'
  /** Coarse pointer, finger down, waiting out the long-press timer. */
  | 'pending'
  /** The drag owns the pointer: moves become block movement. */
  | 'armed';

export interface PressState {
  phase: PressPhase;
  originX: number;
  originY: number;
}

export const IDLE: PressState = { phase: 'idle', originX: 0, originY: 0 };

/**
 * A press begins. `deferred` is true only for a coarse-pointer body move: a mouse press is a
 * drag immediately (clicks are still discriminated by zero delta on release), and the resize
 * handle is an unambiguous target that drags immediately on touch too.
 */
export function beginPress(x: number, y: number, deferred: boolean): PressState {
  return { phase: deferred ? 'pending' : 'armed', originX: x, originY: y };
}

/** Euclidean travel from where the finger landed. */
export function pressDistance(s: PressState, x: number, y: number): number {
  return Math.hypot(x - s.originX, y - s.originY);
}

/**
 * A move while pending past the slop means the user is scrolling, not dragging → give the
 * gesture back to the browser. A move while armed is the drag itself and changes nothing here.
 */
export function pressMove(s: PressState, x: number, y: number, slop = LONG_PRESS_SLOP_PX): PressState {
  if (s.phase !== 'pending') return s;
  return pressDistance(s, x, y) > slop ? IDLE : s;
}

/** The long-press timer fired. */
export function pressArm(s: PressState): PressState {
  return s.phase === 'pending' ? { ...s, phase: 'armed' } : s;
}

export function endPress(): PressState {
  return IDLE;
}

/** Should pointer moves be translated into block movement? */
export function isArmed(s: PressState): boolean {
  return s.phase === 'armed';
}

/** A release while still pending is a tap (open the drawer), never a drag. */
export function isTap(s: PressState): boolean {
  return s.phase === 'pending';
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/longPress.test.ts`. Expected: 8 tests pass.

- [ ] Append the failing wiring tests to `packages/web/src/app/planner/InteractiveBlock.test.tsx` (at the end of the file, after the `InteractiveBlock accent tinting` describe closes):

```tsx
describe('InteractiveBlock on a coarse pointer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const coarseProps = {
    id: 'b1', dayStartMs: DAY, dayIndex: 0, startMs: START, endMs: END,
    topPct: 10, heightPct: 5, startLabel: '09:00', title: 'Write spec',
    kind: 'task' as const, pinned: false, coarse: true,
  };

  it('a press released before the long press is a tap, not a drag', () => {
    const onCommit = vi.fn();
    const onClick = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} onClick={onClick} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('moving before the timer disarms the press — the gesture stays a scroll', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('after the long press the drag arms and commits the snapped move', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(screen.getByTestId('drag-label')).toBeInTheDocument();
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('an armed coarse block lifts and stops the browser owning the gesture', () => {
    render(<InteractiveBlock {...coarseProps} onCommit={vi.fn()} />);
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('touch-pan-y');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(el.className).toContain('shadow-pop');
    expect(el.style.transform).toContain('scale(1.02)');
  });

  it('a fine pointer keeps dragging immediately (no long press, no lift)', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} coarse={false} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    expect(el.className).not.toContain('touch-pan-y');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(el.style.transform).not.toContain('scale');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Extend `packages/web/src/app/planner/InteractiveBlock.test.tsx`'s imports. Replace lines 1–5:

  old:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InteractiveBlock } from './InteractiveBlock';
import { GRID_COLUMN_PX } from './weekModel';
import { minutesToPx } from './weekModel';
```
  new:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InteractiveBlock } from './InteractiveBlock';
import { GRID_COLUMN_PX } from './weekModel';
import { minutesToPx } from './weekModel';
import { LONG_PRESS_MS } from './longPress';
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx`. Expected failure: 4 of the 5 new tests fail (TypeScript rejects `coarse`, and without arming the block drags immediately so the "tap" and "disarm" tests commit).

- [ ] Edit `packages/web/src/app/planner/InteractiveBlock.tsx` — imports and the module-level scroll blocker. Replace lines 1–8:

  old:
```tsx
import { useState, useRef, useEffect, useLayoutEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta, formatHm } from './weekModel';

const MIN_DURATION_MIN = 15;
const HELD_TIMEOUT_MS = 1500;
const iso = (ms: number): string => new Date(ms).toISOString();
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
```
  new:
```tsx
import { useState, useRef, useEffect, useLayoutEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { BASE, variantClass, type BlockKind } from './EventBlock';
import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta, formatHm } from './weekModel';
import { IDLE, beginPress, pressMove, pressArm, endPress, isArmed, isTap, LONG_PRESS_MS, type PressState } from './longPress';

const MIN_DURATION_MIN = 15;
const HELD_TIMEOUT_MS = 1500;
const iso = (ms: number): string => new Date(ms).toISOString();
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Once a touch drag is armed the browser must stop treating the gesture as a scroll. `touch-action`
 * is latched when the finger lands, so flipping a class at arm time is too late — the only way out
 * mid-gesture is a non-passive touchmove listener that preventDefaults. Module-level so the
 * add/remove pair always sees the same function identity.
 */
const blockTouchScroll = (e: TouchEvent): void => { e.preventDefault(); };
```

- [ ] Add the prop. Replace line 32:

  old: `  zone?: string;`
  new:
```tsx
  zone?: string;
  /** Coarse pointer: a body move waits for a long press before it arms, and the tile lifts. */
  coarse?: boolean;
```

- [ ] Replace line 39 (the destructure):

  old: `  const { dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, leftPct = 0, widthPct = 100, startLabel, title, kind, pinned, onCommit, onUnpin, onDelete, onClick, deleteLabel = 'Delete block', dayCount = 7, accent, zone = 'UTC' } = props;`
  new: `  const { dayStartMs, dayIndex, startMs, endMs, topPct, heightPct, leftPct = 0, widthPct = 100, startLabel, title, kind, pinned, onCommit, onUnpin, onDelete, onClick, deleteLabel = 'Delete block', dayCount = 7, accent, zone = 'UTC', coarse = false } = props;`

- [ ] Add the gesture refs. Replace line 67:

  old: `  const rafRef = useRef<number | null>(null);`
  new:
```tsx
  const rafRef = useRef<number | null>(null);
  // Touch gesture arming. On a fine pointer `pressRef` is 'armed' from pointerdown, so every
  // branch below collapses to today's behaviour.
  const pressRef = useRef<PressState>(IDLE);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
```

- [ ] Extend the unmount cleanup. Replace lines 98–103:

  old:
```tsx
  useEffect(() => {
    return () => {
      if (heldTimerRef.current) clearTimeout(heldTimerRef.current);
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    };
  }, []);
```
  new:
```tsx
  useEffect(() => {
    return () => {
      if (heldTimerRef.current) clearTimeout(heldTimerRef.current);
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      const cap = captureRef.current;
      if (cap) cap.el.removeEventListener('touchmove', blockTouchScroll);
    };
  }, []);
```

- [ ] Replace `begin`, lines 129–140:

  old:
```tsx
  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    }
    modeRef.current = mode;
    startYRef.current = finite(e.clientY);
    startXRef.current = finite(e.clientX);
    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;
    setActiveDrag(true);
  };
```
  new:
```tsx
  const clearPressTimer = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };

  const armDrag = (el: HTMLElement, pointerId: number) => {
    if (typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(pointerId); } catch { /* jsdom / unsupported */ }
    }
    el.addEventListener('touchmove', blockTouchScroll, { passive: false });
    captureRef.current = { el, pointerId };
    setActiveDrag(true);
  };

  const releaseDrag = () => {
    const cap = captureRef.current;
    captureRef.current = null;
    if (!cap) return;
    cap.el.removeEventListener('touchmove', blockTouchScroll);
    if (typeof cap.el.releasePointerCapture === 'function') {
      try { cap.el.releasePointerCapture(cap.pointerId); } catch { /* not captured */ }
    }
  };

  const begin = (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    // Only a body *move* on a coarse pointer waits: the resize handle is unambiguous, so it
    // drags immediately on touch too.
    const deferred = coarse && mode === 'move';
    pressRef.current = beginPress(finite(e.clientX), finite(e.clientY), deferred);
    modeRef.current = mode;
    startYRef.current = finite(e.clientY);
    startXRef.current = finite(e.clientX);
    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;
    clearPressTimer();
    if (isArmed(pressRef.current)) { armDrag(el, pointerId); return; }
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      pressRef.current = pressArm(pressRef.current);
      if (isArmed(pressRef.current)) armDrag(el, pointerId);
    }, LONG_PRESS_MS);
  };
```

- [ ] Replace `onPointerMove`, lines 150–155:

  old:
```tsx
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!modeRef.current) return;
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setDayDelta(snappedDx(e.clientX)); setGrowMin(0); }
    else { setGrowMin(min); setMoveMin(0); setDayDelta(0); }
  };
```
  new:
```tsx
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!modeRef.current) return;
    pressRef.current = pressMove(pressRef.current, finite(e.clientX), finite(e.clientY));
    if (pressRef.current.phase === 'idle') {
      // Travelled before the long press armed → the user is scrolling. Hand the gesture back.
      clearPressTimer();
      releaseDrag();
      resetDragState();
      return;
    }
    if (!isArmed(pressRef.current)) return; // still counting down: no preview, no capture
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setDayDelta(snappedDx(e.clientX)); setGrowMin(0); }
    else { setGrowMin(min); setMoveMin(0); setDayDelta(0); }
  };
```

- [ ] Replace the head of `onPointerUp`, lines 168–171:

  old:
```tsx
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const deltaMin = snappedDy(e.clientY);
    const deltaDays = modeRef.current === 'move' ? snappedDx(e.clientX) : 0;
    const mode = modeRef.current;
```
  new:
```tsx
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    clearPressTimer();
    releaseDrag();
    if (isTap(pressRef.current)) {
      // Released before the long press armed: a tap opens the drawer, it never commits.
      const tappedMode = modeRef.current;
      pressRef.current = endPress();
      resetDragState();
      if (tappedMode === 'move') onClick?.();
      return;
    }
    pressRef.current = endPress();
    const deltaMin = snappedDy(e.clientY);
    const deltaDays = modeRef.current === 'move' ? snappedDx(e.clientX) : 0;
    const mode = modeRef.current;
```

- [ ] Replace `onPointerCancel`, line 203:

  old: `  const onPointerCancel = () => { resetDragState(); };`
  new: `  const onPointerCancel = () => { clearPressTimer(); releaseDrag(); pressRef.current = endPress(); resetDragState(); };`

- [ ] Add the lift. Insert after line 232 (`const held = heldMove !== 0 || heldGrow !== 0 || heldDay !== 0;`):

```tsx
  // Visual lift while a touch drag is live: shadow + a hair of scale, so the tile reads as
  // "picked up". Scale rides the inline transform because an inline transform beats a utility.
  const lifted = coarse && activeDrag;
```

- [ ] Replace the root element's className and transform, lines 249–250:

  old:
```tsx
      className={`group ${BASE} ${activeDrag ? 'cursor-grabbing' : 'cursor-grab'} select-none ${variantClass(kind, pinned, accent)} ${transitionClass}`}
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${heightDelta}px)`, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, transform: `translate(${transformX}px, ${transformY}px)`, ...accentStyles }}
```
  new:
```tsx
      className={`group ${BASE} ${activeDrag ? 'cursor-grabbing' : 'cursor-grab'} select-none ${coarse ? 'touch-pan-y' : ''} ${lifted ? 'shadow-pop' : ''} ${variantClass(kind, pinned, accent)} ${transitionClass}`}
      style={{ top: `${topPct}%`, height: `calc(${heightPct}% + ${heightDelta}px)`, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, transform: `translate(${transformX}px, ${transformY}px)${lifted ? ' scale(1.02)' : ''}`, ...accentStyles }}
```

- [ ] Thread `coarse` through `WeekGrid`. In `packages/web/src/app/planner/WeekGrid.tsx`, replace the `compact` prop declaration added in Task 3:

  old:
```tsx
  /** Below-md layout: narrow gutter, wrapped toolbar, Tasks sheet button, no legend. */
  compact?: boolean;
```
  new:
```tsx
  /** Below-md layout: narrow gutter, wrapped toolbar, Tasks sheet button, no legend. */
  compact?: boolean;
  /** Coarse pointer: long-press-armed drag, bigger resize target, always-visible actions. */
  coarse?: boolean;
```

  and replace the destructure tail `, compact = false } = props;` with `, compact = false, coarse = false } = props;`.

- [ ] Pass it to both blocks. Replace the first `<InteractiveBlock>` tail:

  old:
```tsx
                          dayCount={days.length}
                          accent={accent}
                          zone={zone}
                        />
```
  new:
```tsx
                          dayCount={days.length}
                          accent={accent}
                          zone={zone}
                          coarse={coarse}
                        />
```

  and the second (app-created events):

  old:
```tsx
                          deleteLabel="Delete event"
                          dayCount={days.length}
                          zone={zone}
                        />
```
  new:
```tsx
                          deleteLabel="Delete event"
                          dayCount={days.length}
                          zone={zone}
                          coarse={coarse}
                        />
```

- [ ] Subscribe once in `packages/web/src/app/pages/Planner.tsx`. Replace the import added in Task 4:

  old: `import { useCompactWidth } from '../lib/useMediaQuery';`
  new: `import { useCompactWidth, usePointerCoarse } from '../lib/useMediaQuery';`

  and replace:

  old: `  const compact = useCompactWidth();`
  new:
```tsx
  const compact = useCompactWidth();
  // One media-query subscription for the whole page rather than one per tile.
  const coarse = usePointerCoarse();
```

  and add the prop to `<WeekGrid>` immediately after `compact={compact}`:

  old: `          compact={compact}`
  new:
```tsx
          compact={compact}
          coarse={coarse}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx`. Expected: all pass. In particular every pre-existing `InteractiveBlock` test still passes because `coarse` defaults to `false` → `beginPress(..., false)` → armed at pointerdown → today's exact code path.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **552 passed (552), 65 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/longPress.ts packages/web/src/app/planner/longPress.test.ts packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/pages/Planner.tsx
git commit -m "$(cat <<'EOF'
feat(web): long-press-armed block drag on coarse pointers

Extracts the arming decisions into a pure longPress module (pending → armed →
idle, 350ms, 8px slop, both tunable) and wires InteractiveBlock around it: on
touch the tile carries touch-pan-y so a swipe still scrolls, a 350ms hold arms
the drag (pointer capture + a non-passive touchmove blocker, since touch-action
is latched at finger-down), and a release before arming is a tap. Same 15-min
snap, cross-day logic and landing transition-bridge as before. Fine pointers
take the identical code path they always did.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 6 — Resize: 24px hit area on coarse, still drag-immediate

The visible bar stays 6px; only the touch target grows, and only when the tile is tall enough that a 24px target would not swallow it. A 15-minute tile is 14.5px tall, so it keeps the small handle and stays tappable.

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts` (append after `rangeLabel`)
- Modify (test): `packages/web/src/app/planner/weekModel.test.ts` (append a describe; extend the import list)
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx` (import line 3; resize handle lines 286–290)
- Modify (test): `packages/web/src/app/planner/InteractiveBlock.test.tsx` (append to the coarse describe)

**Interfaces:**
- Produces: `export const COARSE_RESIZE_MIN_SPAN_MIN = 30`; `export function resizeHandleClass(heightPct: number, coarse: boolean): 'h-1.5' | 'h-6'`.
- Consumes: `resizeHandleClass` in `InteractiveBlock`.

**Steps:**

- [ ] Append the failing test to `packages/web/src/app/planner/weekModel.test.ts`:

```ts
describe('resizeHandleClass', () => {
  const pct = (min: number) => (min / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100;

  it('a fine pointer always gets the 6px bar', () => {
    expect(resizeHandleClass(pct(60), false)).toBe('h-1.5');
    expect(resizeHandleClass(pct(15), false)).toBe('h-1.5');
  });

  it('a coarse pointer gets the 24px target on tiles of 30 minutes or more', () => {
    expect(resizeHandleClass(pct(30), true)).toBe('h-6');
    expect(resizeHandleClass(pct(60), true)).toBe('h-6');
    expect(resizeHandleClass(pct(480), true)).toBe('h-6');
  });

  it('keeps the small target on short tiles a 24px handle would swallow', () => {
    expect(resizeHandleClass(pct(15), true)).toBe('h-1.5');
    expect(resizeHandleClass(pct(29), true)).toBe('h-1.5');
    expect(COARSE_RESIZE_MIN_SPAN_MIN).toBe(30);
  });
});
```

- [ ] Extend the import list in `packages/web/src/app/planner/weekModel.test.ts`. Replace the line added in Task 2:

  old: `  MOBILE_TIME_GUTTER_PX, MOBILE_MIN_DAY_COL_PX, timeGutterPx, popoverAlign, rangeLabel,`
  new: `  MOBILE_TIME_GUTTER_PX, MOBILE_MIN_DAY_COL_PX, timeGutterPx, popoverAlign, rangeLabel,`
  `  COARSE_RESIZE_MIN_SPAN_MIN, resizeHandleClass,`

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`. Expected failure: `does not provide an export named 'resizeHandleClass'`.

- [ ] Append to `packages/web/src/app/planner/weekModel.ts` (after `rangeLabel`):

```ts
/**
 * Minutes a tile must span before a coarse pointer earns the enlarged resize target. Below it a
 * 24px handle would cover the whole tile (a 15-min block is 14.5px tall) and eat the tap that
 * should open the drawer.
 */
export const COARSE_RESIZE_MIN_SPAN_MIN = 30;

/** Literal Tailwind height class for the resize hit area. The visible bar never changes. */
export function resizeHandleClass(heightPct: number, coarse: boolean): 'h-1.5' | 'h-6' {
  if (!coarse) return 'h-1.5';
  const spanMin = (heightPct / 100) * (WINDOW_END_MIN - WINDOW_START_MIN);
  return spanMin >= COARSE_RESIZE_MIN_SPAN_MIN ? 'h-6' : 'h-1.5';
}
```

- [ ] Append the failing wiring tests inside `describe('InteractiveBlock on a coarse pointer', …)` in `packages/web/src/app/planner/InteractiveBlock.test.tsx` (before its closing `});`):

```tsx
  it('gives a tall tile a 24px, scroll-proof resize target', () => {
    render(<InteractiveBlock {...coarseProps} heightPct={4.1667} onCommit={vi.fn()} />); // 60 min
    const handle = screen.getByTestId('resize-handle');
    expect(handle.className).toContain('h-6');
    expect(handle.className).toContain('touch-none');
  });

  it('keeps the small target on a 15-minute tile', () => {
    render(<InteractiveBlock {...coarseProps} heightPct={1.0417} onCommit={vi.fn()} />); // 15 min
    expect(screen.getByTestId('resize-handle').className).toContain('h-1.5');
  });

  it('resize drags immediately on touch — no long press', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx`. Expected failure: the two class assertions fail (`h-1.5` is still hardcoded, `touch-none` absent). The third already passes — proof the resize path was never deferred.

- [ ] Edit `packages/web/src/app/planner/InteractiveBlock.tsx`. Replace line 3:

  old: `import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta, formatHm } from './weekModel';`
  new: `import { WINDOW_END_MIN, snapMinutes, pxToMinutes, minutesToPx, clampToWindow, shiftDays, clampDayDelta, formatHm, resizeHandleClass } from './weekModel';`

- [ ] Replace the resize handle, lines 286–290:

  old:
```tsx
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      />
```
  new:
```tsx
      {/* Invisible hit area; the visible bar is unchanged. `touch-none` on the handle means a
          finger that lands here is a resize from the first pixel — no long press needed. */}
      <span
        data-testid="resize-handle"
        onPointerDown={begin('resize')}
        className={`absolute inset-x-0 bottom-0 cursor-ns-resize ${resizeHandleClass(heightPct, coarse)} ${coarse ? 'touch-none' : ''}`}
      />
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx src/app/planner/weekModel.test.ts`. Expected: all pass. The pre-existing `renders an event-block with kind/pinned and a resize handle` and the two resize-drag tests are unaffected (`coarse` false → `h-1.5`, no `touch-none`).

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **558 passed (558), 65 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): 24px resize target on coarse pointers

resizeHandleClass gives touch a 24px invisible hit area with touch-none (drag
from the first pixel, no long press) on tiles of 30 minutes or more, and keeps
the 6px bar on shorter tiles a tall handle would swallow. Visible bar and every
fine-pointer path unchanged.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 7 — Edge auto-scroll of the hours container while dragging

Touch does not get auto-scroll for free. While a drag is live near the top/bottom edge of `hours-scroll`, a rAF loop nudges the container — and the drag's own minute delta must absorb that scroll, otherwise auto-scroll moves the viewport without moving the block.

**Files:**
- Create: `packages/web/src/app/planner/edgeScroll.ts`
- Create (test): `packages/web/src/app/planner/edgeScroll.test.ts`
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx` (import; props; destructure; refs; `begin`; `snappedDy`; `onPointerMove`; `onPointerUp`; `onPointerCancel`; unmount effect)
- Modify (test): `packages/web/src/app/planner/InteractiveBlock.test.tsx` (append a describe)
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (both `<InteractiveBlock>` usages)

**Interfaces:**
- Produces `packages/web/src/app/planner/edgeScroll.ts`:
  - `export const EDGE_ZONE_PX = 48`
  - `export const MAX_EDGE_SCROLL_PX = 14`
  - `export function edgeScrollStep(clientY: number, top: number, bottom: number, zonePx?: number, maxPx?: number): number`
  - `export function useEdgeAutoScroll(getContainer: () => HTMLElement | null): { update(clientY: number): void; stop(): void }`
- Produces: `InteractiveBlockProps` gains `getScrollContainer?: () => HTMLElement | null`.
- Consumes: `WeekGrid` passes `getScrollContainer={() => scrollRef.current}` — the same ref that already scrolls the grid to "now" on mount.

**Steps:**

- [ ] Write the failing test `packages/web/src/app/planner/edgeScroll.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { edgeScrollStep, EDGE_ZONE_PX, MAX_EDGE_SCROLL_PX } from './edgeScroll';

const TOP = 100;
const BOTTOM = 700;

describe('edgeScrollStep', () => {
  it('exports tunable constants', () => {
    expect(EDGE_ZONE_PX).toBe(48);
    expect(MAX_EDGE_SCROLL_PX).toBe(14);
  });

  it('does nothing away from the edges', () => {
    expect(edgeScrollStep(400, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(TOP + EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(BOTTOM - EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
  });

  it('ramps up as the pointer nears the top edge', () => {
    const near = edgeScrollStep(TOP + 40, TOP, BOTTOM);
    const nearer = edgeScrollStep(TOP + 10, TOP, BOTTOM);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeScrollStep(TOP, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('clamps past the top edge instead of accelerating forever', () => {
    expect(edgeScrollStep(TOP - 500, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('ramps down as the pointer nears the bottom edge and clamps past it', () => {
    const near = edgeScrollStep(BOTTOM - 40, TOP, BOTTOM);
    expect(near).toBeGreaterThan(0);
    expect(edgeScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(near);
    expect(edgeScrollStep(BOTTOM, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
    expect(edgeScrollStep(BOTTOM + 500, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
  });

  it('is inert for a degenerate rect (jsdom measures everything as zero)', () => {
    expect(edgeScrollStep(0, 0, 0)).toBe(0);
    expect(edgeScrollStep(50, 100, 100)).toBe(0);
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/edgeScroll.test.ts`. Expected failure: `Failed to resolve import "./edgeScroll"`.

- [ ] Create `packages/web/src/app/planner/edgeScroll.ts` with exactly:

```ts
import { useEffect, useRef } from 'react';

/** How deep into the container an edge drag starts scrolling. */
export const EDGE_ZONE_PX = 48;
/** Pixels per frame at the very edge (≈ 840px/s at 60fps). */
export const MAX_EDGE_SCROLL_PX = 14;

/**
 * Signed pixels to scroll this frame: negative near the top, positive near the bottom, zero in
 * the middle, linearly ramped and clamped past the edge. Pure — the caller owns the rAF loop.
 */
export function edgeScrollStep(
  clientY: number,
  top: number,
  bottom: number,
  zonePx = EDGE_ZONE_PX,
  maxPx = MAX_EDGE_SCROLL_PX,
): number {
  const height = bottom - top;
  if (height <= 0) return 0;                 // jsdom / unlaid-out container: never scroll
  const zone = Math.min(zonePx, height / 2); // the two zones must not overlap
  if (zone <= 0) return 0;
  if (clientY < top + zone) {
    const depth = Math.min(zone, top + zone - clientY);
    return -Math.ceil((depth / zone) * maxPx);
  }
  if (clientY > bottom - zone) {
    const depth = Math.min(zone, clientY - (bottom - zone));
    return Math.ceil((depth / zone) * maxPx);
  }
  return 0;
}

/**
 * rAF loop that scrolls a DI'd container while a drag hovers near its edges. The container is
 * supplied as a getter so the caller can pass a ref that is null on the first render, and so
 * tests can hand in a plain object.
 */
export function useEdgeAutoScroll(getContainer: () => HTMLElement | null): {
  update(clientY: number): void;
  stop(): void;
} {
  const getRef = useRef(getContainer);
  const yRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { getRef.current = getContainer; });
  useEffect(() => () => {
    if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
  }, []);

  const api = useRef({
    update(clientY: number) {
      yRef.current = clientY;
      if (rafRef.current != null || typeof requestAnimationFrame !== 'function') return;
      const tick = () => {
        rafRef.current = null;
        const y = yRef.current;
        const el = getRef.current();
        if (y == null || !el) return;
        const rect = el.getBoundingClientRect();
        const step = edgeScrollStep(y, rect.top, rect.bottom);
        if (step !== 0) el.scrollTop += step;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    stop() {
      yRef.current = null;
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
  });

  return api.current;
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/edgeScroll.test.ts`. Expected: 6 tests pass.

- [ ] Append the failing wiring tests to `packages/web/src/app/planner/InteractiveBlock.test.tsx` (end of file):

```tsx
describe('InteractiveBlock scroll compensation', () => {
  /** The component only reads scrollTop / getBoundingClientRect, so a plain object is enough. */
  function fakeScroller(): HTMLElement {
    return {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 300, width: 300, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
    } as unknown as HTMLElement;
  }

  it('folds the container scroll during a drag into the committed move', () => {
    const onCommit = vi.fn();
    const scroller = fakeScroller();
    render(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={onCommit} getScrollContainer={() => scroller}
      />,
    );
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    // The finger stays put; the auto-scroll moved the grid one hour's worth underneath it.
    scroller.scrollTop = PX_PER_60MIN;
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('is a no-op without a container (every existing caller before this task)', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx`. Expected failure: TypeScript rejects `getScrollContainer`; the first test commits nothing.

- [ ] Edit `packages/web/src/app/planner/InteractiveBlock.tsx`. Add the import after the `longPress` import:

  old: `import { IDLE, beginPress, pressMove, pressArm, endPress, isArmed, isTap, LONG_PRESS_MS, type PressState } from './longPress';`
  new:
```tsx
import { IDLE, beginPress, pressMove, pressArm, endPress, isArmed, isTap, LONG_PRESS_MS, type PressState } from './longPress';
import { useEdgeAutoScroll } from './edgeScroll';
```

- [ ] Add the prop. Replace the `coarse` prop declaration added in Task 5:

  old:
```tsx
  /** Coarse pointer: a body move waits for a long press before it arms, and the tile lifts. */
  coarse?: boolean;
```
  new:
```tsx
  /** Coarse pointer: a body move waits for a long press before it arms, and the tile lifts. */
  coarse?: boolean;
  /** The vertically scrolling hours container, for edge auto-scroll and scroll compensation. */
  getScrollContainer?: () => HTMLElement | null;
```

  and replace the destructure tail `, coarse = false } = props;` with `, coarse = false, getScrollContainer } = props;`.

- [ ] Add the scroll refs and the hook. Replace the gesture-ref block added in Task 5:

  old:
```tsx
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
```
  new:
```tsx
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
  // scrollTop at drag start: auto-scroll moves the grid under a still finger, and that motion
  // has to become part of the drag delta or the block would stay put while the view slides.
  const scrollStartRef = useRef(0);
  const edgeScroll = useEdgeAutoScroll(() => getScrollContainer?.() ?? null);
```

- [ ] Seed the scroll baseline in `begin`. Replace:

  old: `    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;`
  new:
```tsx
    colWidthRef.current = mode === 'move' ? (el.parentElement?.getBoundingClientRect().width ?? 0) : 0;
    scrollStartRef.current = getScrollContainer?.()?.scrollTop ?? 0;
```

- [ ] Fold the scroll into the delta. Replace line 142 (as it stands after Task 5 — the `snappedDy` definition):

  old: `  const snappedDy = (clientY: number): number => snapMinutes(pxToMinutes(finite(clientY) - startYRef.current));`
  new:
```tsx
  /** How far the hours container has scrolled since the drag began (0 without a container). */
  const scrollDelta = (): number => {
    const el = getScrollContainer?.();
    return el ? el.scrollTop - scrollStartRef.current : 0;
  };

  const snappedDy = (clientY: number): number =>
    snapMinutes(pxToMinutes(finite(clientY) - startYRef.current + scrollDelta()));
```

- [ ] Drive the loop. In `onPointerMove`, replace:

  old:
```tsx
    if (!isArmed(pressRef.current)) return; // still counting down: no preview, no capture
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setDayDelta(snappedDx(e.clientX)); setGrowMin(0); }
```
  new:
```tsx
    if (!isArmed(pressRef.current)) return; // still counting down: no preview, no capture
    edgeScroll.update(finite(e.clientY));
    const min = snappedDy(e.clientY);
    if (modeRef.current === 'move') { setMoveMin(min); setDayDelta(snappedDx(e.clientX)); setGrowMin(0); }
```

- [ ] Stop the loop on release. In `onPointerUp`, replace:

  old:
```tsx
    clearPressTimer();
    releaseDrag();
    if (isTap(pressRef.current)) {
```
  new:
```tsx
    clearPressTimer();
    releaseDrag();
    edgeScroll.stop();
    if (isTap(pressRef.current)) {
```

  and in `onPointerCancel`:

  old: `  const onPointerCancel = () => { clearPressTimer(); releaseDrag(); pressRef.current = endPress(); resetDragState(); };`
  new: `  const onPointerCancel = () => { clearPressTimer(); releaseDrag(); edgeScroll.stop(); pressRef.current = endPress(); resetDragState(); };`

  and in the disarm branch of `onPointerMove`:

  old:
```tsx
      clearPressTimer();
      releaseDrag();
      resetDragState();
      return;
```
  new:
```tsx
      clearPressTimer();
      releaseDrag();
      edgeScroll.stop();
      resetDragState();
      return;
```

- [ ] Hand `WeekGrid`'s scroller to both blocks. Replace the first `<InteractiveBlock>` tail:

  old:
```tsx
                          zone={zone}
                          coarse={coarse}
                        />
```
  new:
```tsx
                          zone={zone}
                          coarse={coarse}
                          getScrollContainer={() => scrollRef.current}
                        />
```

  and the second:

  old:
```tsx
                          dayCount={days.length}
                          zone={zone}
                          coarse={coarse}
                        />
```
  new:
```tsx
                          dayCount={days.length}
                          zone={zone}
                          coarse={coarse}
                          getScrollContainer={() => scrollRef.current}
                        />
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx`. Expected: all pass. `WeekGrid`/`Planner` tests are unaffected — jsdom's `scrollTop` never leaves 0, so `scrollDelta()` is 0 and `edgeScrollStep` sees a zero-height rect.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **566 passed (566), 66 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/edgeScroll.ts packages/web/src/app/planner/edgeScroll.test.ts packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx packages/web/src/app/planner/WeekGrid.tsx
git commit -m "$(cat <<'EOF'
feat(web): edge auto-scroll while dragging a planner block

A pure edgeScrollStep (linear ramp inside a 48px zone, clamped at 14px/frame)
plus a rAF loop over a DI'd container, so dragging near the top/bottom of the
hours list scrolls it — touch gets none of that for free. The drag delta now
also absorbs the container's scroll, otherwise auto-scroll would slide the view
while the block stayed put. Desktop callers without a container are unchanged.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 8 — `CreatePopover` as a bottom sheet + always-visible actions on coarse

**Files:**
- Modify: `packages/web/src/app/planner/CreatePopover.tsx` (props interface lines 10–18; signature line 25; root element lines 98–105)
- Modify (test): `packages/web/src/app/planner/CreatePopover.test.tsx` (append a describe)
- Modify: `packages/web/src/app/planner/EventBlock.tsx` (props interface lines 22–33; signature line 35; delete button line 57)
- Modify (test): `packages/web/src/app/planner/EventBlock.test.tsx` (append a test)
- Modify: `packages/web/src/app/planner/InteractiveBlock.tsx` (delete button line 259)
- Modify (test): `packages/web/src/app/planner/InteractiveBlock.test.tsx` (append to the coarse describe)
- Modify: `packages/web/src/app/planner/PlannerTaskPanel.tsx` (`TaskCard` signature line 25–28; actions span line 74; `card` helper line 118; component signature/aside)
- Modify (test): `packages/web/src/app/planner/PlannerTaskPanel.test.tsx` (append a test)
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (`<CreatePopover>` and `<EventBlock>` usages)
- Modify: `packages/web/src/app/pages/Planner.tsx` (`<PlannerTaskPanel>` via `panelProps`)

**Interfaces:**
- Produces: `CreatePopoverProps` gains `compact?: boolean`; `EventBlockProps` gains `coarse?: boolean`; `PlannerTaskPanelProps` gains `coarse?: boolean`. All default `false`.
- Consumes: `WeekGrid` already holds `compact` and `coarse`; `Planner` already holds `coarse`.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/planner/CreatePopover.test.tsx` (end of file):

```tsx
describe('CreatePopover as a bottom sheet', () => {
  it('compact pins the form to the viewport bottom with no anchored geometry', () => {
    renderWithProviders(<CreatePopover {...baseProps} compact />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    expect(popover.className).toContain('fixed');
    expect(popover.className).toContain('bottom-0');
    expect(popover.className).toContain('inset-x-0');
    expect(popover.className).toContain('max-h-[85dvh]');
    expect(popover.className).toContain('overflow-y-auto');
    expect(popover.className).not.toContain('absolute');
    // No inline top: an anchored percentage would stretch the sheet up the viewport.
    expect(popover.style.top).toBe('');
  });

  it('compact ignores the anchored align rule', () => {
    renderWithProviders(<CreatePopover {...baseProps} compact align="right" />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    expect(popover.className).not.toContain('right-1');
    expect(popover.className).not.toContain('left-1');
  });

  it('compact keeps the same form and the snapped slot', () => {
    renderWithProviders(<CreatePopover {...baseProps} compact />, { api: fakeApiClient() });
    expect(screen.getByTestId('slot-label').textContent).toMatch(/09:00.*09:30/);
    expect(screen.getByTestId('mode-event')).toBeInTheDocument();
    expect(screen.getByTestId('mode-task')).toBeInTheDocument();
    expect(screen.getByTestId('mode-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('create-submit')).toBeInTheDocument();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/CreatePopover.test.tsx`. Expected failure: TypeScript rejects `compact`, and the class assertions fail.

- [ ] Edit `packages/web/src/app/planner/CreatePopover.tsx`. Replace line 17:

  old: `  zone?: string;`
  new:
```tsx
  zone?: string;
  /** Below md: render as a viewport-fixed bottom sheet instead of a column-anchored popover. */
  compact?: boolean;
```

- [ ] Replace line 25:

  old: `export function CreatePopover({ dayStartMs, startMin, topPct, onClose, align = 'left', now = () => Date.now(), zone = 'UTC' }: CreatePopoverProps) {`
  new: `export function CreatePopover({ dayStartMs, startMin, topPct, onClose, align = 'left', now = () => Date.now(), zone = 'UTC', compact = false }: CreatePopoverProps) {`

- [ ] Replace the root element, lines 99–105:

  old:
```tsx
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 w-[340px] animate-pop rounded-[14px] border border-line bg-card p-4 shadow-pop ${align === 'left' ? 'left-1' : 'right-1'}`}
      style={{ top: `${Math.min(topPct, 78)}%` }}
    >
```
  new:
```tsx
    // Compact: a viewport-fixed sheet, so it escapes the hours-scroll `overflow-y-auto` that
    // clips a 340px popover inside a ~150px column. The grid tap still sets the snapped slot;
    // the sheet just shows it. Desktop keeps the anchored popover byte-for-byte.
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className={compact
        ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] w-full animate-pop overflow-y-auto rounded-t-[16px] border-t border-line bg-card p-4 pb-[calc(16px_+_env(safe-area-inset-bottom))] shadow-pop'
        : `absolute z-40 w-[340px] animate-pop rounded-[14px] border border-line bg-card p-4 shadow-pop ${align === 'left' ? 'left-1' : 'right-1'}`}
      style={compact ? undefined : { top: `${Math.min(topPct, 78)}%` }}
    >
```

- [ ] Pass it from `WeekGrid`. Replace lines 287–296 (the `<CreatePopover>` usage):

  old:
```tsx
                    <CreatePopover
                      dayStartMs={d}
                      startMin={creating.startMin}
                      topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                      onClose={() => setCreating(null)}
                      align={popoverAlign(i, days.length)}
                      zone={zone}
                    />
```
  new:
```tsx
                    <CreatePopover
                      dayStartMs={d}
                      startMin={creating.startMin}
                      topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                      onClose={() => setCreating(null)}
                      align={popoverAlign(i, days.length)}
                      zone={zone}
                      compact={compact}
                    />
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/CreatePopover.test.tsx`. Expected: all pass, including the pre-existing `popover has w-[340px] width class` / `left-1` / `right-1` assertions (the desktop branch is unchanged).

- [ ] Append the failing coarse-visibility tests. To `packages/web/src/app/planner/InteractiveBlock.test.tsx`, inside `describe('InteractiveBlock on a coarse pointer', …)`:

```tsx
  it('shows the delete button without a hover on touch', () => {
    render(<InteractiveBlock {...coarseProps} onCommit={vi.fn()} onDelete={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    expect(btn.className).toContain('flex');
    expect(btn.className).not.toContain('hidden');
    expect(btn.className).not.toContain('group-hover:flex');
  });
```

  To `packages/web/src/app/planner/EventBlock.test.tsx` — first widen its vitest import, replacing line 1:

  old: `import { describe, it, expect } from 'vitest';`
  new: `import { describe, it, expect, vi } from 'vitest';`

  then append at the end of the file (after the existing `describe('EventBlock', …)` closes):

```tsx
describe('EventBlock on a coarse pointer', () => {
  it('shows the delete button without a hover', () => {
    render(
      <EventBlock title="Standup" kind="meeting" topPct={10} heightPct={5} startLabel="09:00"
        onDelete={vi.fn()} coarse />,
    );
    const btn = screen.getByRole('button', { name: /delete event/i, hidden: true });
    expect(btn.className).toContain('flex');
    expect(btn.className).not.toContain('group-hover:flex');
  });
});
```

  To `packages/web/src/app/planner/PlannerTaskPanel.test.tsx` (inside the existing describe):

```tsx
  it('keeps the card actions visible on a coarse pointer', () => {
    render(
      <PlannerTaskPanel tasks={[task({ id: 'a', title: 'Do it' })]} preview={undefined} nowMs={NOW} coarse
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const actions = screen.getByRole('button', { name: 'Edit Do it' }).parentElement!;
    expect(actions.className).toContain('opacity-100');
    expect(actions.className).not.toContain('opacity-0');
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/InteractiveBlock.test.tsx src/app/planner/EventBlock.test.tsx src/app/planner/PlannerTaskPanel.test.tsx`. Expected failure: 3 failures (the `coarse` prop does not exist on `EventBlock`/`PlannerTaskPanel`; the classes are still hover-gated).

- [ ] Edit `packages/web/src/app/planner/InteractiveBlock.tsx`. Replace line 259 (the delete button's className):

  old: `          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white group-hover:flex hover:bg-black/45"`
  new: `          className={`absolute right-0.5 top-0.5 z-10 h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white hover:bg-black/45 ${coarse ? 'flex' : 'hidden group-hover:flex'}`}`

- [ ] Edit `packages/web/src/app/planner/EventBlock.tsx`. Replace line 32:

  old: `  onDelete?: () => void;`
  new:
```tsx
  onDelete?: () => void;
  /** Coarse pointer: there is no hover, so the delete affordance is always visible. */
  coarse?: boolean;
```

  Replace line 35:

  old: `export function EventBlock({ title, kind, topPct, heightPct, leftPct = 0, widthPct = 100, startLabel, pinned = false, accent, onDelete }: EventBlockProps) {`
  new: `export function EventBlock({ title, kind, topPct, heightPct, leftPct = 0, widthPct = 100, startLabel, pinned = false, accent, onDelete, coarse = false }: EventBlockProps) {`

  Replace line 57:

  old: `          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white group-hover:flex hover:bg-black/45"`
  new: `          className={`absolute right-0.5 top-0.5 z-10 h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white hover:bg-black/45 ${coarse ? 'flex' : 'hidden group-hover:flex'}`}`

- [ ] Pass it from `WeekGrid`. Replace the `<EventBlock>` usage's last prop, line 273:

  old: `                        onDelete={ev && onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}`
  new:
```tsx
                        onDelete={ev && onDeleteEvent ? () => onDeleteEvent(ev.id) : undefined}
                        coarse={coarse}
```

- [ ] Edit `packages/web/src/app/planner/PlannerTaskPanel.tsx`. Replace lines 25–28 (the `TaskCard` signature):

  old:
```tsx
function TaskCard({ task, nowMs, nextMs, atRisk, leftBorder, onComplete, onEdit, onDelete }: {
  task: Task; nowMs: number; nextMs: number | null; atRisk: boolean; leftBorder: string;
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
```
  new:
```tsx
function TaskCard({ task, nowMs, nextMs, atRisk, leftBorder, coarse, onComplete, onEdit, onDelete }: {
  task: Task; nowMs: number; nextMs: number | null; atRisk: boolean; leftBorder: string; coarse: boolean;
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
```

  Replace line 74 (the actions span):

  old: `      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">`
  new: `      <span className={`flex shrink-0 items-center gap-0.5 transition-opacity ${coarse ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>`

  Replace the component signature (as it stands after Task 4):

  old: `export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete, compact = false }: PlannerTaskPanelProps) {`
  new: `export function PlannerTaskPanel({ tasks, preview, nowMs, onComplete, onEdit, onDelete, compact = false, coarse = false }: PlannerTaskPanelProps) {`

  Replace the `compact` prop declaration in `PlannerTaskPanelProps`:

  old:
```tsx
  /** Rendered inside a bottom sheet: fill the sheet instead of holding the 330px desktop width. */
  compact?: boolean;
```
  new:
```tsx
  /** Rendered inside a bottom sheet: fill the sheet instead of holding the 330px desktop width. */
  compact?: boolean;
  /** Coarse pointer: there is no hover, so the card's edit/delete stay visible. */
  coarse?: boolean;
```

  Replace lines 118–124 (the `card` helper):

  old:
```tsx
  const card = (t: Task, leftBorder: string) => (
    <TaskCard
      key={t.id} task={t} nowMs={nowMs} nextMs={nextBlockMsForTask(t.id, preview)}
      atRisk={atRiskIds.has(t.id)} leftBorder={leftBorder}
      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
    />
  );
```
  new:
```tsx
  const card = (t: Task, leftBorder: string) => (
    <TaskCard
      key={t.id} task={t} nowMs={nowMs} nextMs={nextBlockMsForTask(t.id, preview)}
      atRisk={atRiskIds.has(t.id)} leftBorder={leftBorder} coarse={coarse}
      onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
    />
  );
```

- [ ] Pass it from `Planner`. Replace the `panelProps` object added in Task 4:

  old:
```tsx
  const panelProps = {
    tasks: tasksQ.data ?? [],
    preview: preview.data,
    nowMs,
    onComplete: onCompleteTask,
    onEdit: (t: Task) => openTaskDrawer(t.id),
    onDelete: onDeleteTask,
  };
```
  new:
```tsx
  const panelProps = {
    tasks: tasksQ.data ?? [],
    preview: preview.data,
    nowMs,
    coarse,
    onComplete: onCompleteTask,
    onEdit: (t: Task) => openTaskDrawer(t.id),
    onDelete: onDeleteTask,
  };
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/`. Expected: all planner tests pass. The pre-existing `getByRole(..., { hidden: true })` delete-button queries are unaffected — jsdom applies no Tailwind, so `hidden` was never doing anything there.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **572 passed (572), 66 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/CreatePopover.test.tsx packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/EventBlock.test.tsx packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/InteractiveBlock.test.tsx packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/pages/Planner.tsx
git commit -m "$(cat <<'EOF'
feat(web): CreatePopover bottom sheet + touch-visible actions

Below md the create form is a viewport-fixed bottom sheet, escaping the
hours-scroll clip that made a 340px popover unusable inside a ~150px column;
the grid tap still sets the snapped slot. Desktop keeps the anchored popover
unchanged. Hover-only deletes on blocks, events and panel cards become
always-visible when the pointer is coarse.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 9 — Day-header swipe paging + final verification gate

The swipe lives on the **day header row only** — it sits outside `hours-scroll`, so it cannot fight the vertical hour scrolling, and the ratio guard drops anything that is mostly vertical anyway.

**Files:**
- Modify: `packages/web/src/app/planner/weekModel.ts` (append)
- Modify (test): `packages/web/src/app/planner/weekModel.test.ts` (append; extend imports)
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (import; a touch ref; the header row's handlers)
- Modify (test): `packages/web/src/app/planner/WeekGrid.test.tsx` (append to the compact describe)

**Interfaces:**
- Produces: `export const SWIPE_MIN_PX = 48`; `export function swipeDecision(dx: number, dy: number, minPx?: number): -1 | 0 | 1` (−1 = page back, +1 = page forward, 0 = ignore).

**Steps:**

- [ ] Append the failing test to `packages/web/src/app/planner/weekModel.test.ts`:

```ts
describe('swipeDecision', () => {
  it('ignores a swipe shorter than the threshold', () => {
    expect(swipeDecision(-20, 0)).toBe(0);
    expect(swipeDecision(47, 0)).toBe(0);
    expect(swipeDecision(0, 0)).toBe(0);
  });

  it('a leftward swipe pages forward, a rightward swipe pages back', () => {
    expect(swipeDecision(-120, 4)).toBe(1);
    expect(swipeDecision(120, -4)).toBe(-1);
  });

  it('ignores a mostly-vertical drag so it cannot steal a scroll', () => {
    expect(swipeDecision(-60, 200)).toBe(0);
    expect(swipeDecision(-60, 39)).toBe(1);   // 60 >= 39 * 1.5
    expect(swipeDecision(-60, 41)).toBe(0);   // 60 <  41 * 1.5
  });

  it('takes a tunable threshold', () => {
    expect(swipeDecision(-30, 0)).toBe(0);
    expect(swipeDecision(-30, 0, 20)).toBe(1);
    expect(SWIPE_MIN_PX).toBe(48);
  });
});
```

- [ ] Extend the import list in `packages/web/src/app/planner/weekModel.test.ts`. Replace the line added in Task 6:

  old: `  COARSE_RESIZE_MIN_SPAN_MIN, resizeHandleClass,`
  new: `  COARSE_RESIZE_MIN_SPAN_MIN, resizeHandleClass, SWIPE_MIN_PX, swipeDecision,`

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/weekModel.test.ts`. Expected failure: `does not provide an export named 'swipeDecision'`.

- [ ] Append to `packages/web/src/app/planner/weekModel.ts`:

```ts
/** Minimum horizontal travel before a day-header drag counts as a page swipe. */
export const SWIPE_MIN_PX = 48;

/**
 * How many pages a header swipe moves: +1 forward (swipe left), −1 back (swipe right), 0 when the
 * gesture is too short or too vertical. The 1.5× ratio guard keeps a diagonal scroll from paging.
 */
export function swipeDecision(dx: number, dy: number, minPx = SWIPE_MIN_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < minPx) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
```

- [ ] Append the failing wiring tests inside `describe('WeekGrid compact (below md)', …)` in `packages/web/src/app/planner/WeekGrid.test.tsx`:

```tsx
  it('swiping the day header left pages forward and right pages back', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderGrid({ compact: true, onNext, onPrev });
    const header = screen.getByTestId('day-header-row');
    fireEvent.touchStart(header, { touches: [{ clientX: 300, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 120, clientY: 24 }] });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.touchStart(header, { touches: [{ clientX: 120, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 300, clientY: 24 }] });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('a mostly-vertical drag on the header does not page', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderGrid({ compact: true, onNext, onPrev });
    const header = screen.getByTestId('day-header-row');
    fireEvent.touchStart(header, { touches: [{ clientX: 300, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 240, clientY: 320 }] });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx`. Expected failure: 2 failures — `onNext`/`onPrev` are never called.

- [ ] Edit `packages/web/src/app/planner/WeekGrid.tsx`. Extend the weekModel import (line 5, as it stands after Task 3):

  old: `import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign } from './weekModel';`
  new: `import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY, snapClickToSlot, WINDOW_START_MIN, WINDOW_END_MIN, GRID_COLUMN_PX, dayAnchor, formatHm, weekdayLabel, dayOfMonth, hourRowLabel, timeGutterPx, popoverAlign, swipeDecision } from './weekModel';`

- [ ] Add the touch origin ref next to `scrollRef`. Replace line 84 (as it stands):

  old: `  const scrollRef = useRef<HTMLDivElement>(null);`
  new:
```tsx
  const scrollRef = useRef<HTMLDivElement>(null);
  // Where a day-header drag started. The header sits OUTSIDE hours-scroll, so a swipe here can
  // never fight the vertical hour scrolling; the ratio guard in swipeDecision covers diagonals.
  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
```

- [ ] Wire the handlers on the header row. Replace the line added in Task 3:

  old: `          <div data-testid="day-header-row" className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>`
  new:
```tsx
          <div
            data-testid="day-header-row"
            className="grid border-b border-line"
            style={{ gridTemplateColumns: gridCols }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              swipeOriginRef.current = t ? { x: t.clientX, y: t.clientY } : null;
            }}
            onTouchEnd={(e) => {
              const origin = swipeOriginRef.current;
              swipeOriginRef.current = null;
              const t = e.changedTouches[0];
              if (!origin || !t) return;
              const pages = swipeDecision(t.clientX - origin.x, t.clientY - origin.y);
              if (pages === 1) onNext();
              else if (pages === -1) onPrev();
            }}
          >
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx src/app/planner/weekModel.test.ts`. Expected: all pass.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: **578 passed (578), 66 files**.

- [ ] Run the type/build gate `npm run build -w @notreclaim/web`. Expected: `tsc` clean (test files are inside `include`), then a successful `vite build`.

- [ ] Run the grep guards and confirm each result:

```sh
# the inline desktop-only hours-scroll height is gone
grep -rn "calc(100dvh - 230px)" packages/web/src            # expect: no matches
# the hardcoded 7-day popover rule is gone
grep -rn "i <= 3" packages/web/src/app/planner              # expect: no matches
# no `import React` crept in
grep -rn "^import React" packages/web/src                   # expect: no matches
# no computed Tailwind class names in the files this phase touched
grep -rnE "className=\{\`[^\`]*\$\{[a-zA-Z]+\}(px|rem)" packages/web/src/app/planner  # expect: no matches
# every new pure module is Date.now-free
grep -rn "Date.now()" packages/web/src/app/planner/longPress.ts packages/web/src/app/planner/edgeScroll.ts packages/web/src/app/planner/weekModel.ts   # expect: no matches
# Phase 4 surfaces untouched
git diff --name-only HEAD~8..HEAD | grep -E "TaskDrawer|EventDrawer|HabitDrawer|NewTaskModal"  # expect: no matches
```

- [ ] Commit:

```sh
git add packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): swipe the day header to page by dayCount

A pure swipeDecision (48px threshold, 1.5x horizontal-over-vertical ratio
guard) wired to touch handlers on the day-header row only — it sits outside
hours-scroll, so it cannot fight the vertical hour scrolling.

Completes mobile Phase 2: web suite 578 / 66 files.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

### Live verification (after the last commit)

**Restart Vite before looking at anything** — stale Vite state has produced false "not fixed" reports twice in this project's history (R13, R14). Then browser-drive:

- [ ] **390 × 844, touch emulation on.** Planner route.
  - Exactly **one** day column, today-anchored; hour gutter ~44px with small labels; **no horizontal page scroll**; no white sliver column.
  - Toolbar: ‹ › are 44px, the label reads a single date (e.g. "Aug 26") and does not bleed; Today / Re-plan / Tasks all on screen; **no legend**.
  - Force the unscheduled banner (e.g. a task that cannot fit): it renders as a full-width wrapping row above the grid, not a one-word column.
  - Scroll the hour grid to the bottom: the last hour is reachable and the grid does **not** disappear under the tab bar.
  - Tap "Tasks": the sheet rises to ~70dvh with the panel inside; tap the backdrop and the close ✕; both dismiss.
  - Tap empty grid space: the create sheet rises from the bottom edge, fully visible, slot label correct; Escape and an outside tap dismiss it; create an event and confirm it lands at the tapped time.
  - Tap a block: the drawer opens. *(Known Phase-4 gap: the drawer is still the 440px desktop panel and will overflow — do not fix it here.)*
  - Swipe the day header left/right: pages one day at a time.
  - Confirm the delete ✕ on blocks/events and the ✎/× on task cards are visible without any hover.
- [ ] **430 × 932.** Two day columns; everything above still holds.
- [ ] **1280 × 900, mouse.** Side-by-side with a pre-Phase-2 build if possible: sidebar + grid + 330px task panel, 7-day-ish window at the same day count as before, legend visible, anchored create popover with the same geometry, hover-only deletes, drag/resize identical.
- [ ] **Set `Settings.dayStartMinute` to 180** and re-check the 1-day view: the single column runs 03:00 → 03:00, the gutter starts at "3a", and a 01:30 "now" keeps the previous date's column marked today.

**Deferred to the user's real Android device (per spec §5 — emulated long-press and drag are not trustworthy):**

- [ ] Long-press ~350ms on a block → it lifts, then follows the finger with 15-min snapping, including across to the neighbouring day when two columns are shown; a short flick on a block still scrolls the hour list.
- [ ] Drag a block near the top/bottom edge → the hours list auto-scrolls and the block keeps tracking the correct time.
- [ ] Drag the resize handle → resizes from the first pixel, no long press needed.
- [ ] Report whether `LONG_PRESS_MS` (350) and `LONG_PRESS_SLOP_PX` (8) feel right; both are exported constants and are the intended tuning knobs. If `touch-pan-y` + the non-passive `touchmove` blocker proves flaky on Android Firefox, the documented fallback is `touch-none` on coarse blocks (the grid then scrolls only between tiles).

---

## Phase-2 coverage check (spec §2 + phase list + ledger)

| Requirement | Where |
| --- | --- |
| `usePointerCoarse()` (spec §1) | Task 1 |
| 1-day view via `daysThatFit`, 2 on larger phones | Task 2 (constants) + Task 4 (`compact` wiring) |
| ~44px gutter, smaller hour labels | Task 2 + Task 3 |
| 44px prev/next targets | Task 3 |
| dayCount-aware popover side | Task 2 (`popoverAlign`) + Task 3 |
| Day-header swipe pages by `dayCount` | Task 9 |
| Long-press arms move; `touch-action: pan-y`; visual lift | Task 5 |
| Resize: 24px hit area, drag-immediate, `touch-action: none` | Task 6 |
| Edge auto-scroll | Task 7 |
| `CreatePopover` → bottom sheet | Task 8 |
| Task panel → bottom sheet, not inline below md | Task 4 |
| Hover-only deletes visible on coarse | Task 8 |
| **Ledger:** hours-scroll height correct in both chromes | Task 3 |
| **Ledger:** "hide panel below md" subsumed by the sheet | Task 4 |
| Planner actually laid out for phones (full-width grid, readable banner, no bleed) | Tasks 3 + 4 |
