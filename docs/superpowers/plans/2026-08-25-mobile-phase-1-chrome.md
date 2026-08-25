# Mobile Phase 1 — Mobile Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NotReclaim *navigable* on a phone (~375–430px) without touching desktop behavior: a bottom tab bar and a compact mobile top bar below Tailwind `md`, mobile-only Settings rows for Buffers/Hours/account, `dvh` viewport units everywhere, and the three fluid-layout fixes (Stats cards/charts, Priorities search box). Interaction work (touch drag, sheets, dnd-kit, `coarse:` targets) is explicitly **not** in this phase.

**Architecture:** Adaptive single codebase, one route tree (`App.tsx` unchanged). Mobile vs. desktop chrome is chosen with **Tailwind responsive classes only** — both chromes are always in the DOM and CSS decides which one paints (`md:hidden` / `hidden md:flex`). No JS media queries, no `usePointerCoarse` in this phase. Now/Next selection logic is lifted out of `TopBar` into a pure function + thin hook (`shell/currentOrNext.ts`) so the desktop bar and the mobile pill share one implementation.

**Tech Stack:** React 18 + TypeScript (strict, `noUncheckedIndexedAccess`), Vite 5, Tailwind **v3.4.19** (so `h-dvh`/`min-h-dvh` utilities exist; arbitrary values like `max-h-[calc(100dvh-100px)]` and `pb-[env(safe-area-inset-bottom)]` work on the v3 JIT), TanStack Query v5, react-router-dom v6, vitest 1.6 + jsdom + @testing-library/react. Icons are hand-rolled inline SVGs in `src/app/shell/icons.tsx` (`Icons.planner`, `Icons.priorities`, …) — **no icon library is installed; do not add one.**

**Spec:** docs/superpowers/specs/2026-08-25-mobile-adaptation-design.md

## Global Constraints

- Tailwind v3 **literal utility class strings only** — never compute a class name; the JIT cannot see it.
- `packages/web` imports are **extensionless** and never `import React` (automatic JSX runtime; named hook imports are fine).
- **Desktop at `md+` must stay pixel- and behavior-identical.** Every edit is either additive-below-`md` or a `display` swap that resolves to the current value at `md+`.
- The web suite is **483 tests / 58 files green today** (`npm test -w @notreclaim/web`). It must be green after every task. Two pre-existing tests in `App.test.tsx` legitimately need re-scoping once the tab bar duplicates the nav link names — that is done inside Task 3, not left to the end.
- Tests run under `TZ=UTC` via the package `test` script — never bypass it.
- jsdom does **not** evaluate Tailwind CSS or media queries: `md:hidden` has no effect on `getByRole`/visibility in tests. Assert **class presence/absence** or scope queries with `within(...)`; never assert "not visible".
- All times render in `settings.timezone` (luxon) — Phase 1 adds no new time formatting beyond reusing `relativeDayTimeLabel`, which is already how the desktop TopBar renders the Next pill.
- TypeScript is strict with `noUncheckedIndexedAccess`: index accesses in test code need `!` (e.g. `getAllByTestId('stat-card')[0]!`). Test files are type-checked by `npm run build -w @notreclaim/web`.
- Never run branch-switching or history-rewriting git commands (`checkout`/`switch`/`restore`/`reset`/`stash`). `git add <explicit paths>` only — the working tree contains untracked local-only files (`seed-dev.mjs`, `review/`, `*.tsbuildinfo`) that must never be committed.
- Every commit message ends with the trailer line `Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828`.

---

## Task 1 — `MobileTabBar` component

**Files:**
- Create: `packages/web/src/app/shell/MobileTabBar.tsx`
- Create (test): `packages/web/src/app/shell/MobileTabBar.test.tsx`

**Interfaces:**
- Consumes: `Icons` from `packages/web/src/app/shell/icons.tsx` (`Icons.planner`, `Icons.priorities`, `Icons.timeblock`, `Icons.stats`, `Icons.settings`, each `(p: { size?: number; className?: string }) => ReactElement`); `NavLink` from `react-router-dom`.
- Produces: `export function MobileTabBar(): ReactElement` — **no props**. Root element carries `data-testid="mobile-tab-bar"`, `aria-label="Primary"`, and the classes `fixed inset-x-0 bottom-0 z-40 … pb-[env(safe-area-inset-bottom)] md:hidden`.

**Steps:**

- [ ] Write the failing test file `packages/web/src/app/shell/MobileTabBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar', () => {
  it('renders the five primary destinations as links', () => {
    renderWithProviders(<MobileTabBar />);
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('is fixed to the bottom, hidden at md and above, and reserves the safe-area inset', () => {
    renderWithProviders(<MobileTabBar />);
    const bar = screen.getByTestId('mobile-tab-bar');
    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).toContain('md:hidden');
    expect(bar.className).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('marks only the tab for the current route as active', () => {
    renderWithProviders(<MobileTabBar />, { initialEntries: ['/priorities'] });
    expect(screen.getByRole('link', { name: 'Priorities' }).className).toContain('text-indigo');
    // `end` on the Planner tab keeps "/" from matching every route.
    expect(screen.getByRole('link', { name: 'Planner' }).className).not.toContain('text-indigo');
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/MobileTabBar.test.tsx`. Expected failure: `Failed to resolve import "./MobileTabBar"` (the module does not exist yet).

- [ ] Create `packages/web/src/app/shell/MobileTabBar.tsx` with exactly:

```tsx
import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { Icons, type IconName } from './icons';

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

// Buffers and Hours are deliberately absent: on mobile they are reachable as link rows
// at the top of the Settings page (see the mobile-adaptation spec, section 1).
const TABS: Tab[] = [
  { to: '/', label: 'Planner', icon: 'planner', end: true },
  { to: '/priorities', label: 'Priorities', icon: 'priorities' },
  { to: '/habits', label: 'Habits', icon: 'timeblock' },
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function MobileTabBar(): ReactElement {
  return (
    <nav
      data-testid="mobile-tab-bar"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((tab) => {
        const Icon = Icons[tab.icon];
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end ?? false}
            className={({ isActive }) =>
              [
                'flex h-14 flex-1 flex-col items-center justify-center gap-1',
                isActive ? 'font-bold text-indigo' : 'font-semibold text-inkSoft',
              ].join(' ')
            }
          >
            <Icon size={21} />
            <span className="text-[10px] leading-none">{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/MobileTabBar.test.tsx`. Expected: 3 tests pass.

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: 486 passed (483 + 3); the component is not mounted anywhere yet, so nothing else moves.

- [ ] Commit:

```sh
git add packages/web/src/app/shell/MobileTabBar.tsx packages/web/src/app/shell/MobileTabBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): mobile bottom tab bar component

Five fixed-bottom tabs (Planner, Priorities, Habits, Stats, Settings) with
env(safe-area-inset-bottom) padding, hidden at md+. Not mounted yet.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 2 — Now/Next extraction + `MobileTopBar`

**Files:**
- Create: `packages/web/src/app/shell/currentOrNext.ts`
- Create (test): `packages/web/src/app/shell/currentOrNext.test.ts`
- Modify: `packages/web/src/app/shell/TopBar.tsx` (lines 5, 18, 21–34 — replace the inline schedule selection with the shared hook; the JSX below is untouched)
- Create: `packages/web/src/app/shell/MobileTopBar.tsx`
- Create (test): `packages/web/src/app/shell/MobileTopBar.test.tsx`

**Interfaces:**
- Produces `packages/web/src/app/shell/currentOrNext.ts`:
  - `export interface CurrentOrNext { running: ScheduledBlock | null; nextBlock: ScheduledBlock | null }`
  - `export function pickCurrentOrNext(blocks: readonly ScheduledBlock[], nowMs: number): CurrentOrNext`
  - `export function useCurrentOrNext(nowMs: number): CurrentOrNext` — reads `useScheduleQuery()` internally.
- Produces `export function MobileTopBar({ onNewTask, now }: MobileTopBarProps): ReactElement` where `interface MobileTopBarProps { onNewTask: () => void; now?: () => number }` (`now` defaults to `Date.now`, matching `TopBar`). Root carries `data-testid="mobile-top-bar"` and `md:hidden`. Test ids inside: `mobile-current-task`, `mobile-stop-task`, `mobile-next-task`, `mobile-next-task-start`, `mobile-new-task`.
- Consumes: `useScheduleQuery`, `useStartBlockMutation`, `useStopBlockMutation` from `../../api/queries`; `routeTitle` from `./routeTitle`; `relativeDayTimeLabel` from `../priorities/priorityBucket`; `Icons` from `./icons`.
- `TopBar`'s public props are **unchanged**: `{ onNewTask: () => void; now?: () => number; sidebarHidden?: boolean; onToggleSidebar?: () => void }`.

**Steps:**

- [ ] Write the failing pure-logic test `packages/web/src/app/shell/currentOrNext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import { pickCurrentOrNext } from './currentOrNext';

const NOW = Date.parse('2026-06-11T12:00:00Z');

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null, startedAt: null,
    ...over,
  };
}

describe('pickCurrentOrNext', () => {
  it('ignores blocks that are not task blocks', () => {
    const r = pickCurrentOrNext([block({ taskId: null })], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });

  it('picks the soonest un-started future task block as next', () => {
    const later = block({ id: 'late', startsAt: '2026-06-11T16:00:00Z', endsAt: '2026-06-11T17:00:00Z' });
    const sooner = block({ id: 'soon', startsAt: '2026-06-11T13:00:00Z', endsAt: '2026-06-11T13:30:00Z' });
    const r = pickCurrentOrNext([later, sooner], NOW);
    expect(r.nextBlock?.id).toBe('soon');
    expect(r.running).toBeNull();
  });

  it('ignores task blocks that already started in the past without being Started', () => {
    const r = pickCurrentOrNext([block({ startsAt: '2026-06-11T10:00:00Z', endsAt: '2026-06-11T11:00:00Z' })], NOW);
    expect(r.nextBlock).toBeNull();
  });

  it('prefers a started, unfinished block and suppresses next', () => {
    const started = block({ id: 'run', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z' });
    const r = pickCurrentOrNext([started, block()], NOW);
    expect(r.running?.id).toBe('run');
    expect(r.nextBlock).toBeNull();
  });

  it('treats a started block whose snapped start is slightly in the future as running', () => {
    const started = block({ id: 'snap', startsAt: '2026-06-11T12:15:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T12:10:00Z' });
    expect(pickCurrentOrNext([started], NOW).running?.id).toBe('snap');
  });

  it('drops a started block whose end has already passed', () => {
    const done = block({ id: 'done', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T09:00:00Z' });
    const r = pickCurrentOrNext([done], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/currentOrNext.test.ts`. Expected failure: `Failed to resolve import "./currentOrNext"`.

- [ ] Create `packages/web/src/app/shell/currentOrNext.ts` with exactly:

```ts
import type { ScheduledBlock } from '../../api/types';
import { useScheduleQuery } from '../../api/queries';

export interface CurrentOrNext {
  /** A task block you Started that hasn't ended yet, or null. */
  running: ScheduledBlock | null;
  /** The soonest un-started future task block. Always null while something is running. */
  nextBlock: ScheduledBlock | null;
}

/**
 * Pure selection shared by the desktop TopBar and the mobile top bar.
 *
 * "Running" = a task you've Started that hasn't ended. We don't also require start <= now:
 * Start snaps the start to round15(now), which can land a few minutes in the future, and a
 * started block is still the one you're working on. A block resized to end before now drops out.
 */
export function pickCurrentOrNext(blocks: readonly ScheduledBlock[], nowMs: number): CurrentOrNext {
  const taskBlocks = blocks.filter((b) => b.taskId != null);
  const running = taskBlocks
    .filter((b) => b.startedAt != null && Date.parse(b.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
  const nextBlock = running
    ? null
    : taskBlocks
        .filter((b) => b.startedAt == null && Date.parse(b.startsAt) > nowMs)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
  return { running, nextBlock };
}

/** Same selection, reading the shared schedule query. */
export function useCurrentOrNext(nowMs: number): CurrentOrNext {
  const scheduleQ = useScheduleQuery();
  return pickCurrentOrNext(scheduleQ.data ?? [], nowMs);
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/currentOrNext.test.ts`. Expected: 6 tests pass.

- [ ] Refactor `packages/web/src/app/shell/TopBar.tsx` to consume the hook. Replace line 5:

  old: `import { useScheduleQuery, useStartBlockMutation, useStopBlockMutation } from '../../api/queries';`
  new: `import { useStartBlockMutation, useStopBlockMutation } from '../../api/queries';`

  Add after line 6 (`import { relativeDayTimeLabel } …`):
  `import { useCurrentOrNext } from './currentOrNext';`

  Then replace the whole block from line 18 through line 34, i.e. old:

```tsx
  const scheduleQ = useScheduleQuery();
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();

  const taskBlocks = (scheduleQ.data ?? []).filter((b) => b.taskId != null);
  // "Running" = a task you've Started that hasn't ended. We don't also require start <= now:
  // Start snaps the start to round15(now), which can land a few minutes in the future, and a
  // started block is still the one you're working on. A block resized to end before now drops out.
  const running = taskBlocks
    .filter((b) => b.startedAt != null && Date.parse(b.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
  const nextBlock = running
    ? null
    : taskBlocks
        .filter((b) => b.startedAt == null && Date.parse(b.startsAt) > nowMs)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
```

  new:

```tsx
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();
  const { running, nextBlock } = useCurrentOrNext(nowMs);
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/TopBar.test.tsx`. Expected: all 14 TopBar tests still pass — the refactor is behavior-preserving.

- [ ] Write the failing test `packages/web/src/app/shell/MobileTopBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import type { ScheduledBlock } from '../../api/types';
import { MobileTopBar } from './MobileTopBar';

const NOW_MS = Date.parse('2026-06-11T12:00:00Z');
const nowFn = () => NOW_MS;

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null, startedAt: null,
    ...over,
  };
}

describe('MobileTopBar', () => {
  it('shows the route title and hides itself at md and above', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api, initialEntries: ['/priorities'] });
    expect(screen.getByRole('heading', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByTestId('mobile-top-bar').className).toContain('md:hidden');
  });

  it('opens the New Task modal from the + button', () => {
    const onNewTask = vi.fn();
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={onNewTask} now={nowFn} />, { api });
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('drops the search and avatar controls', () => {
    const api = fakeApiClient({ getSchedule: async () => [] });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /search/i })).toBeNull();
  });

  it('shows the next task as a truncating one-line pill with a Start button', async () => {
    const startBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({ getSchedule: async () => [block()], startBlock });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.getByTestId('mobile-next-task')).toBeInTheDocument());
    const pill = screen.getByTestId('mobile-next-task');
    expect(pill.textContent).toContain('Write docs');
    expect(pill.className).toContain('truncate');
    fireEvent.click(screen.getByTestId('mobile-next-task-start'));
    await waitFor(() => expect(startBlock).toHaveBeenCalledWith('b1'));
  });

  it('shows the running task as a pill with a Stop button', async () => {
    const stopBlock = vi.fn(async () => ({} as never));
    const api = fakeApiClient({
      getSchedule: async () => [block({
        id: 'r1', title: 'Deep work',
        startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z',
      })],
      stopBlock,
    });
    renderWithProviders(<MobileTopBar onNewTask={() => {}} now={nowFn} />, { api });
    await waitFor(() => expect(screen.getByTestId('mobile-current-task')).toBeInTheDocument());
    expect(screen.getByTestId('mobile-current-task').textContent).toContain('Deep work');
    expect(screen.queryByTestId('mobile-next-task')).toBeNull();
    fireEvent.click(screen.getByTestId('mobile-stop-task'));
    await waitFor(() => expect(stopBlock).toHaveBeenCalledWith('r1'));
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/MobileTopBar.test.tsx`. Expected failure: `Failed to resolve import "./MobileTopBar"`.

- [ ] Create `packages/web/src/app/shell/MobileTopBar.tsx` with exactly:

```tsx
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { useCurrentOrNext } from './currentOrNext';
import { useStartBlockMutation, useStopBlockMutation } from '../../api/queries';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';

interface MobileTopBarProps {
  onNewTask: () => void;
  now?: () => number;
}

/**
 * ~56px chrome for phones: page title, a truncated one-line Now/Next pill with its
 * Start/Stop button, and a `+` that opens NewTaskModal. Search and the avatar menu are
 * dropped here — sign-out lives in a Settings row on mobile. Hidden at md+, where the
 * full TopBar takes over.
 */
export function MobileTopBar({ onNewTask, now = Date.now }: MobileTopBarProps): ReactElement {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();
  const { running, nextBlock } = useCurrentOrNext(nowMs);

  return (
    <header data-testid="mobile-top-bar" className="flex h-14 shrink-0 items-center gap-2 bg-bg px-3 md:hidden">
      <h1 className="shrink-0 text-[19px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

      {running ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="mobile-current-task"
            onClick={() => void navigate('/')}
            className="min-w-0 truncate rounded-[9px] bg-card px-2.5 py-1.5 text-[13px] font-semibold text-ink/70"
          >
            Now: {running.title}
          </button>
          <button
            type="button"
            data-testid="mobile-stop-task"
            onClick={() => stopBlock.mutate(running.id)}
            className="shrink-0 rounded-[9px] bg-crit px-3 py-1.5 text-[13px] font-bold text-white"
          >
            Stop
          </button>
        </div>
      ) : nextBlock ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="mobile-next-task"
            onClick={() => void navigate('/')}
            className="min-w-0 truncate rounded-[9px] bg-card px-2.5 py-1.5 text-[13px] font-semibold text-ink/70"
          >
            Next: {nextBlock.title} · {relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs)}
          </button>
          <button
            type="button"
            data-testid="mobile-next-task-start"
            onClick={() => startBlock.mutate(nextBlock.id)}
            className="shrink-0 rounded-[9px] bg-indigo px-3 py-1.5 text-[13px] font-bold text-white"
          >
            Start
          </button>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <button
        type="button"
        data-testid="mobile-new-task"
        aria-label="New task"
        onClick={onNewTask}
        className="shrink-0 rounded-[9px] p-2 text-ink"
      >
        <Icons.plus size={22} />
      </button>
    </header>
  );
}
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/shell/MobileTopBar.test.tsx`. Expected: 5 tests pass.

- [ ] Run `npm run build -w @notreclaim/web` then `npm test -w @notreclaim/web`. Expected: build clean; 497 passed (486 + 6 + 5); `MobileTopBar` is not mounted yet so no other test changes.

- [ ] Commit:

```sh
git add packages/web/src/app/shell/currentOrNext.ts packages/web/src/app/shell/currentOrNext.test.ts \
        packages/web/src/app/shell/TopBar.tsx \
        packages/web/src/app/shell/MobileTopBar.tsx packages/web/src/app/shell/MobileTopBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): mobile top bar, sharing Now/Next selection with TopBar

Lift the running/next task-block selection out of TopBar into a pure
pickCurrentOrNext + useCurrentOrNext hook, then build the ~56px mobile bar on
top of it: title, truncated Now/Next pill with Start/Stop, and a + button.
Search and the avatar are dropped on mobile. Not mounted yet.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 3 — Mount the mobile chrome in `AppShell`, hide Sidebar/TopBar below `md`

**Files:**
- Modify: `packages/web/src/app/AppShell.tsx` (imports + the `return` block at lines 26–38)
- Modify: `packages/web/src/app/Sidebar.tsx` (line 10 — `aside` className)
- Modify: `packages/web/src/app/shell/TopBar.tsx` (the `header` className, currently line 37 pre-refactor / line ~26 after Task 2's deletion — match on the string, not the number)
- Modify (test): `packages/web/src/app/AppShell.test.tsx` (append a new describe block)
- Modify (test): `packages/web/src/app/App.test.tsx` (lines 25–39 — re-scope nav-link queries that now match twice)

**Interfaces:**
- Consumes: `MobileTabBar` (no props) and `MobileTopBar` (`{ onNewTask: () => void; now?: () => number }`) from Task 1/2.
- Produces: `AppShell` renders, in order inside `<main>`: `<TopBar …/>` (`hidden md:flex`), `<MobileTopBar onNewTask={…} />` (`md:hidden`), `<GoogleBrokenBanner />`, the `Outlet` wrapper; and `<MobileTabBar />` as the last child of the shell root. The `Outlet` wrapper gains `pb-[calc(56px_+_env(safe-area-inset-bottom))] md:pb-0` so content clears the fixed tab bar. `AppShell`'s props and the `nr.sidebarHidden` toggle behavior are unchanged.
- This step is also the spec's "TopBar overflow" fluid fix: the ~360px of fixed-cost desktop children never has to fit a phone because the whole header is `display:none` below `md`.
- **Duplicate accessible names inside `AppShell` after this task** (both chromes are in the DOM; jsdom has no CSS to hide either): the five nav destinations (sidebar + tab bar), the page `<h1>` (TopBar + MobileTopBar), and "New Task" / "New task" (TopBar text button + MobileTopBar `aria-label`). Any *future* `AppShell`- or `App`-level query for those must be scoped with `within(...)`. Only `App.test.tsx` is affected today.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/AppShell.test.tsx` (after the existing `AppShell sidebar toggle` describe block):

```tsx
describe('AppShell mobile chrome', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts the mobile tab bar and the mobile top bar', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-top-bar')).toBeInTheDocument();
  });

  it('hides the desktop top bar below md', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const header = screen.getByTestId('toggle-sidebar').closest('header')!;
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('md:flex');
  });

  it('hides the sidebar below md while keeping it at md+', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.className).toContain('hidden');
    expect(sidebar.className).toContain('md:flex');
  });

  it('pads the content area so the fixed tab bar never covers it on mobile', () => {
    renderWithProviders(<AppShell />, { api: makeApi() });
    const content = screen.getByTestId('shell-content');
    expect(content.className).toContain('pb-[calc(56px_+_env(safe-area-inset-bottom))]');
    expect(content.className).toContain('md:pb-0');
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/AppShell.test.tsx`. Expected failure: all four new tests fail — `Unable to find an element by: [data-testid="mobile-tab-bar"]`, likewise `mobile-top-bar` and `shell-content`, and the header/sidebar className assertions fail because neither carries `hidden`.

- [ ] Edit `packages/web/src/app/Sidebar.tsx` line 10.

  old: `    <aside data-testid="sidebar" className="dark-scroll flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar">`
  new: `    <aside data-testid="sidebar" className="dark-scroll hidden h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar md:flex">`

- [ ] Edit the `header` opening tag in `packages/web/src/app/shell/TopBar.tsx`.

  old: `    <header className="flex h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px]">`
  new: `    <header className="hidden h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px] md:flex">`

- [ ] Edit `packages/web/src/app/AppShell.tsx`. Add after line 8 (`import { GoogleBrokenBanner } …`):

```tsx
import { MobileTopBar } from './shell/MobileTopBar';
import { MobileTabBar } from './shell/MobileTabBar';
```

  Then replace the `return` block (lines 26–38), old:

```tsx
  return (
    <div className="flex h-screen overflow-hidden">
      {!sidebarHidden && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
        <GoogleBrokenBanner />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
```

  new:

```tsx
  return (
    <div className="flex h-screen overflow-hidden">
      {!sidebarHidden && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
        <MobileTopBar onNewTask={() => setNewTaskOpen(true)} />
        <GoogleBrokenBanner />
        {/* The tab bar is `fixed`, so the scroll area reserves its height (56px) plus the
            home-indicator inset below md. Tailwind turns the `_` into a space in calc(). */}
        <div
          data-testid="shell-content"
          className="min-h-0 flex-1 overflow-auto pb-[calc(56px_+_env(safe-area-inset-bottom))] md:pb-0"
        >
          <Outlet />
        </div>
      </main>
      <MobileTabBar />
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/AppShell.test.tsx`. Expected: all AppShell tests pass (7 existing + 4 new = 11).

- [ ] Run `npm test -w @notreclaim/web -- src/app/App.test.tsx`. Expected failure: `Found multiple elements with the role "link" and name "Planner"` (and the same for Priorities/Habits) — the tab bar now renders the same destinations as the sidebar. This is the expected, intended DOM change.

- [ ] Fix `packages/web/src/app/App.test.tsx` by scoping those queries to the sidebar. Change line 2, old:

  `import { screen, fireEvent } from '@testing-library/react';`
  new:
  `import { screen, fireEvent, within } from '@testing-library/react';`

  Replace the two affected tests (lines 25–39), old:

```tsx
  it('renders the shell with nav links when authenticated', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    expect(screen.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(screen.getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });
```

  new (the mobile tab bar renders the same destinations, so shell-level queries must say which chrome they mean):

```tsx
  it('renders the shell with nav links when authenticated', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: 'Priorities' })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(within(screen.getByTestId('sidebar')).getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });

  it('navigates to the Habits page via the mobile tab bar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(within(screen.getByTestId('mobile-tab-bar')).getByRole('link', { name: 'Habits' }));
    expect(screen.getByPlaceholderText(/add a habit/i)).toBeInTheDocument();
  });
```

- [ ] Run `npm run build -w @notreclaim/web` then `npm test -w @notreclaim/web`. Expected: build clean; 502 passed (497 + 4 AppShell + 1 new App routing test). If any other file fails with a "found multiple elements" error, scope that query the same way and note it — no other file renders `AppShell` or `<App />` today.

- [ ] Commit:

```sh
git add packages/web/src/app/AppShell.tsx packages/web/src/app/AppShell.test.tsx \
        packages/web/src/app/Sidebar.tsx packages/web/src/app/shell/TopBar.tsx \
        packages/web/src/app/App.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): mount mobile chrome, hide sidebar and TopBar below md

AppShell now renders MobileTopBar and MobileTabBar; Sidebar and the desktop
TopBar become `hidden md:flex` so md+ is unchanged. The content area reserves
the fixed tab bar's height plus the safe-area inset on mobile. App routing
tests are scoped to the sidebar now that both chromes name the same routes.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 4 — Settings page: mobile-only Buffers/Hours rows and account row

**Files:**
- Modify: `packages/web/src/app/pages/Settings.tsx` (imports at lines 1–6; hook block at lines 10–11; the `return` block at lines 30–46)
- Modify (test): `packages/web/src/app/pages/Settings.test.tsx` (imports at lines 1–6; append a describe block)

**Interfaces:**
- Consumes: `NavLink` from `react-router-dom`; `useAuth` from `../../auth/AuthContext` (provides `signOut: () => void`); `Icons` from `../shell/icons`.
- Produces: inside the existing `mx-auto w-full max-w-[720px]` wrapper — a `data-testid="mobile-settings-links"` container (`md:hidden`) with links to `/buffers` and `/hours` **above** `SettingsForm`, and a `data-testid="mobile-account-row"` row (`md:hidden`) with a Sign out button **below** `AccountSection`. `Settings`'s props (`{ version?: AppVersion }`) are unchanged.
- **Known gap (deviates from the task brief, matches the spec):** the client has **no** access to the signed-in email — `AuthContext` stores only `{ token, userId }` and the server exposes no `GET /auth/me` (only `PATCH /auth/email`). The row therefore reads "Signed in" + Sign out. Adding an email would need a new server endpoint; that is out of Phase 1 scope and is ledgered as a follow-up.

**Steps:**

- [ ] Append the failing tests to `packages/web/src/app/pages/Settings.test.tsx`, and extend its imports first.

  Line 2 old: `import { screen, fireEvent, waitFor } from '@testing-library/react';`
  new: `import { screen, fireEvent, waitFor, within } from '@testing-library/react';`

  Add after line 6 (`import { Settings as SettingsPage } …`):
  `import { tokenStore } from '../../auth/tokenStore';`

  Then append:

```tsx
describe('Settings page — mobile-only rows', () => {
  it('links to Buffers and Hours below md', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const links = screen.getByTestId('mobile-settings-links');
    expect(links.className).toContain('md:hidden');
    expect(within(links).getByRole('link', { name: 'Buffers' })).toHaveAttribute('href', '/buffers');
    expect(within(links).getByRole('link', { name: 'Hours' })).toHaveAttribute('href', '/hours');
  });

  it('offers an account row with sign out below md', async () => {
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    const row = screen.getByTestId('mobile-account-row');
    expect(row.className).toContain('md:hidden');
    expect(within(row).getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('clears the stored session when the mobile Sign out is pressed', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    const api = fakeApiClient({ getSettings: async () => settings() } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('mobile-account-row')).getByRole('button', { name: /sign out/i }));
    expect(tokenStore.get()).toBeNull();
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Settings.test.tsx`. Expected failure: 3 new tests fail with `Unable to find an element by: [data-testid="mobile-settings-links"]` / `[data-testid="mobile-account-row"]`.

- [ ] Edit `packages/web/src/app/pages/Settings.tsx`. Add after line 6 (`import { appVersion, … } …`):

```tsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from '../shell/icons';
```

  Add the auth hook next to the other hooks — old (lines 10–11):

```tsx
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();
```

  new (must stay above the early returns — rules of hooks):

```tsx
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();
  const { signOut } = useAuth();
```

  Then replace the `return` block (lines 30–46), old:

```tsx
  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[720px]">
        <SettingsForm
          initial={initial}
          saving={updateM.isPending}
          justSaved={updateM.isSuccess}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(input) => updateM.mutate(input)}
        />
        <AccountSection />
        <p data-testid="app-version" className="mt-6 text-center text-xs text-inkSoft">
          {formatAppVersion(build)}
        </p>
      </div>
    </div>
  );
```

  new:

```tsx
  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[720px]">
        {/* Buffers and Hours have no mobile tab — they live here as link rows below md. */}
        <div data-testid="mobile-settings-links" className="mb-4 flex flex-col gap-2 md:hidden">
          <NavLink to="/buffers" className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 text-[15px] font-semibold text-ink">
            <span>Buffers</span>
            <Icons.chevDown size={18} className="-rotate-90 text-inkSoft" />
          </NavLink>
          <NavLink to="/hours" className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 text-[15px] font-semibold text-ink">
            <span>Hours</span>
            <Icons.chevDown size={18} className="-rotate-90 text-inkSoft" />
          </NavLink>
        </div>
        <SettingsForm
          initial={initial}
          saving={updateM.isPending}
          justSaved={updateM.isSuccess}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(input) => updateM.mutate(input)}
        />
        <AccountSection />
        {/* The avatar dropdown is dropped from the mobile bar, so sign-out lands here.
            The signed-in email is not available client-side (AuthContext holds only
            token + userId, and the server has no GET /auth/me). */}
        <div data-testid="mobile-account-row" className="mt-4 flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 md:hidden">
          <span className="text-[15px] font-semibold text-ink">Signed in</span>
          <button type="button" onClick={signOut} className="rounded-[9px] px-3 py-2 text-[14px] font-bold text-crit">
            Sign out
          </button>
        </div>
        <p data-testid="app-version" className="mt-6 text-center text-xs text-inkSoft">
          {formatAppVersion(build)}
        </p>
      </div>
    </div>
  );
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Settings.test.tsx`. Expected: all Settings tests pass (6 existing + 3 new = 9).

- [ ] Run `npm run build -w @notreclaim/web` then `npm test -w @notreclaim/web`. Expected: build clean; 505 passed (502 + 3). Note `App.test.tsx`'s existing "signs out via the account menu" test renders `/`, not `/settings`, so the new Sign out button does not collide with it.

- [ ] Commit:

```sh
git add packages/web/src/app/pages/Settings.tsx packages/web/src/app/pages/Settings.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): mobile-only Settings rows for Buffers, Hours and sign out

Below md the sidebar (and its Buffers/Hours entries) and the avatar dropdown
are gone, so Settings carries link rows to /buffers and /hours plus an account
row with Sign out. The signed-in email is not exposed to the client, so the row
reads "Signed in" for now.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 5 — Fluid fixes: Stats cards/charts and the Priorities search box

**Files:**
- Modify: `packages/web/src/app/pages/Stats.tsx` (lines 62 and 68 — the two row containers)
- Modify (test): `packages/web/src/app/pages/Stats.test.tsx` (append two tests)
- Modify: `packages/web/src/app/priorities/Toolbar.tsx` (line 19 — the search box container)
- Create (test): `packages/web/src/app/priorities/Toolbar.test.tsx`

**Interfaces:**
- No component APIs change. `StatCard`, `HoursByDayChart`, `TimeSplitDonut` and `Toolbar`'s `ToolbarProps` are untouched.
- Stats stat-card row becomes `grid grid-cols-2 gap-[18px] md:flex` — at `md+` `display:flex` wins and `StatCard`'s existing `flex-1` restores today's equal-width row exactly; below `md` it is a 2×2 grid where `flex-1` is inert.
- Stats chart row becomes `flex flex-col items-stretch gap-[18px] md:flex-row` — `md:flex-row` is the CSS default, so `md+` is unchanged.
- Toolbar search box becomes `… w-[430px] min-w-0 max-w-full …` — at `md+` the container is far wider than 430px so `max-w-full` never binds.

**Steps:**

- [ ] Append the failing Stats tests to `packages/web/src/app/pages/Stats.test.tsx` (inside the existing `describe('Stats page', …)` block, after the last test):

```tsx
  it('wraps the stat cards 2×2 below md and rows them at md+', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByText('Total scheduled')).toBeInTheDocument());
    const row = screen.getAllByTestId('stat-card')[0]!.parentElement!;
    expect(row.className).toContain('grid-cols-2');
    expect(row.className).toContain('md:flex');
  });

  it('stacks the charts vertically below md and side-by-side at md+', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByTestId('hours-by-day')).toBeInTheDocument());
    const row = screen.getByTestId('hours-by-day').parentElement!;
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('md:flex-row');
  });
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Stats.test.tsx`. Expected failure: both new tests fail on `expect(received).toContain('grid-cols-2')` / `toContain('flex-col')` — the containers are plain `flex` rows today.

- [ ] Edit `packages/web/src/app/pages/Stats.tsx` line 62.

  old: `      <div className="flex gap-[18px]">`
  new: `      <div className="grid grid-cols-2 gap-[18px] md:flex">`

- [ ] Edit `packages/web/src/app/pages/Stats.tsx` line 68.

  old: `      <div className="flex items-stretch gap-[18px]">`
  new: `      <div className="flex flex-col items-stretch gap-[18px] md:flex-row">`

- [ ] Run `npm test -w @notreclaim/web -- src/app/pages/Stats.test.tsx`. Expected: 4 tests pass (2 existing + 2 new).

- [ ] Write the failing test file `packages/web/src/app/priorities/Toolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/fakes';
import type { BoardColumnKey } from './priorityBucket';
import { Toolbar } from './Toolbar';

const ALL_COLUMNS: Record<BoardColumnKey, boolean> = {
  critical: true, high: true, medium: true, low: true, backlog: true, completed: true,
};

function renderToolbar() {
  renderWithProviders(
    <Toolbar
      query="" setQuery={vi.fn()}
      hideCompleted={false} setHideCompleted={vi.fn()}
      colsVisible={ALL_COLUMNS} setColsVisible={vi.fn()}
    />,
  );
}

describe('Priorities Toolbar', () => {
  it('lets the search box shrink below its 430px desktop width', () => {
    renderToolbar();
    const box = screen.getByLabelText('Search tasks').parentElement!;
    expect(box.className).toContain('w-[430px]');   // desktop width preserved
    expect(box.className).toContain('max-w-full');  // never wider than a phone viewport
    expect(box.className).toContain('min-w-0');     // the flex input inside may shrink
  });
});
```

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/Toolbar.test.tsx`. Expected failure: `expect(received).toContain('max-w-full')` — the box is a rigid `w-[430px]` today.

- [ ] Edit `packages/web/src/app/priorities/Toolbar.tsx` line 19.

  old: `      <div className="flex h-12 w-[430px] items-center gap-2.5 rounded-[30px] border border-line bg-card px-5 shadow-card">`
  new: `      <div className="flex h-12 w-[430px] min-w-0 max-w-full items-center gap-2.5 rounded-[30px] border border-line bg-card px-5 shadow-card">`

- [ ] Run `npm test -w @notreclaim/web -- src/app/priorities/Toolbar.test.tsx`. Expected: 1 test passes.

- [ ] Run `npm run build -w @notreclaim/web` then `npm test -w @notreclaim/web`. Expected: build clean; 508 passed (505 + 2 + 1).

- [ ] Commit:

```sh
git add packages/web/src/app/pages/Stats.tsx packages/web/src/app/pages/Stats.test.tsx \
        packages/web/src/app/priorities/Toolbar.tsx packages/web/src/app/priorities/Toolbar.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): fluid Stats layout and shrinkable Priorities search

Stat cards wrap 2x2 below md (md:flex restores the desktop row), charts stack
vertically below md, and the 430px search box gains min-w-0/max-w-full so it
fits a 390px viewport. All three resolve to today's CSS at md+.

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Task 6 — `dvh` sweep across all six viewport-unit sites + final verification

**Files (mechanical class/style edits — no new tests; verification is build + full suite + grep):**
- Modify: `packages/web/src/app/AppShell.tsx` (line 27)
- Modify: `packages/web/src/app/Sidebar.tsx` (line 10 — as rewritten in Task 3)
- Modify: `packages/web/src/app/planner/WeekGrid.tsx` (line 172 — inline `maxHeight`)
- Modify: `packages/web/src/app/tasks/TaskDrawer.tsx` (line 39)
- Modify: `packages/web/src/app/planner/EventDrawer.tsx` (line 84)
- Modify: `packages/web/src/app/habits/HabitDrawer.tsx` (line 32)

**Interfaces:** none change. `h-dvh` is a real Tailwind utility in v3.4.19 (`height: 100dvh`); `max-h-[calc(100dvh-100px)]` is an arbitrary value the v3 JIT emits verbatim. No test in the suite asserts on `h-screen`, `100vh` or `maxHeight` (verified by grep), so this task is pure-mechanical and needs no new tests — but it must leave the suite green.

**Rationale for grouping:** these are six one-token substitutions with no behavioral branch to test in jsdom (jsdom does not compute `dvh`). The verification step below is the gate.

**Steps:**

- [ ] Edit `packages/web/src/app/AppShell.tsx` line 27.

  old: `    <div className="flex h-screen overflow-hidden">`
  new: `    <div className="flex h-dvh overflow-hidden">`

- [ ] Edit `packages/web/src/app/Sidebar.tsx` line 10 (this is the string produced by Task 3).

  old: `    <aside data-testid="sidebar" className="dark-scroll hidden h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar md:flex">`
  new: `    <aside data-testid="sidebar" className="dark-scroll hidden h-dvh w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar md:flex">`

- [ ] Edit `packages/web/src/app/planner/WeekGrid.tsx` line 172.

  old: `          <div ref={scrollRef} data-testid="hours-scroll" className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>`
  new: `          <div ref={scrollRef} data-testid="hours-scroll" className="overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 230px)' }}>`

- [ ] Edit `packages/web/src/app/tasks/TaskDrawer.tsx` line 39.

  old: `    <aside ref={rootRef} data-testid="task-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto">`
  new: `    <aside ref={rootRef} data-testid="task-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto">`

- [ ] Edit `packages/web/src/app/planner/EventDrawer.tsx` line 84.

  old: `      className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto"`
  new: `      className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto"`

- [ ] Edit `packages/web/src/app/habits/HabitDrawer.tsx` line 32.

  old: `    <aside ref={rootRef} data-testid="habit-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto">`
  new: `    <aside ref={rootRef} data-testid="habit-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto">`

- [ ] Verify no in-app viewport-unit site was missed:

```sh
grep -rn "100vh\|h-screen" packages/web/src/app/
```

  Expected: **no output**. (`src/auth/SignIn.tsx:35` and `src/auth/Register.tsx:31` keep `min-h-screen`; the spec scopes the migration to the six in-app sites and the sign-in pages have no fixed chrome to be clipped by a collapsing mobile URL bar. Leave them — and mention them in the hand-off if the reviewer wants them swept too.)

- [ ] Verify the `dvh` utilities actually reach the built CSS:

```sh
npm run build -w @notreclaim/web && grep -o "100dvh\|safe-area-inset-bottom" packages/web/dist/assets/*.css | sort | uniq -c
```

  Expected: build succeeds and both tokens appear (`100dvh` at least twice — `h-dvh` and `max-h-[calc(100dvh-100px)]`; `safe-area-inset-bottom` at least twice — the tab bar's `pb-[env(...)]` and the shell content's `pb-[calc(56px_+_env(...))]`). Vite minifies the CSS onto few lines, so count occurrences (`grep -o`), not lines. Zero occurrences means the JIT never saw the class — re-check for a computed class string. (All five arbitrary values were verified to compile against the installed Tailwind 3.4.19 while writing this plan.)

- [ ] Run the full suite `npm test -w @notreclaim/web`. Expected: 508 passed, 58+4 files — unchanged from Task 5 (no test reads these styles).

- [ ] Run the whole monorepo build and suite once as the phase gate:

```sh
npm run build && npm test
```

  Expected: all workspaces build; every suite green (`@notreclaim/db` needs `packages/db/.env.test` — present in the main checkout, absent in worktrees; if it is absent, say so rather than claiming a green DB suite).

- [ ] Commit:

```sh
git add packages/web/src/app/AppShell.tsx packages/web/src/app/Sidebar.tsx \
        packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/EventDrawer.tsx \
        packages/web/src/app/tasks/TaskDrawer.tsx packages/web/src/app/habits/HabitDrawer.tsx
git commit -m "$(cat <<'EOF'
fix(web): use dvh at all six viewport-height sites

h-screen -> h-dvh (AppShell, Sidebar) and 100vh -> 100dvh (planner hours-scroll
maxHeight, Task/Event/Habit drawer max-h) so a collapsing mobile URL bar no
longer clips the chrome. Tailwind 3.4 ships the dvh utilities; desktop is
unaffected (dvh == vh with no dynamic toolbar).

Claude-Session: https://claude.ai/code/session_01NSiADik5MoMncM9RBiA828
EOF
)"
```

---

## Phase exit checklist (run before declaring Phase 1 done)

- [ ] `npm run build -w @notreclaim/web` clean; `npm test -w @notreclaim/web` green (expect **508** tests, up from 483).
- [ ] `grep -rn "100vh\|h-screen" packages/web/src/app/` returns nothing.
- [ ] Live check at 390×844 with touch emulation (**restart Vite first — stale Vite state has produced false "not fixed" reports**): the tab bar is fixed at the bottom on every page and highlights the current tab; the mobile top bar shows the page title and the Now/Next pill truncates instead of overflowing; `+` opens NewTaskModal; the sidebar and the desktop TopBar are gone; Settings shows the Buffers/Hours rows and the Sign out row; Stats shows 2×2 cards and stacked charts; the Priorities search box fits.
- [ ] Live check at ≥768px: sidebar + desktop TopBar look exactly as before, the tab bar and mobile bar are gone, Stats is a 4-across row with side-by-side charts, the search box is 430px.
- [ ] Known Phase-1 limitation to state in the hand-off: the planner grid itself is still unusable on a phone (0px columns, no touch drag) — that is Phase 2, and it is expected.
