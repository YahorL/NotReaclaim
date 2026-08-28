# Mobile Phase 4 — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last gap between "the app works on a phone" and "the app is pleasant on a phone". The headline is the user's own report from real-device testing — *"When I tap on the pane to create the new task, I need to close it somehow if I don't want to schedule anything"* — the compact create form has no backdrop, no ✕, and its `mousedown` outside-dismiss unmounts it before the tap's `click`, which then lands on the day column underneath and re-opens the form at another slot. That gets fixed properly, by making the compact create form a real `Sheet`. Alongside it: the three drawers become full-screen sheets below `md` (TaskDrawer today is a 440px panel whose left edge sits at −62px on a 390px phone, in a z-40 wrapper *under* the z-40 tab bar), NewTaskModal stops assuming a 70px desktop bar and stops clipping its own Duration/Priority/Split row, every outside-dismiss moves to `pointerdown`, a `coarse:` Tailwind variant lifts the worst tap targets, the priorities board flicks column-to-column with scroll snap, and the two dnd-kit surfaces stop reading UUIDs (and stop promising a space bar) to screen readers.

**Architecture:**

- **`Sheet` is the one modal shell, and it is hardened once.** Spec §4 asks for "a shared responsive wrapper" for the drawers; the ledger warns that its a11y gaps would otherwise multiply by four. So Task 1 puts `aria-modal`, Escape, initial focus, focus return, a Tab trap, a 44px close control and `overscroll-contain` **into `Sheet`**, and adds two variant flags (`fullScreen`, `scrollBody`). Everything else in this phase that needs a modal — the create form, all three drawers — reuses it. No second full-screen wrapper component is invented.
- **Sheet invariants that must survive (all three are load-bearing, all three were paid for in Phase 3):**
  1. **`z-50`.** `MobileTabBar` is a `z-40` bottom-anchored bar rendered later in `AppShell`; anything below `z-50` lets taps in the bottom strip fall through to the tabs.
  2. **The `duration-200` collapse transition.** Collapsing instantly moves the sheet inside a drag's first commit and dnd-kit's layout-shift scroll compensation translates the dragged overlay by the same amount.
  3. **`translate-y` only when `collapsed`.** A standing transform makes the sheet the containing block for every `fixed` descendant (commit 92e0c8a M1 removed a permanent `translate-y-0` for exactly this reason, calling it a "latent Phase-4 drawer bug"). Task 1 adds a regression test for it, because Phase 4 is the phase that puts `fixed`-positioned content inside a sheet.
- **Compact-vs-desktop is a JS branch, not a CSS one, wherever behaviour differs.** `md:` utilities are enough for pure layout (the drawers' field grids, the modal's padding, the stat value); but a Sheet brings Escape, a focus trap and a backdrop with it, and those must not exist on desktop. So the pages compute `useCompactWidth()` and choose a host. jsdom has no `matchMedia`, so every existing test stays on the desktop branch untouched — the same lever Phases 1–3 used.
- **`DrawerHost` — one host, two shells.** `components/DrawerHost.tsx` takes the drawer element the caller already built and renders it either inside a `fullScreen` `Sheet` (compact) or inside the caller's existing desktop wrapper (`desktopClass`, a literal string at the call site). The drawer element is built once, never duplicated per branch, and the desktop markup stays byte-identical.
- **Inside a Sheet, the Sheet owns dismissal.** This is the actual root cause of the user's bug, generalised: a component that closes itself on `pointerdown`-outside unmounts *before* the tap's `click`, and that click then hits whatever is underneath — a day column that re-opens the form, or the grid behind a drawer. So `CreatePopover` skips its own outside/Escape handler when `compact`, and the three drawers pass `enabled: false` to `useClickOutside` when `compact`. The Sheet's backdrop dismisses on `click`, which is late enough to be safe.
- **The compact create form is hoisted out of the day column.** It is rendered once at the `WeekGrid` root instead of inside `days.map`. A backdrop rendered *inside* the column would still bubble its dismissing click to the column's click-to-create handler (React events follow the DOM tree), which is the same bug with extra steps. Desktop keeps the in-column anchored popover exactly where it is.
- **Tap targets grow through a `coarse:` variant, never through width.** `@media (pointer: coarse)` keys off the input device, so a 1280px desktop with a mouse is untouched while a touch laptop gets the bigger targets — spec §1's "two orthogonal switches". Two idioms are used: `coarse:p-*` where padding may grow the box, and `relative coarse:before:absolute coarse:before:-inset-3 coarse:before:content-['']` where a fixed `h-*/w-*` visual must not change (an invisible, hit-testable pseudo box). The pseudo idiom is **not** used on adjacent button pairs, where the boxes would overlap and the later sibling would steal the earlier one's taps.
- **Announcements and instructions become pure data.** `src/app/dnd/announcements.ts` exports `makeAnnouncements(nameOfActive, nameOfTarget)` and `POINTER_ONLY_DRAG_INSTRUCTIONS`; the Board and the Planner supply lookups. jsdom cannot run a dnd-kit gesture, so the strings are unit-tested directly and only the (statically rendered) screen-reader instructions are asserted in a component test.

**Tech Stack:** React 18.3.1 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite 5, Tailwind v3.4.13 (literal utility strings only; `_` for spaces inside an arbitrary value's `calc()`), `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2, TanStack Query v5, react-router-dom v6, vitest 1.6 + jsdom 24 + @testing-library/react v16. **No new dependencies in this phase.**

**Spec:** `docs/superpowers/specs/2026-08-25-mobile-adaptation-design.md` — §4 "Drawers, modals, remaining pages" in full, plus the Phase-4 line of the §5 phase list, plus the cross-phase ledger items assigned to Phase 4 by the Phase-3 hand-off.

### Verified before writing (do not re-litigate)

- The Tailwind CLI compiles every arbitrary/variant class this plan uses. Checked against `tailwindcss@3.4.13` with a scratch config: `coarse:h-11`, `coarse:p-3.5`, `coarse:before:-inset-3`, `coarse:before:content-['']`, `w-[min(372px,85vw)]`, `min-h-[calc(100dvh_-_88px)]`, `snap-x`, `snap-mandatory`, `md:snap-none`, `snap-start`, `overscroll-contain`, `h-dvh` all emit. The plugin's variant lands in a `@media (pointer: coarse)` block emitted **before** `@media (min-width: 768px)`, so a `md:` utility beats a `coarse:` one on the same property — this plan never pairs them on one property.
- **`-webkit-tap-highlight-color: transparent` is already applied.** Tailwind v3's preflight sets it on `html, :host` (`node_modules/tailwindcss/src/css/preflight.css:39`), `index.css` includes `@tailwind base`, and the property inherits. Spec §4's base-CSS bullet is therefore **already satisfied**; Task 6 verifies it in the compiled CSS instead of adding a duplicate rule. Only `overscroll-behavior` is genuinely missing.
- `@dnd-kit/core` exports the `Announcements` and `ScreenReaderInstructions` **types** (`core/dist/index.d.ts:2`); `Announcements.onDragCancel` takes `{active, over}`.
- dnd-kit's focus restore calls `findFirstFocusableNode(activatorNode)`, whose selector ends in `*[tabindex]` (`@dnd-kit/utilities/dist/utilities.esm.js:322`) — so a `tabIndex: -1` card **is** the first match and dnd-kit restores focus to the card itself. The comment in `PlannerTaskPanel` that says otherwise is stale (Task 6 corrects it).
- `InteractiveBlock` already has a working `onClick` prop with tap-vs-drag discrimination (`onPointerUp` → `isTap` → `onClick?.()`), and `WeekGrid` simply never passes one for task blocks. Task 6's tap-to-open needs no gesture changes.

## Global Constraints

- Web suite **baseline: 653 tests / 72 files green** (`npm test -w @notreclaim/web`, verified 2026-08-27 on `main` at `92e0c8a`). It must be green after **every** task; the expected count is stated per task. Final expected: **718 tests / 76 files**. Per-task arithmetic: 653 → **664** (T1, +11) → **667** (T2, +3) → **679** (T3, +12) → **682** (T4, +3) → **686** (T5, +4) → **700** (T6, +14) → **712** (T7, +12) → 712 (T8, no test changes) → **718** (final fix wave, +6). *(T1 budgeted +9, landed +11: two controller-ruled fixes during T1 each added a test — focus return to the opener when a field inside the sheet autoFocuses, and Escape being ignored when a modal is stacked above the sheet. T6 budgeted +13, landed +14: a review-ruled fix to the coarse checklist halo needed a second lever — `coarse:space-y-2` on the `ul` to open the row pitch — and that pitch is half the no-overlap invariant, so it got its own assertion rather than riding on the label's. T7 budgeted +9, landed +12: review found the board's announcement named every card by its containing column, so a within-column keyboard reorder repeated one string — and dnd-kit's aria-atomic, `useState`-backed live region never speaks an unchanged string. The fix extracted `boardDropTargetName` into `boardDnd.ts` and pinned its card / container / unknown-id branches with three pure tests. Every downstream figure carries these deltas; no other task's own delta changed. The **final fix wave** adds +6: the C1 regression fix extracts `priorities/boardPane.ts` and pins its idle/dragging/invariant branches with 3 pure tests, `UnscheduledWarning` gets 2 for the now-tappable `+N more`, and `NewTaskModal` 1 for the stacked Min/Max row. It also *moves* three tests between describes in `WeekGrid.test.tsx` and renames one in `Planner.test.tsx` — neither changes the count.)* New test files: `components/useClickOutside.test.tsx` (T3), `components/DurationStepper.test.tsx` (T6), `dnd/announcements.test.ts` (T7), `priorities/boardPane.test.ts` (final fix wave). If a step legitimately needs one more or one fewer test than budgeted, **edit this ledger line in the same commit** rather than letting the arithmetic drift.
- Tests run under `TZ=UTC` via the package `test` script — never bypass it.
- **Desktop at `md+` with a fine pointer is behaviour- and pixel-identical.** Every compact behaviour is behind `useCompactWidth()` (false in jsdom, false at ≥768px) or a `md:` utility that restores today's value; every touch affordance is behind the `coarse:` variant, which a mouse never matches. A touch laptop at `md+` *does* get bigger tap targets — that is spec §1's deliberate input/width split, not a desktop regression.
- **This phase edits pre-existing tests.** Every such edit is listed explicitly, by file and by test name, in the step that makes it; no task may rewrite a test that is not named in its own step list. **Nothing is deleted.** The complete ledger:

  | file | rewritten in place | added | task |
  | --- | --- | --- | --- |
  | `app/planner/CreatePopover.test.tsx` | 1 | 1 (T2) + 1 (T5) | 2, 5 |
  | `app/planner/WeekGrid.test.tsx` | 1 | 2 (T2) + 3 (T6) | 2, 6 |
  | `app/pages/Planner.test.tsx` | 1 | 2 (T3) + 1 (T7) | 3, 7 |
  | `app/tasks/TaskDrawer.test.tsx` | 2 (one in T3, one in T5) | 2 (T3) + 1 (T6) | 3, 5, 6 |
  | `app/planner/EventDrawer.test.tsx` | 1 | 1 | 3, 5 |
  | `app/priorities/boardDnd.test.ts` | 0 | 3 (T7) | 7 |
  | **total (baseline files)** | **6** | — | |

  Plus three tests **created by this plan** in Task 3 (`useClickOutside.test.tsx`) and rewritten in Task 5 when the listener moves to `pointerdown`. No test's assertion is dropped without an equivalent replacement named in the same step.
- **`Sheet`'s `heightClass` prop is removed** (Task 1) and replaced by `fullScreen`. It has exactly one consumer today — `Planner`'s Tasks sheet, which uses the default — so no call site changes and `Sheet.test.tsx`'s existing `h-[70dvh]` assertion still holds. Do not reintroduce a free-form height prop; two height mechanisms is how this ends up with four sheet variants.
- Tailwind v3 **literal utility class strings only** — never compute a class name. The `coarse:` variant keeps this true: `coarse:h-11` is a literal that the JIT scanner sees. Conditionals pick between whole literal strings (composing a shared literal base with a literal variant suffix is fine — every token appears verbatim in the source).
- `packages/web` imports are **extensionless** and never `import React` (automatic JSX runtime; named hook/type imports are fine).
- jsdom evaluates **no CSS and no media queries**, and `getBoundingClientRect` returns zeros. Assert class presence/absence, attributes, roles and testids; never assert "is not visible", never rely on measured geometry. Tests that need the mobile path install `installMatchMedia({'(max-width: 767.98px)': true})` from `src/test/matchMedia.ts` and **must** `restore()` in `afterEach`.
- **No synthetic dnd-kit gestures.** dnd-kit needs real rects and a real measuring cycle; drag decisions stay in pure modules (Phase 2/3 pattern, unchanged).
- TypeScript is strict with `noUncheckedIndexedAccess`: index accesses need `!` or a guard. Test files are type-checked by `npm run build -w @notreclaim/web`.
- Never run branch-switching or history-rewriting git commands (`checkout`/`switch`/`restore`/`reset`/`stash`). `git add <explicit paths>` only — the working tree carries untracked local-only files (`seed-dev.mjs`, `review/`, `*.tsbuildinfo`) that must never be committed.
- Every commit message ends with the trailer line `Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828`.
- **Task order is load-bearing in two places.** Task 1 (`Sheet` hardening) must land before Task 2 and Task 3, which consume `fullScreen`/`scrollBody`/Escape. Task 3 must land before Task 5: Task 3 introduces `useClickOutside`'s `enabled` flag *and* its first test file while the listener is still `mousedown`; Task 5 then flips the listener and rewrites those three tests. Flipping first would leave the drawers double-dismissing on touch for one commit — the exact bug this phase exists to kill.
- **Out of scope for this phase (do not touch):** dnd-kit sensor/collision/`onDragEnd` behaviour (only the accessibility strings change); `InteractiveBlock`'s gesture model, its long-press constants and its 16px delete ✕ (ledgered as a follow-up, deliberately not resized here — see Task 6's note); any server/API work (there is still no `GET /auth/me`); PWA manifest/service worker; the planner legend's off-`gridWidth` sizing; a `SortableListRow` dedup refactor between `TaskRow` and `TaskDrawer`.

---

## Task 1 — Harden `Sheet` into the app's one modal shell

**Files:**
- Modify: `packages/web/src/app/components/Sheet.tsx`
- Modify (test): `packages/web/src/app/components/Sheet.test.tsx` (additions only — the four existing tests are untouched)

**Interfaces:**
- `SheetProps` becomes `{ label: string; onClose: () => void; children: ReactNode; fullScreen?: boolean; scrollBody?: boolean; collapsed?: boolean }`. **`heightClass` is removed** (unused at every call site; `fullScreen` replaces it).
- Behaviour added: `aria-modal="true"`, `tabIndex={-1}` on the dialog, Escape-to-close (document listener), initial focus on the dialog *unless* focus is already inside it, focus return to the previously focused element on unmount, Tab/Shift+Tab cycling inside the sheet, `overscroll-contain` on the body, a 44px close control.
- Consumers: `Planner`'s Tasks sheet (unchanged call), plus Tasks 2 and 3.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/components/Sheet.test.tsx` (keep the existing two `describe` blocks exactly as they are):

```tsx
describe('Sheet a11y', () => {
  it('is a modal dialog that takes focus on mount', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(sheet);
  });

  it('does not steal focus from an autoFocus field inside it', () => {
    // React applies autoFocus during the commit phase, before this component's passive effect —
    // so the create form's title input must keep the focus it just took.
    render(<Sheet label="New entry" onClose={vi.fn()}><input autoFocus data-testid="inner-field" /></Sheet>);
    expect(document.activeElement).toBe(screen.getByTestId('inner-field'));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Sheet label="Tasks" onClose={onClose}><p>body</p></Sheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to whatever opened it when it unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the sheet in both directions', () => {
    render(
      <Sheet label="Tasks" onClose={vi.fn()}>
        <button>first</button>
        <button>last</button>
      </Sheet>,
    );
    const close = screen.getByTestId('sheet-close'); // first focusable in DOM order
    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('gives the close control a 44px touch target', () => {
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const close = screen.getByTestId('sheet-close');
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');
  });
});

describe('Sheet variants', () => {
  it('fullScreen fills the viewport with square top corners', () => {
    render(<Sheet label="Edit task" onClose={vi.fn()} fullScreen><p>body</p></Sheet>);
    const sheet = screen.getByTestId('sheet');
    expect(sheet.className).toContain('h-dvh');
    expect(sheet.className).not.toContain('h-[70dvh]');
    expect(sheet.className).not.toContain('rounded-t-[18px]');
  });

  it('scrolls its body only when asked to', () => {
    const { unmount } = render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    const plain = screen.getByText('body').parentElement!;
    expect(plain.className).toContain('overflow-hidden');
    expect(plain.className).toContain('overscroll-contain');
    unmount();
    render(<Sheet label="New entry" onClose={vi.fn()} scrollBody><p>body</p></Sheet>);
    const scrolling = screen.getByText('body').parentElement!;
    expect(scrolling.className).toContain('overflow-y-auto');
    expect(scrolling.className).toContain('overscroll-contain');
  });

  it('carries no transform unless it is collapsed', () => {
    // A standing transform makes the sheet the containing block for every `fixed` descendant —
    // and from this phase on, sheets contain drawers. Regression guard for 92e0c8a M1.
    render(<Sheet label="Tasks" onClose={vi.fn()}><p>body</p></Sheet>);
    expect(screen.getByTestId('sheet').className).not.toContain('translate-y');
  });
});
```

- [ ] Run the file and confirm the failure is the expected one:

```sh
npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx
```

  Expected: the four original tests pass; the nine new ones fail — `aria-modal` missing, focus stays on `document.body`, Escape does nothing, `h-11` absent, `h-dvh` absent, body has no `overscroll-contain`. (`carries no transform` may already pass — it is a guard, not a red test.)

- [ ] Replace `packages/web/src/app/components/Sheet.tsx` with:

```tsx
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';

/**
 * Everything a browser will Tab to inside the sheet. `[tabindex="-1"]` is excluded on purpose:
 * the sheet container itself — and dnd-kit's task cards — are focusable programmatically but are
 * not tab stops, so they must never be the wrap target.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Everything the two variants share. Split out only so each variant stays one literal string. */
const FRAME =
  'pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-pop transition-transform duration-200';

export interface SheetProps {
  /** Accessible name; also used for the close button's label. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Full-viewport variant for drawers: `h-dvh` with square top corners. Default: the 70dvh sheet. */
  fullScreen?: boolean;
  /** Scroll the sheet body. Off by default — PlannerTaskPanel owns its own inner scroll region. */
  scrollBody?: boolean;
  /**
   * Slide the sheet down to a strip and make the backdrop inert, for the duration of a drag that
   * started inside it. The children stay mounted on purpose: unmounting the dragged card would
   * remove dnd-kit's active draggable node and abort the gesture.
   *
   * The `duration-200` transition on that slide is load-bearing, not decoration: collapsing
   * instantly would move the sheet within the drag's very first commit, and dnd-kit's
   * layout-shift scroll compensation would read that as the page scrolling under the pointer and
   * translate the dragged overlay by the same amount.
   */
  collapsed?: boolean;
}

/**
 * The app's one modal shell for phones: full-width, anchored to the bottom edge, drag-handle
 * header with a ✕, backdrop tap dismisses, Escape dismisses, focus is taken on mount, trapped
 * while open and returned on unmount.
 *
 * Sits on the modal tier (`z-50`, same as NewTaskModal) — MobileTabBar is a z-40 bar pinned to the
 * same bottom edge and rendered later in AppShell, so anything below z-50 would let taps in the
 * bottom strip fall through to the tabs.
 *
 * It carries **no transform unless `collapsed`**: a standing transform would make the sheet the
 * containing block for every `fixed` descendant, and sheets now contain drawers.
 *
 * Only rendered on the compact layout — desktop surfaces keep their inline panels and wrappers.
 */
export function Sheet({ label, onClose, children, fullScreen = false, scrollBody = false, collapsed = false }: SheetProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Initial focus + focus return, once per mount. The containment check keeps an `autoFocus`ed
  // field inside the sheet: React applies autoFocus in the commit phase, before this passive
  // effect runs, so stealing it back would fight the create form for the caret.
  useEffect(() => {
    const el = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => { previous?.focus(); };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const el = dialogRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const frameClass = fullScreen ? `${FRAME} h-dvh` : `${FRAME} h-[70dvh] rounded-t-[18px]`;
  const bodyClass = scrollBody
    ? 'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2'
    : 'flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain px-2 pb-2';

  return (
    <div
      data-testid="sheet-backdrop"
      onClick={collapsed ? undefined : onClose}
      className={collapsed ? 'pointer-events-none fixed inset-0 z-50' : 'fixed inset-0 z-50 bg-black/30'}
    >
      <div
        ref={dialogRef}
        data-testid="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`${frameClass} ${collapsed ? 'translate-y-[calc(100%_-_56px)]' : ''}`}
      >
        <div className="flex shrink-0 items-center justify-between px-3 pt-2">
          <span className="w-11" />
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
          <button
            type="button"
            data-testid="sheet-close"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[9px] text-inkSoft"
          >
            ✕
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
```

- [ ] Run the file again and the whole suite:

```sh
npm test -w @notreclaim/web -- src/app/components/Sheet.test.tsx
npm test -w @notreclaim/web
```

  Expected: `Sheet.test.tsx` 17 tests pass; suite **664 tests / 72 files**. (15/662 as first written; the controller-ruled render-phase focus-capture fix added the sixteenth, and the Escape-ownership fix the seventeenth.)

- [ ] Type-check (the `heightClass` removal must not orphan a call site):

```sh
npm run build -w @notreclaim/web
```

  Expected: clean. If `Planner.tsx` errors, a `heightClass` prop slipped in somewhere — remove it, do not re-add the prop.

- [ ] Commit:

```sh
git add packages/web/src/app/components/Sheet.tsx packages/web/src/app/components/Sheet.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): harden Sheet into the app's one modal shell

aria-modal, Escape, initial focus (yielding to an autoFocus'd field inside),
focus return on unmount, a Tab trap, overscroll-contain on the body and a 44px
close control -- fixed once here because Phase 4 gives Sheet four more callers.

heightClass (one consumer, always the default) is replaced by two intent flags:
fullScreen for the drawer variant and scrollBody for forms that must scroll.

Adds a regression guard for the no-standing-transform invariant: a transform
would make the sheet the containing block for every fixed descendant, and from
here on sheets contain drawers.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 2 — The create form becomes a dismissible sheet (the user's report)

**Files:**
- Modify: `packages/web/src/app/planner/CreatePopover.tsx`
- Modify: `packages/web/src/app/planner/WeekGrid.tsx`
- Modify (test): `packages/web/src/app/planner/CreatePopover.test.tsx` (1 rewritten, 1 added)
- Modify (test): `packages/web/src/app/planner/WeekGrid.test.tsx` (1 rewritten, 2 added)

**Interfaces:**
- `CreatePopover`'s `compact` prop changes meaning: *"render as plain form content — the host `Sheet` owns the chrome, the backdrop, Escape and dismissal."* Props and payloads are otherwise unchanged.
- `WeekGrid` renders the compact create form **once at its root**, wrapped in `<Sheet label="New entry" scrollBody>`, instead of inside `days.map`.

**Steps:**

- [ ] Rewrite one test and add one in `packages/web/src/app/planner/CreatePopover.test.tsx`. Replace the body of **`'compact pins the form to the viewport bottom with no anchored geometry'`** (keep the file's other 25 tests untouched, including `'compact ignores the anchored align rule'`, which still passes verbatim):

```tsx
  it('compact renders plain content — the Sheet owns the chrome', () => {
    renderWithProviders(<CreatePopover {...baseProps} compact />, { api: fakeApiClient() });
    const popover = screen.getByTestId('create-popover');
    // No self-positioning: a form that positions itself cannot be dismissed by a backdrop it
    // does not have. The host Sheet supplies fixed/bottom-0/z-50/backdrop/✕/Escape.
    expect(popover.className).not.toContain('fixed');
    expect(popover.className).not.toContain('absolute');
    expect(popover.className).not.toContain('bottom-0');
    expect(popover.className).not.toContain('w-[340px]');
    expect(popover.style.top).toBe('');
  });

  it('compact installs no outside-dismiss of its own', () => {
    // The bug the user hit: a pointerdown-outside close unmounts the form BEFORE the tap's
    // click, and that click then lands on the day column and re-opens the form at a new slot.
    const onClose = vi.fn();
    renderWithProviders(<CreatePopover {...baseProps} compact onClose={onClose} />, { api: fakeApiClient() });
    fireEvent.mouseDown(document.body);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
```

- [ ] Rewrite one test and add two in `packages/web/src/app/planner/WeekGrid.test.tsx`. Replace the body of **`'opens the create form as a bottom sheet in a one-day window'`** and append the two new ones inside the same `describe('WeekGrid compact (below md)')` block:

```tsx
  it('opens the create form inside a dismissible sheet, hoisted out of the day column', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    const dialog = screen.getByRole('dialog', { name: 'New entry' });
    expect(within(dialog).getByTestId('create-popover')).toBeInTheDocument();
    // Hoisted: a backdrop rendered inside the column would bubble its dismissing click straight
    // back into the column's click-to-create handler.
    expect(within(screen.getByTestId('day-col-0')).queryByTestId('create-popover')).toBeNull();
  });

  it('a backdrop tap dismisses the create sheet without re-opening it at another slot', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('create-popover')).toBeNull();
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
  });

  it('the create sheet closes on its ✕ and on Escape', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(screen.queryByTestId('create-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('create-popover')).toBeNull();
  });
```

- [ ] Run both files and confirm the expected failures:

```sh
npm test -w @notreclaim/web -- src/app/planner/CreatePopover.test.tsx src/app/planner/WeekGrid.test.tsx
```

  Expected failures: the compact form still carries `fixed`/`bottom-0`; it still closes itself on `mousedown`/Escape; there is no `role="dialog"` named "New entry"; the popover is still found inside `day-col-0`.

- [ ] In `packages/web/src/app/planner/CreatePopover.tsx`, gate the self-dismiss on `!compact` — replace the existing `useEffect` that registers `keydown`/`mousedown`:

```tsx
  useEffect(() => {
    // Inside the compact sheet the Sheet owns dismissal (backdrop tap, ✕, Escape). A second
    // outside-dismiss here would fire on POINTERDOWN and unmount the form before the tap's
    // click — which would then land on the day column underneath and re-open the form at
    // another slot. That is exactly the "I can't close it" report this sheet fixes.
    if (compact) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose, compact]);
```

- [ ] In the same file, replace the root element's `className`/comment so the compact branch is chrome-free:

```tsx
    // Compact: plain content inside a `Sheet` — the sheet supplies the backdrop, the ✕, Escape,
    // the z-50 tier and the scroll. Desktop keeps the column-anchored popover byte-for-byte.
    <div
      ref={ref}
      data-testid="create-popover"
      onClick={(e) => e.stopPropagation()}
      className={compact
        ? 'p-2'
        : `absolute z-40 w-[340px] animate-pop rounded-[14px] border border-line bg-card p-4 shadow-pop ${align === 'left' ? 'left-1' : 'right-1'}`}
      style={compact ? undefined : { top: `${Math.min(topPct, 78)}%` }}
    >
```

- [ ] In `packages/web/src/app/planner/WeekGrid.tsx`, import the sheet:

```tsx
import { Sheet } from '../components/Sheet';
```

- [ ] In the same file, restrict the in-column popover to the desktop path — change the render inside `days.map` to:

```tsx
                  {creating?.dayIndex === i && !compact && (
                    <CreatePopover
                      dayStartMs={d}
                      startMin={creating.startMin}
                      topPct={((creating.startMin - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100}
                      onClose={() => setCreating(null)}
                      align={popoverAlign(i, days.length)}
                      zone={zone}
                    />
                  )}
```

- [ ] In the same file, render the compact sheet **once, at the root** — insert it immediately before the final `</div>` of the component's outer `<div className="flex min-h-0 flex-1 flex-col">`, after the grid card block:

```tsx
      {/* Compact: the create form is a viewport sheet, hoisted OUT of the day column on purpose.
          React events follow the DOM tree, so a backdrop rendered inside the column would bubble
          its dismissing click into the column's click-to-create handler and re-open the form at
          another slot — the "I can't close it" report. `days[dayIndex]` is re-read here because
          a resize can shrink `days` while the form is open. */}
      {compact && creating && creatingDayMs !== undefined && (
        <Sheet label="New entry" onClose={() => setCreating(null)} scrollBody>
          <CreatePopover
            dayStartMs={creatingDayMs}
            startMin={creating.startMin}
            topPct={0}
            onClose={() => setCreating(null)}
            zone={zone}
            compact
          />
        </Sheet>
      )}
```

  and add the lookup next to the `creating` state declaration:

```tsx
  const [creating, setCreating] = useState<{ dayIndex: number; startMin: number } | null>(null);
  // `topPct` is ignored on the compact path (the sheet is viewport-anchored); the day anchor is
  // not — it is what the created entry's timestamps are built from.
  const creatingDayMs = creating ? days[creating.dayIndex] : undefined;
```

- [ ] Run both files, then the suite:

```sh
npm test -w @notreclaim/web -- src/app/planner/CreatePopover.test.tsx src/app/planner/WeekGrid.test.tsx
npm test -w @notreclaim/web
```

  Expected: suite **667 tests / 72 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/CreatePopover.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): make the compact create form dismissible

Reported from a real phone: tapping the grid opened a create form with no
backdrop and no close control, and its mousedown outside-dismiss unmounted it
before the tap's click -- which then hit the day column and re-opened the form
at another slot.

The compact form is now plain content inside a Sheet, hoisted out of the day
column (a backdrop rendered inside it would bubble its own dismissing click
into the column's click-to-create handler) and it installs no outside-dismiss
of its own: inside a sheet, the sheet owns dismissal.

Desktop keeps the column-anchored popover byte-for-byte.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 3 — Drawers become full-screen sheets below `md`

**Files:**
- Modify: `packages/web/src/app/components/useClickOutside.ts`
- Create (test): `packages/web/src/app/components/useClickOutside.test.tsx` (3 tests)
- Create: `packages/web/src/app/components/DrawerHost.tsx`
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx`, `packages/web/src/app/planner/EventDrawer.tsx`, `packages/web/src/app/habits/HabitDrawer.tsx`
- Modify: `packages/web/src/app/pages/Planner.tsx`, `packages/web/src/app/pages/Priorities.tsx`, `packages/web/src/app/pages/Habits.tsx`
- Modify (test): `TaskDrawer.test.tsx` (1 rewritten + 2 added), `EventDrawer.test.tsx` (+1), `HabitDrawer.test.tsx` (+1), `Planner.test.tsx` (1 rewritten + 2 added), `Priorities.test.tsx` (+1), `Habits.test.tsx` (+2)

**Interfaces:**
- `useClickOutside(ref, onOutside, enabled = true)` — a third parameter; `false` unsubscribes entirely.
- `DrawerHost({ compact, label, onClose, desktopClass, children })` — compact renders `<Sheet fullScreen scrollBody>`, desktop renders `<div className={desktopClass}>`.
- `TaskDrawer` / `EventDrawer` / `HabitDrawer` each gain `compact?: boolean` (default `false`): drops the fixed 440px panel chrome and the self-dismiss; the field grids go one-column below `md` via plain `md:` utilities.
- Every drawer wrapper moves from `z-40` to `z-50` (they sat *under* the z-40 tab bar), including `Habits`' `fixed inset-0` overlay.

**Steps:**

- [ ] Create `packages/web/src/app/components/useClickOutside.test.tsx` (still `mousedown` — Task 5 flips it):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useClickOutside } from './useClickOutside';

function Probe({ onOutside, enabled }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside, enabled);
  return (
    <div>
      <div ref={ref} data-testid="inside">inside</div>
      <button data-testid="outside">outside</button>
    </div>
  );
}

describe('useClickOutside', () => {
  it('fires when the press lands outside the ref', () => {
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} />);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the press lands inside the ref', () => {
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} />);
    fireEvent.mouseDown(screen.getByTestId('inside'));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('subscribes to nothing when disabled', () => {
    // Inside a Sheet the sheet owns dismissal: a second outside-dismiss here would close on the
    // press and hand the following click to whatever sits under the backdrop.
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} enabled={false} />);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
```

- [ ] Run it and confirm only the third test fails (`enabled` is not a parameter yet, so it is ignored):

```sh
npm test -w @notreclaim/web -- src/app/components/useClickOutside.test.tsx
```

- [ ] Add the flag in `packages/web/src/app/components/useClickOutside.ts`:

```ts
export function useClickOutside<T extends HTMLElement>(ref: RefObject<T>, onOutside: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handle(e: MouseEvent) {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, onOutside, enabled]);
}
```

- [ ] Add the drawer tests. In `packages/web/src/app/tasks/TaskDrawer.test.tsx`, **rewrite** `'field grid has grid grid-cols-2 class'` (its `.grid.grid-cols-2` selector cannot see a responsive class) and append two tests to the same `describe('TaskDrawer layout')`:

```tsx
  it('field grid is one column on a phone and two at md+', () => {
    renderWithProviders(<TaskDrawer task={task()} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const grid = screen.getByTestId('task-drawer').querySelector('.grid') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.classList.contains('grid-cols-1')).toBe(true);      // 165px columns cannot hold a datetime input
    expect(grid.classList.contains('md:grid-cols-2')).toBe(true);   // desktop two-column layout, unchanged
  });

  it('compact drops the fixed 440px panel chrome', () => {
    renderWithProviders(<TaskDrawer task={task()} compact onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    const drawer = screen.getByTestId('task-drawer');
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).not.toContain('w-[440px]');
    // The host Sheet scrolls; a second scroll box here would trap the page inside the drawer.
    expect(drawer.className).not.toContain('overflow-y-auto');
  });

  it('compact installs no outside-dismiss of its own', () => {
    const onCancel = vi.fn();
    renderWithProviders(<TaskDrawer task={task()} compact onSave={vi.fn()} onCancel={onCancel} />, { api: emptyCategories() });
    fireEvent.mouseDown(document.body);
    expect(onCancel).not.toHaveBeenCalled();
  });
```

- [ ] Append to `packages/web/src/app/planner/EventDrawer.test.tsx` (reusing the file's `appEvent()` fixture and `api()` helper — do not add new ones):

```tsx
  it('compact drops the fixed 440px panel chrome and its own outside-dismiss', () => {
    const onClose = vi.fn();
    renderWithProviders(<EventDrawer event={appEvent()} compact onClose={onClose} />, { api: api() });
    const drawer = screen.getByTestId('event-drawer');
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).not.toContain('w-[440px]');
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
```

- [ ] Append to `packages/web/src/app/habits/HabitDrawer.test.tsx`:

```tsx
  it('compact drops the fixed 440px panel chrome and its own outside-dismiss', () => {
    const onCancel = vi.fn();
    render(<HabitDrawer habit={habit()} compact onSave={vi.fn()} onCancel={onCancel} />);
    const drawer = screen.getByTestId('habit-drawer');
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).not.toContain('w-[440px]');
    fireEvent.mouseDown(document.body);
    expect(onCancel).not.toHaveBeenCalled();
  });
```

- [ ] In `packages/web/src/app/pages/Planner.test.tsx`, **rewrite** `'editing from the sheet closes the sheet and opens the task drawer'` (its `sheet-backdrop` assertion is now ambiguous — the drawer has a backdrop of its own) and append two tests to `describe('Planner compact layout')`:

  First hoist the fixture that the rewritten test used to declare inline, to the top of
  `describe('Planner compact layout')`, so all three tests share it:

```tsx
  const compactTask = {
    id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
    durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
    categoryId: null, notBefore: null, status: 'pending', completedAt: null, timeLoggedMs: 0,
    createdAt: '', updatedAt: '', subtasks: [],
  } as unknown as Task;
```

```tsx
  it('editing from the sheet closes the Tasks sheet and opens the drawer as its own sheet', async () => {
    // Two stacked modal sheets would trap focus in the wrong one, so the hand-over closes the
    // Tasks sheet. Both are z-50 now; the drawer no longer paints behind the tab bar.
    const api = makeApi({ listTasks: vi.fn(async () => [compactTask]) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-sheet-toggle'));
    await waitFor(() => expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Write spec' }));
    expect(screen.queryByRole('dialog', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByTestId('planner-task-panel')).toBeNull();
    const drawerSheet = screen.getByRole('dialog', { name: 'Edit task' });
    expect(within(drawerSheet).getByTestId('task-drawer')).toBeInTheDocument();
    expect(drawerSheet.className).toContain('h-dvh');
  });

  it('the task drawer sheet closes on a backdrop tap', async () => {
    const api = makeApi({ listTasks: vi.fn(async () => [compactTask]) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('panel-sheet-toggle'));
    await waitFor(() => expect(screen.getByTestId('planner-task-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Write spec' }));
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('task-drawer')).toBeNull();
  });

  it('the event drawer opens as a full-screen sheet on the compact layout', async () => {
    const appEvent: CalendarEvent = {
      id: 'e9', userId: 'u1', title: 'Coffee',
      startsAt: '2026-01-07T15:00:00.000Z', endsAt: '2026-01-07T15:30:00.000Z',
      googleCalendarId: null, googleEventId: null, source: 'app',
    };
    const api = makeApi({ getCalendarEvents: vi.fn(async () => [appEvent]) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Coffee'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    const sheet = screen.getByRole('dialog', { name: 'Edit event' });
    expect(within(sheet).getByTestId('event-drawer')).toBeInTheDocument();
  });
```

  (Import `within` from `@testing-library/react` if the file does not already.)

- [ ] Append to `packages/web/src/app/pages/Priorities.test.tsx` a compact describe block (new imports: `installMatchMedia`, `type FakeMatchMedia`, `within`):

```tsx
describe('Priorities compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('opens the edit drawer as a full-screen sheet', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Critical thing'));
    const sheet = screen.getByRole('dialog', { name: 'Edit task' });
    expect(sheet.className).toContain('h-dvh');
    expect(within(sheet).getByTestId('task-drawer')).toBeInTheDocument();
  });
});
```

- [ ] Append to `packages/web/src/app/pages/Habits.test.tsx`:

```tsx
  it('paints the edit overlay on the modal tier, above the tab bar', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // MobileTabBar is a fixed z-40 bar: a z-40 overlay lets its taps through to the tabs.
    expect(screen.getByTestId('habit-drawer').parentElement!.className).toContain('z-50');
  });
});

describe('Habits page compact layout', () => {
  let mm: FakeMatchMedia | null = null;
  beforeEach(() => { mm = installMatchMedia({ '(max-width: 767.98px)': true }); });
  afterEach(() => { mm?.restore(); mm = null; });

  it('opens the habit drawer as a full-screen sheet', async () => {
    renderWithProviders(<Habits />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit habit' });
    expect(sheet.className).toContain('h-dvh');
    expect(within(sheet).getByTestId('habit-drawer')).toBeInTheDocument();
  });
});
```

  (`HabitRow` renders a plain `<button>Edit</button>` with no aria-label — `{ name: 'Edit' }` is its accessible name. New imports for this file: `within`, `installMatchMedia`, `type FakeMatchMedia`, `beforeEach`, `afterEach`.)

- [ ] Run the six test files and confirm the expected failures (no `Edit task`/`Edit event`/`Edit habit` dialogs, `compact` is not a prop yet, `z-40` on the Habits overlay):

```sh
npm test -w @notreclaim/web -- src/app/tasks/TaskDrawer.test.tsx src/app/planner/EventDrawer.test.tsx src/app/habits/HabitDrawer.test.tsx src/app/pages/Planner.test.tsx src/app/pages/Priorities.test.tsx src/app/pages/Habits.test.tsx
```

- [ ] Create `packages/web/src/app/components/DrawerHost.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Sheet } from './Sheet';

export interface DrawerHostProps {
  /** Below md: host the drawer in a full-screen Sheet instead of the desktop panel slot. */
  compact: boolean;
  /** Accessible name for the compact sheet, e.g. "Edit task". */
  label: string;
  onClose: () => void;
  /** Literal Tailwind class string for the desktop host element (JIT-visible at the call site). */
  desktopClass: string;
  children: ReactNode;
}

/**
 * One host, two shells. At md+ the drawer keeps the exact wrapper it has always had; below md it
 * becomes a full-screen Sheet, which brings the backdrop, the ✕, Escape, the focus trap and the
 * modal z-tier with it. The drawer element itself is built once by the caller and handed to
 * whichever shell renders it — never duplicated per branch.
 */
export function DrawerHost({ compact, label, onClose, desktopClass, children }: DrawerHostProps): ReactElement {
  if (compact) {
    return <Sheet label={label} onClose={onClose} fullScreen scrollBody>{children}</Sheet>;
  }
  return <div className={desktopClass}>{children}</div>;
}
```

- [ ] In `packages/web/src/app/tasks/TaskDrawer.tsx`: add `compact?: boolean` to `TaskDrawerProps`, destructure it with `compact = false`, pass `!compact` to the hook, and swap the two class strings.

```tsx
  useClickOutside(rootRef, onCancel, !compact);
```

```tsx
    <aside
      ref={rootRef}
      data-testid="task-drawer"
      className={compact
        ? 'w-full space-y-2.5 p-2'
        : 'w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto'}
    >
```

  and make the field grid responsive (plain CSS — the drawer only ever renders at phone widths inside the sheet, and `md:` restores today's desktop exactly):

```tsx
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
```

  with the title field's wrapper changed from `col-span-2` to `col-span-1 md:col-span-2`. **`col-span-2` inside `grid-cols-1` would create an implicit second column** — every `col-span-2` in a drawer must get the same treatment.

- [ ] In `packages/web/src/app/planner/EventDrawer.tsx`: add `compact?: boolean` to `EventDrawerProps`, destructure it with `compact = false`, and:

```tsx
  useClickOutside(rootRef, onClose, !compact);
```

```tsx
    <aside
      ref={rootRef}
      data-testid="event-drawer"
      className={compact
        ? 'w-full space-y-2.5 p-2'
        : 'w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto'}
    >
```

```tsx
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
```

  …with its Title wrapper's `col-span-2` → `col-span-1 md:col-span-2`.

- [ ] In `packages/web/src/app/habits/HabitDrawer.tsx`: the same three changes —

```tsx
  useClickOutside(rootRef, onCancel, !compact);
```

```tsx
    <aside
      ref={rootRef}
      data-testid="habit-drawer"
      className={compact
        ? 'w-full space-y-2.5 p-2'
        : 'w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto'}
    >
```

```tsx
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
```

  …and **three** `col-span-2` users here, not one: the Title wrapper, the Eligible-days wrapper, and the `preferredEnd` error paragraph's `` className={`col-span-2 ${errCls}`} `` → `` className={`col-span-1 md:col-span-2 ${errCls}`} ``.

- [ ] Wire `packages/web/src/app/pages/Planner.tsx`: import `DrawerHost`, replace both drawer wrappers, and correct the now-stale z-tier comment on `panelProps.onEdit`:

```tsx
      {editing && (
        <DrawerHost compact={compact} label="Edit task" onClose={() => setEditingId(null)} desktopClass="fixed right-3 top-[84px] z-50">
          <TaskDrawer
            task={editing} compact={compact} saving={updateTask.isPending}
            error={updateTask.error instanceof ApiError ? updateTask.error : null}
            onSave={(patch) => updateTask.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </DrawerHost>
      )}
      {editingEvent && (
        <DrawerHost compact={compact} label="Edit event" onClose={() => setEditingEventId(null)} desktopClass="fixed right-3 top-[84px] z-50">
          {/* Key on the event's times: a background refetch (or a drag) that moves the event
              remounts the drawer so its fields re-seed instead of holding stale values. */}
          <EventDrawer
            key={`${editingEvent.id}:${editingEvent.startsAt}:${editingEvent.endsAt}`}
            event={editingEvent} compact={compact} zone={zone} onClose={() => setEditingEventId(null)}
          />
        </DrawerHost>
      )}
```

```tsx
    // Compact: the Tasks sheet and the drawer are both z-50 modal sheets, and two stacked sheets
    // would trap focus in the wrong one — close the sheet as we hand over.
    onEdit: (t: Task) => { if (compact) setTaskSheetOpen(false); openTaskDrawer(t.id); },
```

- [ ] Wire `packages/web/src/app/pages/Priorities.tsx`: add `import { useCompactWidth } from '../lib/useMediaQuery';` and `import { DrawerHost } from '../components/DrawerHost';`, add `const compact = useCompactWidth();` beside the other hooks, and replace the drawer wrapper:

```tsx
      {editing && (
        <DrawerHost compact={compact} label="Edit task" onClose={() => setEditingId(null)} desktopClass="fixed right-3 top-[84px] z-50">
          <TaskDrawer
            task={editing} compact={compact} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </DrawerHost>
      )}
```

- [ ] Wire `packages/web/src/app/pages/Habits.tsx` the same way, with its own desktop host:

```tsx
      {editing && (
        <DrawerHost
          compact={compact}
          label="Edit habit"
          onClose={() => setEditing(null)}
          desktopClass="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
        >
          <HabitDrawer habit={editing} compact={compact} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
            onCancel={() => setEditing(null)} />
        </DrawerHost>
      )}
```

- [ ] Run the suite and the type-check:

```sh
npm test -w @notreclaim/web
npm run build -w @notreclaim/web
```

  Expected: **679 tests / 73 files**, build clean.

- [ ] Commit:

```sh
git add packages/web/src/app/components/useClickOutside.ts packages/web/src/app/components/useClickOutside.test.tsx packages/web/src/app/components/DrawerHost.tsx packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx packages/web/src/app/planner/EventDrawer.tsx packages/web/src/app/planner/EventDrawer.test.tsx packages/web/src/app/habits/HabitDrawer.tsx packages/web/src/app/habits/HabitDrawer.test.tsx packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx packages/web/src/app/pages/Habits.tsx packages/web/src/app/pages/Habits.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): drawers become full-screen sheets on a phone

TaskDrawer, EventDrawer and HabitDrawer keep their internals; below md a shared
DrawerHost puts them in a fullScreen Sheet instead of the 440px panel slot,
whose left edge sat at -62px on a 390px phone. The field grids drop to one
column below md (a 165px column cannot hold a datetime input) -- and every
col-span-2 becomes col-span-1 md:col-span-2, since col-span-2 inside a
one-column grid would conjure an implicit second column.

All four drawer wrappers move z-40 -> z-50, including the Habits overlay: they
were painting *under* the fixed z-40 tab bar.

Inside a sheet the sheet owns dismissal, so useClickOutside gains an `enabled`
flag and the drawers pass !compact -- otherwise the drawer would close on the
press and hand the following click to the grid underneath.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 4 — NewTaskModal on a phone

**Files:**
- Modify: `packages/web/src/app/shell/NewTaskModal.tsx`
- Modify (test): `packages/web/src/app/shell/NewTaskModal.test.tsx` (additions only — `'sizes the dialog fluidly so it fits narrow viewports'` keeps passing; `px-4` and `overflow-y-auto` are deliberately left on the wrapper)

**Interfaces:** none — pure layout.

**Steps:**

- [ ] Append to `packages/web/src/app/shell/NewTaskModal.test.tsx`:

```tsx
  it('reserves the mobile bar height below md and the desktop bar at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const wrapper = (screen.getByLabelText('Close').closest('div.animate-pop') as HTMLElement).parentElement!;
    // MobileTopBar is h-14 (56px); pt-[70px] was a desktop-TopBar constant, ~14px too tall here.
    expect(wrapper.classList.contains('pt-14')).toBe(true);
    expect(wrapper.classList.contains('md:pt-[70px]')).toBe(true);
    expect(wrapper.classList.contains('pt-[70px]')).toBe(false);
  });

  it('goes near-full-screen below md and keeps its natural height at md+', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    const dialog = screen.getByLabelText('Close').closest('div.animate-pop') as HTMLElement;
    expect(dialog.classList.contains('min-h-[calc(100dvh_-_88px)]')).toBe(true);
    expect(dialog.classList.contains('md:min-h-0')).toBe(true);
  });

  it('wraps the duration/priority/split row below md', () => {
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api() as never) });
    // basis-[195px] + a shrink-0 2x2 picker + a shrink-0 Split toggle = ~429px of children in a
    // 358px content box at 390: the row must be allowed to break instead of clipping.
    const row = screen.getByRole('group', { name: 'Priority' }).closest('div.flex.flex-wrap') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.classList.contains('md:flex-nowrap')).toBe(true);
  });
```

- [ ] Run and confirm all three fail:

```sh
npm test -w @notreclaim/web -- src/app/shell/NewTaskModal.test.tsx
```

- [ ] Apply the three edits in `packages/web/src/app/shell/NewTaskModal.tsx`:

```tsx
    {/* pt: MobileTopBar is 56px (h-14), the desktop TopBar 70px. px-4 stays on both — 16px
        gutters are what makes this "near-full-screen" rather than edge-to-edge. */}
    <div className="fixed inset-0 z-50 flex animate-fade items-start justify-center overflow-y-auto bg-[rgba(24,26,42,.35)] px-4 pt-14 md:pt-[70px]" onClick={onClose}>
      <div className="w-full max-w-[500px] min-h-[calc(100dvh_-_88px)] animate-pop rounded-[18px] bg-card px-[22px] pb-[22px] pt-5 shadow-modal md:min-h-0" onClick={(e) => e.stopPropagation()}>
```

```tsx
        <div className="mb-3.5 flex flex-wrap items-center gap-3 gap-y-3 md:flex-nowrap">
```

- [ ] Run the file and the suite:

```sh
npm test -w @notreclaim/web -- src/app/shell/NewTaskModal.test.tsx
npm test -w @notreclaim/web
```

  Expected: **682 tests / 73 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/shell/NewTaskModal.tsx packages/web/src/app/shell/NewTaskModal.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): NewTaskModal fits a phone

pt-[70px] was the desktop TopBar's height -- ~14px too much under the 56px
mobile bar. The dialog now reaches near-full-height below md, and the
Duration/Priority/Split row is allowed to wrap: 195px + a shrink-0 2x2 picker
+ a shrink-0 Split toggle overflowed the 358px content box at 390 and clipped.

Desktop keeps its 70px offset, its natural height and its single-line row.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 5 — Outside-dismiss moves to `pointerdown`

**Files:**
- Modify: `packages/web/src/app/components/useClickOutside.ts`, `packages/web/src/app/planner/CreatePopover.tsx`, `packages/web/src/app/priorities/TaskRow.tsx`, `packages/web/src/app/priorities/Dropdown.tsx`, `packages/web/src/app/shell/AccountMenu.tsx`
- Modify (test): `useClickOutside.test.tsx` (3 rewritten — created in Task 3), `TaskDrawer.test.tsx` (1 rewritten), `EventDrawer.test.tsx` (1 rewritten), `CreatePopover.test.tsx` (+1), `TaskRow.test.tsx` (+1), `Toolbar.test.tsx` (+1), `TopBar.test.tsx` (+1)

**Interfaces:** none — the five listeners change event name only. `mousedown` never fires from a touch until the browser synthesises it after the tap completes (and not at all if the tap is consumed as a gesture), which is why these menus feel dead on a phone; `pointerdown` fires for mouse, touch and pen alike. `src/test/setup.ts` already polyfills `PointerEvent` as a `MouseEvent` subclass, so `fireEvent.pointerDown` carries coordinates and targets normally.

**Steps:**

- [ ] Rewrite the three tests in `packages/web/src/app/components/useClickOutside.test.tsx` to fire `pointerDown` instead of `mouseDown`, and add a fourth assertion to the first test proving `mousedown` alone no longer triggers it:

```tsx
  it('fires when the press lands outside the ref', () => {
    const onOutside = vi.fn();
    render(<Probe onOutside={onOutside} />);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onOutside).not.toHaveBeenCalled();   // touch never delivers a timely mousedown
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });
```

  …and `fireEvent.pointerDown` in the "inside" and "disabled" tests.

- [ ] Rewrite `'closes (onCancel) on a mousedown outside the drawer, but not inside it'` in `packages/web/src/app/tasks/TaskDrawer.test.tsx` and `'closes on a mousedown outside the drawer, but not inside it'` in `packages/web/src/app/planner/EventDrawer.test.tsx` — same bodies, renamed to `…on a pointerdown outside…`, with `fireEvent.mouseDown` → `fireEvent.pointerDown`.

- [ ] Add the four new tests. `CreatePopover.test.tsx`:

```tsx
  it('the desktop popover still dismisses on an outside pointerdown', () => {
    const onClose = vi.fn();
    renderWithProviders(<CreatePopover {...baseProps} onClose={onClose} />, { api: fakeApiClient() });
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

  `TaskRow.test.tsx` (`renderRow` takes the task **positionally**):

```tsx
  it('the row menu closes on an outside pointerdown', () => {
    renderRow(base as Task);
    fireEvent.click(screen.getByRole('button', { name: 'task menu' }));
    expect(screen.getByText('Delete')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Delete')).toBeNull();
  });
```

  `Toolbar.test.tsx` (covers `Dropdown`):

```tsx
  it('a dropdown closes on an outside pointerdown', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    expect(screen.getByText('Hide completed')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Hide completed')).toBeNull();
  });
```

  `TopBar.test.tsx` (covers `AccountMenu`) — **inside `describe('TopBar (bare render)')`**, which is where `renderTopBar` is defined:

```tsx
  it('the account menu closes on an outside pointerdown', () => {
    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });
```

  (Every helper named above already exists in its file: `renderRow(task, over)` in `TaskRow.test.tsx`, `renderToolbar()` in `Toolbar.test.tsx`, `renderTopBar(onNewTask?, path?)` in `TopBar.test.tsx`, `baseProps`/`fakeApiClient` in `CreatePopover.test.tsx`.)

- [ ] Run the six files and confirm the failures are only the `pointerdown` expectations:

```sh
npm test -w @notreclaim/web -- src/app/components/useClickOutside.test.tsx src/app/tasks/TaskDrawer.test.tsx src/app/planner/EventDrawer.test.tsx src/app/planner/CreatePopover.test.tsx src/app/priorities/TaskRow.test.tsx src/app/priorities/Toolbar.test.tsx src/app/shell/TopBar.test.tsx
```

- [ ] Flip the five listeners. `useClickOutside.ts` (its docstring already *claims* pointerdown — this makes the claim true):

```ts
    function handle(e: PointerEvent) {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onOutside();
    }
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
```

  `CreatePopover.tsx`:

```ts
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
```

  `TaskRow.tsx`, `Dropdown.tsx`, `AccountMenu.tsx`: the same two-line change in each (`(e: MouseEvent)` → `(e: PointerEvent)`, `'mousedown'` → `'pointerdown'` in both `addEventListener` and `removeEventListener`).

- [ ] Run the suite:

```sh
npm test -w @notreclaim/web
```

  Expected: **686 tests / 73 files**.

- [ ] Commit:

```sh
git add packages/web/src/app/components/useClickOutside.ts packages/web/src/app/components/useClickOutside.test.tsx packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/CreatePopover.test.tsx packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx packages/web/src/app/priorities/Dropdown.tsx packages/web/src/app/priorities/Toolbar.test.tsx packages/web/src/app/shell/AccountMenu.tsx packages/web/src/app/shell/TopBar.test.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx packages/web/src/app/planner/EventDrawer.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): dismiss popovers and menus on pointerdown, not mousedown

Touch delivers a synthetic mousedown late, or not at all when the tap is
consumed as a gesture, so the kebab menu, the filter/columns dropdowns, the
account menu, the desktop create popover and the desktop drawers all felt
stuck open on a phone. pointerdown covers mouse, touch and pen alike.

useClickOutside's docstring already promised pointerdown; it is true now.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 6 — `coarse:` variant, tap targets, `overscroll-behavior`, tap-to-open on task blocks

**Files:**
- Modify: `packages/web/tailwind.config.js`
- Modify: `packages/web/src/app/priorities/TaskRow.tsx`, `components/PriorityPicker.tsx`, `components/DurationStepper.tsx`, `habits/HabitDrawer.tsx`, `planner/PlannerTaskPanel.tsx`, `tasks/TaskDrawer.tsx`, `settings/WeeklyHoursEditor.tsx`, `shell/MobileTopBar.tsx`, `pages/Settings.tsx`, `planner/WeekGrid.tsx`, `pages/Planner.tsx`
- Create (test): `packages/web/src/app/components/DurationStepper.test.tsx` (2 tests)
- Modify (test): `TaskRow.test.tsx` (+1), `PriorityPicker.test.tsx` (+1), `HabitDrawer.test.tsx` (+1), `PlannerTaskPanel.test.tsx` (+1), `TaskDrawer.test.tsx` (+1), `SettingsForm.test.tsx` (+1), `MobileTopBar.test.tsx` (+1), `Settings.test.tsx` (+1), `WeekGrid.test.tsx` (+3)

**Interfaces:**
- New Tailwind variant `coarse:` = `@media (pointer: coarse)`.
- `WeekGrid` gains `onEditTask?: (taskId: string) => void`; it is wired to a task block's `onClick` **only when `coarse`**.

**Steps:**

- [ ] Register the variant in `packages/web/tailwind.config.js` — add the import at the top and replace `plugins: []`:

```js
import plugin from 'tailwindcss/plugin';
```

```js
  // `coarse:` keys off the input device, not the viewport: a touch laptop at 1280px gets the
  // bigger targets and a 390px window driven by a mouse does not. Literal class strings only,
  // so the JIT still sees every utility (`coarse:h-11` is scanned like any other token).
  plugins: [plugin(({ addVariant }) => { addVariant('coarse', '@media (pointer: coarse)'); })],
```

- [ ] Verify the variant actually compiles (jsdom can never prove this, so this is the real gate — the class below lands in Task 6's sweep two steps later, so run this again at the end of the task):

```sh
cd packages/web && npx --no-install tailwindcss -c tailwind.config.js -i src/index.css -o /tmp/nr-coarse-check.css
grep -c "@media (pointer: coarse)" /tmp/nr-coarse-check.css
grep -c "tap-highlight-color: transparent" /tmp/nr-coarse-check.css
```

  Expected **after** the sweep: the first count is **1** (Tailwind emits one `@media (pointer: coarse)` block holding every `coarse:` rule — the count is blocks, not utilities), the second is **1** (preflight already ships the tap-highlight rule on `html, :host` — **do not add a duplicate to `index.css`**). Before the sweep the first count is 0 and that is correct: an unused variant emits nothing.

- [ ] Write the failing tap-target tests. Each asserts literal class presence — jsdom evaluates no media query, so presence is the whole assertion.

  `TaskRow.test.tsx`:

```tsx
  it('grows the checklist checkbox and the kebab on a coarse pointer', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    // A 14px checkbox and a 26px kebab are the two worst targets on this card.
    const box = screen.getByTestId('card-subtask-s1');
    expect(box.className).toContain('coarse:h-5');
    expect(box.className).toContain('coarse:w-5');
    expect(box.parentElement!.className).toContain('coarse:-m-2.5'); // padded label, no layout shift
    expect(box.parentElement!.className).toContain('coarse:p-2.5');
    expect(screen.getByRole('button', { name: 'task menu' }).className).toContain('coarse:p-3.5');
  });
```

  `PriorityPicker.test.tsx`:

```tsx
  it('gives the chips a touch-sized row on a coarse pointer', () => {
    render(<PriorityPicker value={4} onChange={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /low/i });
    expect(chip.className).toContain('coarse:px-3');
    expect(chip.className).toContain('coarse:py-3.5');
  });
```

  `HabitDrawer.test.tsx`:

```tsx
  it('grows the weekday circles on a coarse pointer', () => {
    render(<HabitDrawer habit={habit()} onSave={vi.fn()} onCancel={vi.fn()} />);
    const monday = screen.getByTestId('day-1');
    expect(monday.className).toContain('coarse:h-10');
    expect(monday.className).toContain('coarse:w-10');
  });
```

  `PlannerTaskPanel.test.tsx`:

```tsx
  it('gives the card controls touch-sized hit areas on a coarse pointer', () => {
    render(
      <PlannerTaskPanel tasks={[task({ id: 'a', title: 'Do it' })]} preview={undefined} nowMs={NOW} coarse
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    // The 20px ✓ keeps its size and grows an invisible pseudo box instead.
    const complete = screen.getByRole('button', { name: 'Complete Do it' });
    expect(complete.className).toContain('coarse:before:-inset-3');
    expect(complete.className).toContain('relative');
    // ✎ and × are adjacent: padding + a wider gap, never overlapping pseudo boxes.
    expect(screen.getByRole('button', { name: 'Edit Do it' }).className).toContain('coarse:p-3');
    expect(screen.getByRole('button', { name: 'Edit Do it' }).parentElement!.className).toContain('coarse:gap-2');
  });
```

  `TaskDrawer.test.tsx`:

```tsx
  it('grows the subtask checkbox and delete control on a coarse pointer', () => {
    const subtasks = [{ id: 's1', taskId: 't1', title: 'First', done: false, sortOrder: 0 }];
    renderWithProviders(<TaskDrawer task={task({ subtasks })} onSave={vi.fn()} onCancel={vi.fn()} />, { api: emptyCategories() });
    expect(screen.getByTestId('subtask-toggle-s1').parentElement!.className).toContain('coarse:p-2.5');
    expect(screen.getByTestId('subtask-delete-s1').className).toContain('coarse:p-3');
  });
```

  `components/DurationStepper.test.tsx` (new file):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationStepper, durationLabel } from './DurationStepper';

describe('DurationStepper', () => {
  it('steps by 15 minutes and floors at 15', () => {
    const onChange = vi.fn();
    render(<DurationStepper label="duration" valueMs={15 * 60_000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'decrease duration' }));
    expect(onChange).toHaveBeenLastCalledWith(15 * 60_000);
    fireEvent.click(screen.getByRole('button', { name: 'increase duration' }));
    expect(onChange).toHaveBeenLastCalledWith(30 * 60_000);
    expect(durationLabel(90 * 60_000)).toBe('1 hr 30 min');
  });

  it('grows both step buttons on a coarse pointer without moving the icons', () => {
    render(<DurationStepper label="duration" valueMs={15 * 60_000} onChange={vi.fn()} />);
    for (const name of ['decrease duration', 'increase duration']) {
      expect(screen.getByRole('button', { name }).className).toContain('coarse:p-1.5');
    }
    expect(screen.getByRole('button', { name: 'decrease duration' }).parentElement!.className).toContain('coarse:gap-1');
  });
});
```

  `SettingsForm.test.tsx` (the page passes no `idPrefix`, so the testids are `day-<n>-*`):

```tsx
  it('grows the weekday checkboxes on a coarse pointer', () => {
    render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} />);
    const toggle = screen.getByTestId('day-1-toggle');
    expect(toggle.className).toContain('coarse:h-5');
    expect(toggle.parentElement!.className).toContain('coarse:py-2');
  });
```

  `MobileTopBar.test.tsx`:

```tsx
  it('gives the + button a touch-sized target', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    expect(screen.getByTestId('mobile-new-task').className).toContain('coarse:p-3');
  });
```

  `Settings.test.tsx`:

```tsx
  it('gives Sign out a touch-sized target', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByText('Sign out')).toBeInTheDocument());
    expect(screen.getByText('Sign out').className).toContain('coarse:py-3');
  });
```

  `WeekGrid.test.tsx` — the overscroll guard plus tap-to-open:

```tsx
  it('keeps a rubber-band scroll inside the hours grid', () => {
    renderGrid();
    expect(screen.getByTestId('hours-scroll').className).toContain('overscroll-contain');
  });

  it('a tap on a task block opens its task on a coarse pointer', () => {
    const onEditTask = vi.fn();
    renderGrid({ coarse: true, onEditTask });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(onEditTask).toHaveBeenCalledWith('t1');
  });

  it('leaves the desktop click behaviour of a task block untouched', () => {
    const onEditTask = vi.fn();
    renderGrid({ onEditTask });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(onEditTask).not.toHaveBeenCalled();
  });
```

- [ ] Run them all and confirm the failures are missing classes / an uncalled spy:

```sh
npm test -w @notreclaim/web -- src/app/priorities/TaskRow.test.tsx src/app/components/PriorityPicker.test.tsx src/app/components/DurationStepper.test.tsx src/app/habits/HabitDrawer.test.tsx src/app/planner/PlannerTaskPanel.test.tsx src/app/tasks/TaskDrawer.test.tsx src/app/settings/SettingsForm.test.tsx src/app/shell/MobileTopBar.test.tsx src/app/pages/Settings.test.tsx src/app/planner/WeekGrid.test.tsx
```

- [ ] Apply the sweep. Two idioms only: **`coarse:p-*`** where padding may grow the box, and **`relative coarse:before:absolute coarse:before:-inset-3 coarse:before:content-['']`** (an invisible, hit-testable pseudo box) where a fixed `h-*/w-*` visual must not change. The pseudo idiom is never used on adjacent buttons — the boxes would overlap and the later sibling would steal the earlier one's taps.

  - `priorities/TaskRow.tsx`, `SortableCardSubtask`: wrap the checkbox in a padded label and size it up.

```tsx
      <div className="flex items-center gap-2 text-[13px]">
        {/* Negative margin cancels the padding, so a 40px touch area costs no layout on desktop. */}
        <label className="flex items-center coarse:-m-2.5 coarse:p-2.5">
          <input
            type="checkbox"
            data-testid={`card-subtask-${subtask.id}`}
            checked={subtask.done}
            onChange={onToggle}
            className="h-3.5 w-3.5 accent-indigo coarse:h-5 coarse:w-5"
          />
        </label>
```

  - `priorities/TaskRow.tsx`, kebab button: `className="rounded-md p-1 text-inkSoft hover:bg-[#eef0f4] coarse:p-3.5"`.
  - `components/PriorityPicker.tsx`, chip: append `coarse:px-3 coarse:py-3.5` to the shared literal prefix of the chip class.
  - `components/DurationStepper.tsx`: `className="disabled:opacity-40 coarse:p-1.5"` on both buttons and `className="flex gap-2 text-indigo coarse:gap-1"` on their row (padding grows each box; the tighter gap keeps the pair inside the same field box).
  - `habits/HabitDrawer.tsx`, weekday circles: `h-7 w-7 … coarse:h-10 coarse:w-10` (7 × 40px + 6 × 6px gaps = 316px, inside a 390px sheet's content box).
  - `planner/PlannerTaskPanel.tsx`, complete circle: add `relative coarse:before:absolute coarse:before:-inset-3 coarse:before:content-['']` (the 20px ring must keep its size); the ✎/× pair gets `coarse:p-3` each and their wrapper `coarse:gap-2`.
  - `tasks/TaskDrawer.tsx`, `SortableSubtask`: the same padded-label idiom as the card checklist (`coarse:-m-2.5 coarse:p-2.5`, `coarse:h-5 coarse:w-5`), and `coarse:p-3` on the `×` delete button.
  - `settings/WeeklyHoursEditor.tsx`: `accent-indigo h-4 w-4 rounded coarse:h-5 coarse:w-5` on the checkbox and `coarse:py-2` on its row `div` (the row is the label-sized target here; the time inputs beside it are already ~32px and native).
  - `shell/MobileTopBar.tsx`: `coarse:p-3` on the `+` button; `coarse:py-2.5` on the Start and Stop buttons (they sit inside a 56px bar — `py-2.5` + 13px text ≈ 40px).
  - `pages/Settings.tsx`: `coarse:py-3` on the Sign-out button.

- [ ] Add `overscroll-contain` to the two remaining scroll containers this task owns:
  - `planner/WeekGrid.tsx`: `className="min-h-[240px] flex-1 overflow-y-auto overscroll-contain"` on `hours-scroll`.
  - …and while in that file, correct the comment above it, which claims a fallback more loosely than the code supports:

```tsx
          {/* The height comes from the flex chain (Planner h-full → grid pane → this card), NOT
              from a chrome constant: toolbars wrap, banners appear and the mobile top bar differs,
              so any `100dvh - Npx` guess is wrong on some viewport. shell-content's padding already
              reserves the fixed tab bar. `min-h-[240px]` floors degenerate cases (a zero-height
              ancestor); the overflow then lands in AppShell's `shell-content` scroller instead of
              the grid collapsing. `overscroll-contain` keeps a rubber-band flick at the top or
              bottom of the hours from scrolling the page behind it. */}
```

- [ ] Wire tap-to-open on task blocks. `planner/WeekGrid.tsx` — add the prop:

```tsx
  /** Coarse pointers only: a tap on a task block opens that task (spec §2 — tap opens the drawer).
   *  Deliberately not wired on fine pointers: a desktop click on a block does nothing today and
   *  changing that is a desktop behaviour change, which this phase does not make. */
  onEditTask?: (taskId: string) => void;
```

  …destructure it, and on the **task-block** `InteractiveBlock` (the `it.kind !== 'meeting' && blockId` branch) add:

```tsx
                          onClick={coarse && it.taskId && onEditTask ? () => onEditTask(it.taskId!) : undefined}
```

  Habit blocks have no `taskId` and therefore stay inert on tap — there is no habit drawer reachable from the planner, and inventing one is out of scope.

- [ ] Pass it from `pages/Planner.tsx`: `onEditTask={openTaskDrawer}` on `<WeekGrid …>`.

- [ ] Re-run the compiled-CSS check, the touched files, and the suite:

```sh
cd packages/web && npx --no-install tailwindcss -c tailwind.config.js -i src/index.css -o /tmp/nr-coarse-check.css
grep -c "@media (pointer: coarse)" /tmp/nr-coarse-check.css     # expect 1 (one block)
grep -oE "coarse\\\\:[a-z0-9:.\\\\[-]+" /tmp/nr-coarse-check.css | sort -u | wc -l   # expect >= 15 distinct utilities
cd ../.. && npm test -w @notreclaim/web
npm run build -w @notreclaim/web
```

  Expected: one `@media (pointer: coarse)` block containing every swept utility; suite **700 tests / 74 files**; build clean. If the block is missing entirely, the plugin import is the suspect — `tailwind.config.js` is ESM and Tailwind loads it through jiti, which resolves the bare `tailwindcss/plugin` specifier from the hoisted root `node_modules`.

- [ ] Commit:

```sh
git add packages/web/tailwind.config.js packages/web/src/app/priorities/TaskRow.tsx packages/web/src/app/priorities/TaskRow.test.tsx packages/web/src/app/components/PriorityPicker.tsx packages/web/src/app/components/PriorityPicker.test.tsx packages/web/src/app/components/DurationStepper.tsx packages/web/src/app/components/DurationStepper.test.tsx packages/web/src/app/habits/HabitDrawer.tsx packages/web/src/app/habits/HabitDrawer.test.tsx packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/planner/PlannerTaskPanel.test.tsx packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/tasks/TaskDrawer.test.tsx packages/web/src/app/settings/WeeklyHoursEditor.tsx packages/web/src/app/settings/SettingsForm.test.tsx packages/web/src/app/shell/MobileTopBar.tsx packages/web/src/app/shell/MobileTopBar.test.tsx packages/web/src/app/pages/Settings.tsx packages/web/src/app/pages/Settings.test.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/pages/Planner.tsx
git commit -m "$(cat <<'EOF'
feat(web): a coarse: variant, touch-sized targets, and tap-to-open blocks

tailwind.config.js registers `coarse:` = @media (pointer: coarse) -- an input
switch, not a width one, so a mouse at any width is untouched and a touch
laptop still gets the bigger targets.

Sweep of the ledgered offenders: 14px checklist checkboxes, the 26px kebab,
22px priority chips, 28px weekday circles, the 20px complete ring, the drawer
subtask x, the stepper icons, the weekly-hours checkboxes, the mobile bar's
+/Start/Stop and Settings' Sign out. Two idioms only: padding where the box may
grow, an invisible ::before box where a fixed-size visual must not -- never the
pseudo box on adjacent buttons, whose hit areas would overlap.

hours-scroll gets overscroll-contain. -webkit-tap-highlight-color is NOT added:
Tailwind's preflight already sets it on html and it inherits.

Task blocks finally answer a tap on a coarse pointer (spec section 2's
tap-opens-the-drawer), reusing InteractiveBlock's existing click/drag
discrimination. Fine pointers are untouched by design.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 7 — Board snap-scroll, banner density, stat clamp, and honest drag announcements

**Files:**
- Modify: `packages/web/src/app/priorities/Column.tsx`, `packages/web/src/app/pages/Priorities.tsx`
- Modify: `packages/web/src/app/planner/UnscheduledWarning.tsx`, `packages/web/src/app/stats/StatCard.tsx`
- Create: `packages/web/src/app/dnd/announcements.ts`
- Create (test): `packages/web/src/app/dnd/announcements.test.ts` (4 tests)
- Modify: `packages/web/src/app/planner/scheduleDrop.ts`, `packages/web/src/app/planner/PlannerTaskPanel.tsx`, `packages/web/src/app/priorities/Board.tsx`, `packages/web/src/app/pages/Planner.tsx`
- Modify (test): `Priorities.test.tsx` (+1), `UnscheduledWarning.test.tsx` (+2), `StatsComponents.test.tsx` (+1), `Planner.test.tsx` (+1)

**Interfaces:**
- `announcements.ts`: `type NameLookup = (id: string) => string | null`; `makeAnnouncements(name: NameLookup, dropTargetName: NameLookup): Announcements`; `POINTER_ONLY_DRAG_INSTRUCTIONS: ScreenReaderInstructions`.
- `scheduleDrop.ts` gains `panelTaskDraggableId(taskId: string): string` so the id format lives in one place.

**Steps:**

- [ ] Write `packages/web/src/app/dnd/announcements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeAnnouncements, POINTER_ONLY_DRAG_INSTRUCTIONS } from './announcements';

const titles: Record<string, string> = { t1: 'Write spec' };
const targets: Record<string, string> = { 'col:high': 'the High priority column' };
const a = makeAnnouncements((id) => titles[id] ?? null, (id) => targets[id] ?? null);

const active = { id: 't1' } as never;
const over = { id: 'col:high' } as never;

describe('drag announcements', () => {
  it('names the dragged item instead of reading out its id', () => {
    expect(a.onDragStart({ active })).toBe('Picked up Write spec.');
  });

  it('names the drop target, and says so when there is none', () => {
    expect(a.onDragOver({ active, over })).toBe('Write spec is over the High priority column.');
    expect(a.onDragOver({ active, over: null })).toBe('Write spec is not over a drop target.');
  });

  it('reports the end of the drag', () => {
    expect(a.onDragEnd({ active, over })).toBe('Write spec was dropped on the High priority column.');
    expect(a.onDragEnd({ active, over: null })).toBe('Write spec was dropped where it started.');
    expect(a.onDragCancel({ active, over: null })).toBe('Moving Write spec was cancelled.');
  });

  it('falls back to the raw id when a lookup misses, and never promises a keyboard lift', () => {
    expect(a.onDragStart({ active: { id: 'unknown-cuid' } as never })).toBe('Picked up unknown-cuid.');
    // The planner's drag surface runs Mouse+Touch sensors only — dnd-kit's stock instructions
    // tell a screen-reader user to press the space bar, which does nothing there.
    expect(POINTER_ONLY_DRAG_INSTRUCTIONS.draggable).not.toMatch(/space bar/i);
  });
});
```

- [ ] Run it (module missing → suite file fails to import, which is the expected red):

```sh
npm test -w @notreclaim/web -- src/app/dnd/announcements.test.ts
```

- [ ] Create `packages/web/src/app/dnd/announcements.ts`:

```ts
import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';

/** Maps a dnd-kit id to something a person would say. `null` means "no better name than the id". */
export type NameLookup = (id: string) => string | null;

/**
 * dnd-kit's stock announcements read the raw draggable id — on this board that is a cuid, so a
 * screen-reader user hears "Picked up draggable item cm4x8…". These say the task's title and the
 * column's or day's name instead.
 */
export function makeAnnouncements(name: NameLookup, dropTargetName: NameLookup): Announcements {
  const of = (id: string | number) => name(String(id)) ?? String(id);
  const target = (id: string | number) => dropTargetName(String(id)) ?? String(id);
  return {
    onDragStart: ({ active }) => `Picked up ${of(active.id)}.`,
    onDragOver: ({ active, over }) => (over
      ? `${of(active.id)} is over ${target(over.id)}.`
      : `${of(active.id)} is not over a drop target.`),
    onDragEnd: ({ active, over }) => (over
      ? `${of(active.id)} was dropped on ${target(over.id)}.`
      : `${of(active.id)} was dropped where it started.`),
    onDragCancel: ({ active }) => `Moving ${of(active.id)} was cancelled.`,
  };
}

/**
 * For drag surfaces with no KeyboardSensor. dnd-kit's default text promises "press the space bar
 * to pick up", which the planner's drag-to-schedule does not implement (day columns have no
 * keyboard coordinate story — see `useDragToScheduleSensors`).
 */
export const POINTER_ONLY_DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Drag a task onto a day column to schedule it. Dragging here works with a pointer or touch only.',
};
```

- [ ] Add the remaining failing tests.

  `Priorities.test.tsx` (inside the main describe):

```tsx
  it('sizes the columns to a phone and snaps the pane to them', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    const column = screen.getByTestId('column-critical');
    // min(): 372px on any viewport wider than ~438px, so desktop is unchanged.
    expect(column.className).toContain('w-[min(372px,85vw)]');
    expect(column.className).toContain('snap-start');
    const pane = column.closest('.overflow-auto') as HTMLElement;
    expect(pane.className).toContain('snap-x');
    expect(pane.className).toContain('snap-mandatory');
    expect(pane.className).toContain('md:snap-none');  // no snapping under a mouse
    expect(pane.className).toContain('overscroll-contain');
  });
```

  `UnscheduledWarning.test.tsx` — reusing the file's `entry(key, label)` helper, adding one shared
  list beside it (`const five = [entry('a','A (1h left)'), entry('b','B (1h left)'), entry('c','C (1h left)'), entry('d','D (1h left)'), entry('e','E (2 missed)')];`)
  and importing `installMatchMedia`. The existing three tests stay untouched:

```tsx
  it('still shows three entries and a +2 on a desktop banner', () => {
    render(<UnscheduledWarning entries={five} />);
    expect(screen.getByText('C (1h left)')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows a single entry below md — the banner measured 101px over four lines at 390px', () => {
    const mm = installMatchMedia({ '(max-width: 767.98px)': true });
    render(<UnscheduledWarning entries={five} />);
    expect(screen.getByText('A (1h left)')).toBeInTheDocument();
    expect(screen.queryByText('B (1h left)')).toBeNull();
    expect(screen.getByText('+4 more')).toBeInTheDocument();
    mm.restore();
  });
```

  `StatsComponents.test.tsx`:

```tsx
  it('shrinks the stat value below md so it stays on one line', () => {
    render(<StatCard label="Total scheduled" value="12h 30m" sub="this week" accent="text-indigo" />);
    const value = screen.getByText('12h 30m');
    expect(value.className).toContain('text-[28px]');
    expect(value.className).toContain('md:text-[36px]');
  });
```

  `Planner.test.tsx`:

```tsx
  it('tells screen readers the truth about the drag surface', async () => {
    renderWithProviders(<Planner now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('day-col-0')).toBeInTheDocument());
    // dnd-kit renders its instructions into a visually hidden node; the stock text tells the
    // user to press the space bar, and this surface has no KeyboardSensor.
    expect(screen.getByText(/pointer or touch only/i)).toBeInTheDocument();
    expect(screen.queryByText(/press the space bar/i)).toBeNull();
  });
```

- [ ] Run the four files and confirm the failures:

```sh
npm test -w @notreclaim/web -- src/app/pages/Priorities.test.tsx src/app/planner/UnscheduledWarning.test.tsx src/app/stats/StatsComponents.test.tsx src/app/pages/Planner.test.tsx
```

- [ ] `priorities/Column.tsx` — width and snap:

```tsx
    <div
      ref={setNodeRef}
      data-testid={`column-${columnKey}`}
      className={`shrink-0 snap-start transition-[width] ${collapsed ? 'w-[250px]' : 'w-[min(372px,85vw)]'}`}
    >
```

  `min(372px, 85vw)` resolves to 372px on any viewport wider than ~438px, so every `md+` layout is byte-identical; at 390px a column is 331px and the next one peeks in.

- [ ] `pages/Priorities.tsx` — the scrolling pane:

```tsx
      <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-auto overscroll-contain px-[30px] pb-10 md:snap-none">
```

- [ ] `planner/UnscheduledWarning.tsx` — compact density (the hook must sit above the early return):

```tsx
import { useCompactWidth } from '../lib/useMediaQuery';
import type { UnscheduledEntry } from './unscheduledSummary';

const MAX_SHOWN = 3;
/** A phone gets one: three chips plus "+N more" measured 101px / 4 lines at 390px. */
const MAX_SHOWN_COMPACT = 1;

export function UnscheduledWarning({ entries }: { entries: UnscheduledEntry[] }) {
  const compact = useCompactWidth();
  if (entries.length === 0) return null;
  const max = compact ? MAX_SHOWN_COMPACT : MAX_SHOWN;
  const shown = entries.slice(0, max);
  const rest = entries.slice(max);
```

- [ ] `stats/StatCard.tsx` — the value:

```tsx
      <div className={`mt-1.5 text-[28px] font-extrabold leading-none md:text-[36px] ${accent}`}>{value}</div>
```

- [ ] `planner/scheduleDrop.ts` — export the id format next to `PANEL_TASK_DRAG_TYPE`:

```ts
/** dnd-kit id for a task card in the planner panel / Tasks sheet. Prefixed so it can never
 *  collide with a bare task id used elsewhere (the board's sortables are bare ids). */
export function panelTaskDraggableId(taskId: string): string {
  return `panel-task:${taskId}`;
}
```

  …and use it in `planner/PlannerTaskPanel.tsx`'s `useDraggable({ id: panelTaskDraggableId(task.id), … })`. While in that file, correct the stale activator-ref comment on the card — dnd-kit's `findFirstFocusableNode` selector ends in `*[tabindex]`, so a `tabIndex: -1` card **is** the node it restores focus to:

```tsx
      // Both refs on the same element: the activator node is what dnd-kit restores focus to after
      // a drag — `findFirstFocusableNode` matches `*[tabindex]`, so `tabIndex: -1` keeps this card
      // programmatically focusable while removing the dead tab stop — and it is what a
      // KeyboardSensor would require an activation keydown to originate on, which keeps that
      // contract true if this surface ever gains one.
```

- [ ] `priorities/Board.tsx` — announcements with titles and column names:

```tsx
import { useMemo, useState } from 'react';
import { type BoardColumnKey, BUCKET_META, columnMeta, priorityToBucket } from './priorityBucket';
import { makeAnnouncements } from '../dnd/announcements';
```

```tsx
  // The board's ids are cuids and `col:<key>` strings; without this a screen reader narrates
  // "Picked up draggable item cm4x8…". Keyboard dragging is real here, so the stock
  // screenReaderInstructions stay — only the announcements change.
  const announcements = useMemo(() => {
    const titleOf = (id: string) => columns.flatMap((c) => c.tasks).find((t) => t.id === id)?.title ?? null;
    return makeAnnouncements(titleOf, (id) => {
      const key = overColumnKey(columns, id);
      return key ? `the ${columnMeta(key).label} column` : titleOf(id);
    });
  }, [columns]);
```

  …and `accessibility={{ announcements }}` on the board's `<DndContext>`.

- [ ] `pages/Planner.tsx` — announcements plus the honest instructions:

```tsx
import { weekdayLabel } from '../planner/weekModel';   // add to the existing weekModel import
import { makeAnnouncements, POINTER_ONLY_DRAG_INSTRUCTIONS } from '../dnd/announcements';
import { panelTaskDraggableId } from '../planner/scheduleDrop';   // add to the existing import
```

```tsx
  const dragAccessibility = useMemo(() => ({
    screenReaderInstructions: POINTER_ONLY_DRAG_INSTRUCTIONS,
    announcements: makeAnnouncements(
      (id) => (tasksQ.data ?? []).find((t) => panelTaskDraggableId(t.id) === id)?.title ?? null,
      (id) => {
        const m = /^day-col:(\d+)$/.exec(id);
        const i = m ? Number(m[1]) : -1;
        const day = days[i];
        return day === undefined ? null : weekdayLabel(day, zone);
      },
    ),
  }), [tasksQ.data, days, zone]);
```

  …and `accessibility={dragAccessibility}` on the planner's `<DndContext>`.

- [ ] Run the suite and the type-check:

```sh
npm test -w @notreclaim/web
npm run build -w @notreclaim/web
```

  Expected: **712 tests / 75 files**, build clean.

- [ ] Commit:

```sh
git add packages/web/src/app/priorities/Column.tsx packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx packages/web/src/app/planner/UnscheduledWarning.tsx packages/web/src/app/planner/UnscheduledWarning.test.tsx packages/web/src/app/stats/StatCard.tsx packages/web/src/app/stats/StatsComponents.test.tsx packages/web/src/app/dnd/announcements.ts packages/web/src/app/dnd/announcements.test.ts packages/web/src/app/planner/scheduleDrop.ts packages/web/src/app/planner/PlannerTaskPanel.tsx packages/web/src/app/priorities/Board.tsx packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): snap-scroll the board, thin the banner, name the drags

Priorities columns are min(372px, 85vw) with scroll-snap so a phone flicks
column to column; min() resolves to 372px above ~438px, so md+ is unchanged and
md:snap-none keeps a mouse free-scrolling.

The unscheduled banner shows one entry below md (it measured 101px over four
lines at 390) and the stat value drops to 28px so it stays on one line in the
2x2 grid.

Drag announcements now say "Picked up Write spec" instead of a cuid, and the
planner's drag surface stops promising a space-bar lift it has no sensor for.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 8 — Gate: full suite, build, and live verification

**Files:** none (no code or test changes; this task is the gate).

**Steps:**

- [ ] Full monorepo gate:

```sh
npm test -w @notreclaim/web
npm run build
```

  Expected: web **712 tests / 75 files** green; every workspace builds. (`@notreclaim/db` integration tests need `packages/db/.env.test`; run them only from the main checkout, never from a worktree.)

- [ ] Confirm no stray desktop-only regressions slipped in — these greps must all come back empty:

```sh
cd packages/web
grep -rn "z-40" src/app/pages/Planner.tsx src/app/pages/Priorities.tsx src/app/pages/Habits.tsx   # drawer hosts are z-50 now
grep -rn "heightClass" src/                                                                        # the removed Sheet prop
grep -rn "addEventListener('mousedown'" src/                                                       # every outside-dismiss is pointerdown
grep -rn "webkit-tap-highlight" src/index.css                                                      # preflight already ships it
```

- [ ] Reconcile the plan's ledger with the run: if any task landed a different number of tests than budgeted, update the Global Constraints arithmetic line in this file and include it in the last commit.

- [ ] **Restart Vite before looking at anything.** Stale Vite state has produced false "not fixed" reports four times in this project's history (R13, R14, Phase 2, Phase 3). Rebuild and restart the API too if it is running from `dist/`.

```sh
npm run build
set -a && . ./.env.run && set +a && node packages/server/dist/server.js   # in one shell
npm run dev -w @notreclaim/web                                            # in another
```

### Live verification — 1280 × 900, mouse (the desktop regression gate)

- [ ] **Planner.** Click empty grid space → the anchored popover opens in the column, at the clicked time, on the correct side near the right edge. Click outside → it closes and does **not** re-open. Escape closes it. Click a task block → nothing happens (unchanged desktop behaviour — tap-to-open is coarse-only). Click an app event → the event drawer opens in its right-hand slot, unchanged. Open the task drawer from the panel's ✎: it is the same 440px two-column panel, and clicking the page outside it closes it.
- [ ] **Priorities.** Columns are 372px wide, the pane scrolls freely with no snapping, a click on a card opens the 440px drawer, the kebab and both toolbar dropdowns open and close on an outside click.
- [ ] **Habits.** Edit opens the centred overlay; the drawer is the 440px panel; outside click closes.
- [ ] **New Task.** The modal sits 70px from the top, is 500px wide, its Duration/Priority/Split row is on one line, and the overlay scrolls if the window is short.
- [ ] **Stats.** Cards are in one row with 36px values.
- [ ] **Keyboard.** Tab to a board card → Space → ↓ ↓ → Space: the reorder still works and the live region now says the task's **title** and the destination **column name** rather than ids.

### Live verification — 390 × 844, touch emulation

- [ ] **The reported bug, exactly as reported.** Planner → tap empty grid space → the create sheet rises with a drag handle, a ✕ and a dimmed backdrop. Now: (a) tap the backdrop → it closes and **nothing re-opens**; (b) reopen, tap the ✕ → closes; (c) reopen, press Escape (hardware keyboard or emulated) → closes; (d) reopen, tap a *different* empty slot area behind the backdrop → the backdrop absorbs it, the sheet closes, and no second sheet appears at the new slot. Finally create an event from the sheet and confirm it lands at the tapped time.
- [ ] **Drawers.** Tasks sheet → ✎ on a card: the Tasks sheet closes and the task drawer fills the screen with a sticky header, a ✕ and a scrolling body; the tab bar is **not** visible over it; fields are one per row; Save persists; the backdrop and ✕ both dismiss. Repeat for an app event (tap the event tile) and for a habit (Habits → edit).
- [ ] **Tap-to-open a task block.** Tap a task tile on the grid → the task drawer opens. Tap a habit tile → nothing (documented). Long-press-drag a tile → it still moves and commits; the tap handler must not fire after a drag.
- [ ] **New Task.** The `+` opens a near-full-screen modal; Duration, Priority and Split are all reachable with nothing clipped at the right edge; the Create button is reachable by scrolling.
- [ ] **Priorities.** A horizontal flick snaps from column to column; a vertical flick scrolls the column and does not rubber-band the page; the kebab opens and closes on a tap outside.
- [ ] **Tap targets.** Checklist checkboxes, kebab, priority chips, weekday circles, the panel's ✓/✎/×, the stepper ∓, the weekly-hours checkboxes, the mobile bar's +/Start/Stop and Sign out are all comfortably hittable with a thumb; ✎ and × never trigger each other.
- [ ] **Banner.** Force an unschedulable task; the amber banner is one line with "+N more".

**Deferred to the user's real Android device (spec §5 — emulated touch is not the gate):**

- [ ] Chrome **and** Firefox on Android: the create-sheet dismissal flow above, all three drawers, and the tap-to-open on a task block.
- [ ] Confirm no scroll is stolen: flicking inside a drawer sheet scrolls the drawer and stops at its end without dragging the page; flicking the hours grid does the same.
- [ ] Confirm the sheets do not fight the on-screen keyboard: opening the create sheet focuses the title field, and the Create button stays reachable once the keyboard is up (`dvh` should handle it; if it does not, report it — a `100dvh`-to-`svh` change is the follow-up, not a redesign).

---

## Phase-4 coverage check (spec §4 + the Phase-3 hand-off ledger)

| Requirement | Where |
| --- | --- |
| **User report:** the compact create form has no dismiss affordance | Task 2 (Sheet-ified, hoisted out of the column, self-dismiss removed; the backdrop-tap regression test is the one that encodes the report) |
| Drawers → full-screen sheets below md, internals unchanged, desktop pixel-identical | Task 3 (`DrawerHost` + `compact` on all three drawers) |
| TaskDrawer wrapper z-tier (was z-40, under the z-40 tab bar) | Task 3 (all four hosts → z-50) |
| `Habits.tsx` edit overlay `fixed inset-0 z-40` | Task 3 (z-50, with its own test) |
| NewTaskModal near-full-screen + inner row overflow + `pt-[70px]` assumption | Task 4 |
| NewTaskModal wrapper `overflow-y-auto` | Already present (Phase 1); asserted by the pre-existing "sizes the dialog fluidly" test |
| `useClickOutside` + the four inline copies `mousedown` → `pointerdown` | Task 5 (CreatePopover's copy survives for the desktop path and is flipped with the rest) |
| Priorities columns `min(372px, 85vw)` + scroll-snap-x | Task 7 |
| Toolbar search fluid | Already done (Phase 1); guarded by `Toolbar.test.tsx` |
| Stats cards 2×2 / charts stack | Already done (Phase 1); the 36px value clamp is Task 7 |
| Planner legend hidden below md | Already done (Phase 1/2); `hidden … md:flex` in `WeekGrid` |
| `coarse:` Tailwind variant + tap-target bumps on every ledgered offender | Task 6 |
| Base CSS: `-webkit-tap-highlight-color` | **Already satisfied** by Tailwind preflight — verified, not duplicated (Task 6 greps the compiled CSS) |
| Base CSS: `overscroll-behavior: contain` on the scroll containers | Task 1 (sheet + drawer bodies), Task 6 (hours-scroll), Task 7 (board pane) |
| Sheet a11y hardening before four more callers reuse it | Task 1 |
| Planner `screenReaderInstructions` + title-bearing announcements | Task 7 (planner instructions + announcements; board announcements too) |
| Coarse tap on a planner task block is inert | Task 6 (coarse-only `onEditTask` → TaskDrawer; habit blocks documented as inert) |
| UnscheduledWarning compact density | Task 7 (one entry below md) |
| Stats 36px values wrap at 390 | Task 7 |
| PlannerTaskPanel activator-ref comment correction | Task 7 (verified against `findFirstFocusableNode`'s `*[tabindex]` selector) |
| `min-h-[240px]` hours-scroll comment | Task 6 (rewritten to name `shell-content` as the actual outer scroller) |

## Follow-ups deliberately **not** taken in this phase

- **`InteractiveBlock`'s 16px delete ✕** stays 16px on coarse pointers. Growing its hit area would overlap the tile that now opens the task drawer on tap, and the brief puts InteractiveBlock gesture surface changes out of scope. Ledger it: if a real device shows the ✕ is unhittable, the fix is a `coarse:before:-inset-2` on the button plus a re-test of tap-to-open.
- **Subtask list announcements** (the two nested `DndContext`s in `TaskRow` and `TaskDrawer`) still read subtask ids. `makeAnnouncements` is ready for them; the brief scoped this phase to the board and the planner.
- **`TaskRow` / `TaskDrawer` sortable-row duplication** — explicitly out of scope.
- **`GET /auth/me`** so the mobile Settings account row can show the signed-in email — server work, out of scope.
- **`dvh` vs `svh` under the Android on-screen keyboard** — only a real device can decide; the live checklist asks for a report rather than pre-emptively changing it.
