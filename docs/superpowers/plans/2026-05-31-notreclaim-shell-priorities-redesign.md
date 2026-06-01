# Dark Shell + Priorities Board Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the NotReclaim web client to the design handoff (dark sidebar + top bar + tokens) and add a `/priorities` Kanban board as the primary task UI, replacing the old Tasks page.

**Architecture:** Pure helpers (`priorityBucket`, `newTaskForm`, `routeTitle`) hold all logic and are unit-tested; thin React components render them with Tailwind theme tokens. Data comes from the existing TanStack Query hooks (`useTasksQuery`/`useSchedulePreviewQuery`/`useUpdateTaskMutation`/`useDeleteTaskMutation`/`useCreateTaskMutation`/`useSettingsQuery`) — no new endpoints, no mock data. The existing `TaskDrawer` is reused for editing.

**Tech Stack:** React 18 + Vite 5 + Tailwind v3 + TanStack Query v5 + React Router v6; Vitest + @testing-library/react@16 + jsdom (`TZ=UTC`).

**Conventions (apply to EVERY task):** TypeScript ESM strict, `noUncheckedIndexedAccess`. Imports are **extensionless**; **never** `import React` (jsx is `react-jsx`; `import { useState, useMemo, useRef, useEffect } from 'react'` is fine). Tailwind **utility classes only** (arbitrary values like `w-[280px]` where pixel-exact) — no inline-style objects. Tests use `fakeApiClient(overrides as never)` + `renderWithProviders` from `src/test/fakes`. No real network/Google. Pure modules take an injected `now: number`/`() => number`; never `Date.now()`/argless `new Date()` in pure code (components/pages are the impure boundary; `Intl.DateTimeFormat` is allowed there). All paths below are under `packages/web/`.

**Per-task test command:** `npm test -w @notreclaim/web -- <path>` (runs `TZ=UTC vitest run <path>`).

---

## File Structure

**Create:**
- `src/app/shell/icons.tsx` — inline-SVG icon set (`Icons` record), ported from `design_handoff_notreclaim/app/icons.jsx`.
- `src/app/shell/Logo.tsx` — 2×2 brand mark + wordmark.
- `src/app/shell/NavItem.tsx` — `NavLinkItem`, `NavDisabledItem`, `NavSection`.
- `src/app/shell/routeTitle.ts` — `routeTitle(pathname)` pure helper.
- `src/app/shell/TopBar.tsx` — top bar (title + actions).
- `src/app/shell/AccountMenu.tsx` — avatar → Settings / Sign out popover.
- `src/app/shell/newTaskForm.ts` — pure form model for the New Task modal.
- `src/app/shell/NewTaskModal.tsx` — New Task modal.
- `src/app/priorities/priorityBucket.ts` — bucket mapping + label helpers.
- `src/app/priorities/Dropdown.tsx` — `Dropdown` + `MenuRow` popover primitives.
- `src/app/priorities/TaskRow.tsx` — board task row.
- `src/app/priorities/TasksCard.tsx` — per-column white card.
- `src/app/priorities/Column.tsx` — one priority column (drop zone + collapse).
- `src/app/priorities/Board.tsx` — column row + drag state.
- `src/app/priorities/Toolbar.tsx` — search + Filter/Columns/Help dropdowns.
- `src/app/pages/Priorities.tsx` — the page.
- `src/app/pages/StatsPlaceholder.tsx` — "Coming soon" panel.
- Test files alongside each (`*.test.ts`/`*.test.tsx`).

**Modify:**
- `tailwind.config.js`, `index.html`, `src/index.css` — design tokens / font (Task 1).
- `src/app/Sidebar.tsx` — rewritten dark sidebar (Task 2).
- `src/app/App.test.tsx` — nav assertions (Tasks 2 & 3).
- `src/app/AppShell.tsx` — shell restructure + modal state (Task 3).
- `src/app/App.tsx` — routes (Task 7).

**Delete (Task 7):** `src/app/pages/Tasks.tsx`, `src/app/pages/Tasks.test.tsx`, `src/app/tasks/TaskRow.tsx`, `src/app/tasks/TaskRow.test.tsx`. **Keep** `src/app/tasks/TaskDrawer.tsx`, `src/app/tasks/taskForm.ts`, `src/app/lib/duration.ts`, `src/app/components/QuickAdd.tsx`, `src/app/components/DurationField.tsx` (QuickAdd still used by Habits).

---

## Task 1: Design tokens, font, base CSS

**Files:**
- Modify: `tailwind.config.js`
- Modify: `index.html`
- Modify: `src/index.css`

- [ ] **Step 1: Replace `tailwind.config.js` with the token theme**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: '#5b62e3',
        indigo600: '#4f55d6',
        indigoSoft: '#eef0ff',
        sidebar: '#1b1e2e',
        sidebarHover: '#272b3f',
        sidebarText: '#c5c8d6',
        sidebarMuted: '#8b8fa3',
        bg: '#f4f5f8',
        card: '#ffffff',
        line: '#e7e8ee',
        ink: '#2a2d3a',
        inkSoft: '#6b6f80',
        crit: '#e5484d',
        high: '#f2700f',
        med: '#f5b014',
        low: '#2fa45f',
        // Kind palettes — forward-defined for the Milestone 2 Planner re-skin.
        kind: {
          focusBg: '#eaf2ff', focusBar: '#5b62e3', focusText: '#2f3aa8',
          meetingBg: '#fdeef0', meetingBar: '#e5484d', meetingText: '#a3262b',
          habitBg: '#eafaf1', habitBar: '#2fa45f', habitText: '#1c7a43',
          taskBg: '#fff5e9', taskBar: '#f2700f', taskText: '#a8500a',
        },
      },
      fontFamily: { sans: ['Mulish', 'system-ui', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 2px rgba(20,22,40,.04)',
        pop: '0 14px 40px rgba(20,22,50,.16)',
        modal: '0 24px 60px rgba(20,22,50,.28)',
      },
      keyframes: {
        pop: { '0%': { opacity: '0', transform: 'translateY(8px) scale(.98)' }, '100%': { opacity: '1', transform: 'none' } },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: { pop: 'pop .14s ease-out', fade: 'fade .12s ease-out' },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Add the Mulish font to `index.html`** (inside `<head>`, before the title or after — anywhere in head)

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Mulish:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```

- [ ] **Step 3: Replace `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body, #root { height: 100%; }
  body { @apply bg-bg font-sans text-ink antialiased; }
}

@layer components {
  .dark-scroll::-webkit-scrollbar { width: 8px; }
  .dark-scroll::-webkit-scrollbar-thumb { background: #2c3046; border-radius: 8px; }
  .dark-scroll::-webkit-scrollbar-track { background: transparent; }
}
```

- [ ] **Step 4: Verify the build typechecks and existing tests still pass**

Run: `npm run build -w @notreclaim/web`
Expected: build succeeds (no TS/Vite errors).

Run: `npm test -w @notreclaim/web`
Expected: all existing suites PASS (tokens are additive; no behavior changed yet).

- [ ] **Step 5: Commit**

```bash
git add packages/web/tailwind.config.js packages/web/index.html packages/web/src/index.css
git commit -m "feat(web): design tokens, Mulish font, base CSS for redesign"
```

---

## Task 2: Sidebar + Logo + NavItem (dark nav)

**Files:**
- Create: `src/app/shell/icons.tsx`
- Create: `src/app/shell/Logo.tsx`
- Create: `src/app/shell/NavItem.tsx`, `src/app/shell/NavItem.test.tsx`
- Modify: `src/app/Sidebar.tsx`
- Create: `src/app/Sidebar.test.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Create `src/app/shell/icons.tsx`** (port from `design_handoff_notreclaim/app/icons.jsx`, typed, `currentColor`, `aria-hidden`)

```tsx
import type { ReactElement, ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

function Ic({
  size = 18, className, d, fill = 'none', sw = 1.8, children,
}: IconProps & { d?: string; fill?: string; sw?: number; children?: ReactNode }): ReactElement {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const Icons = {
  planner: (p: IconProps) => <Ic {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></Ic>,
  priorities: (p: IconProps) => <Ic {...p} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  stats: (p: IconProps) => <Ic {...p}><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 5.5 12 12" /></Ic>,
  timeblock: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></Ic>,
  meetings: (p: IconProps) => <Ic {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M16 5.5a3 3 0 0 1 0 5.5M21 19c-.4-2-1.6-3.4-3.4-4" /></Ic>,
  sync: (p: IconProps) => <Ic {...p} d="M20 11A8 8 0 0 0 6.3 5.7L3 9M4 13a8 8 0 0 0 13.7 3.3L21 13M3 5v4h4M21 19v-4h-4" />,
  help: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.3-2.6 2.3" /><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" /></Ic>,
  invite: (p: IconProps) => <Ic {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M18 7v6M21 10h-6" /></Ic>,
  chevDown: (p: IconProps) => <Ic {...p} d="M6 9l6 6 6-6" />,
  chevUp: (p: IconProps) => <Ic {...p} d="M6 15l6-6 6 6" />,
  search: (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></Ic>,
  filter: (p: IconProps) => <Ic {...p} d="M3 5h18M6 12h12M10 19h4" />,
  columns: (p: IconProps) => <Ic {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></Ic>,
  plus: (p: IconProps) => <Ic {...p} d="M12 5v14M5 12h14" />,
  minusCircle: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Ic>,
  plusCircle: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Ic>,
  clock: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ic>,
  dots: (p: IconProps) => <Ic {...p}><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></Ic>,
  check: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.3 2.3 4.7-4.8" /></Ic>,
  calendar: (p: IconProps) => <Ic {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></Ic>,
  close: (p: IconProps) => <Ic {...p} d="M6 6l12 12M18 6L6 18" />,
  info: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" /></Ic>,
  pin: (p: IconProps) => <Ic {...p} d="M14 3l7 7-3 1-4 4-1 6-2-2-5 5 5-5-2-2 6-1 4-4 1-3z" />,
  emoji: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><circle cx="9" cy="9.5" r=".7" fill="currentColor" stroke="none" /><circle cx="15" cy="9.5" r=".7" fill="currentColor" stroke="none" /></Ic>,
} satisfies Record<string, (p: IconProps) => ReactElement>;

export type IconName = keyof typeof Icons;
```

- [ ] **Step 2: Create `src/app/shell/Logo.tsx`**

```tsx
export function Logo() {
  return (
    <div className="flex items-center gap-[9px]">
      <div className="grid grid-cols-2 gap-[3px]">
        <span className="h-[11px] w-[11px] rounded-full bg-[#f4b8c2]" />
        <span className="h-[11px] w-[11px] rounded-[3px] bg-[#6ee0c8]" />
        <span className="h-[11px] w-[11px] rounded-[3px] bg-[#7c87ff]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#ffd166]" />
      </div>
      <div className="text-[20px] font-extrabold leading-none tracking-[-.4px] text-white">
        notreclaim<span className="text-[#8b8fff]">.app</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test `src/app/shell/NavItem.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavLinkItem, NavDisabledItem, NavSection } from './NavItem';

describe('NavItem', () => {
  it('NavLinkItem renders a link and is active on its route', () => {
    render(
      <MemoryRouter initialEntries={['/priorities']}>
        <NavLinkItem to="/priorities" label="Priorities" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Priorities' });
    expect(link).toHaveAttribute('href', '/priorities');
    expect(link.className).toContain('bg-sidebarHover');
  });

  it('NavDisabledItem shows a Soon pill and is not a link', () => {
    render(<NavDisabledItem label="Buffers" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Buffers')).toBeInTheDocument();
    expect(screen.getByText(/soon/i)).toBeInTheDocument();
  });

  it('NavSection toggles via onToggle and reflects open state', () => {
    const onToggle = vi.fn();
    render(<NavSection label="Time blocking" open onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /time blocking/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/shell/NavItem.test.tsx`
Expected: FAIL (module `./NavItem` not found).

- [ ] **Step 5: Implement `src/app/shell/NavItem.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icons } from './icons';

const ROW_BASE = 'flex w-full items-center gap-[13px] rounded-[9px] text-left transition-colors';
const PAD = (indent?: boolean) => (indent ? 'py-2 pl-[50px] pr-3.5 text-[14.5px]' : 'px-3.5 py-2.5 text-[15.5px]');

export function NavLinkItem({
  to, label, icon, end = false, indent = false,
}: { to: string; label: string; icon?: ReactNode; end?: boolean; indent?: boolean }) {
  return (
    <NavLink
      to={to} end={end}
      className={({ isActive }) =>
        [
          ROW_BASE, PAD(indent),
          isActive
            ? 'bg-sidebarHover font-bold text-white'
            : indent
              ? 'font-medium text-sidebarMuted hover:bg-white/5'
              : 'font-medium text-sidebarText hover:bg-white/5',
        ].join(' ')
      }
    >
      {icon && <span className="shrink-0 opacity-90">{icon}</span>}
      <span className="flex-1">{label}</span>
    </NavLink>
  );
}

export function NavDisabledItem({ label, icon, indent = false }: { label: string; icon?: ReactNode; indent?: boolean }) {
  return (
    <div
      className={[ROW_BASE, PAD(indent), 'cursor-default font-medium text-sidebarMuted/70'].join(' ')}
      aria-disabled="true"
    >
      {icon && <span className="shrink-0 opacity-50">{icon}</span>}
      <span className="flex-1">{label}</span>
      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebarMuted">
        Soon
      </span>
    </div>
  );
}

export function NavSection({
  label, icon, open, onToggle,
}: { label: string; icon?: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle}
      className={[ROW_BASE, PAD(false), 'font-medium text-sidebarText hover:bg-white/5'].join(' ')}
    >
      {icon && <span className="shrink-0 opacity-90">{icon}</span>}
      <span className="flex-1">{label}</span>
      {open ? <Icons.chevUp size={18} /> : <Icons.chevDown size={18} />}
    </button>
  );
}
```

- [ ] **Step 6: Run NavItem test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/shell/NavItem.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Write the failing test `src/app/Sidebar.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { Sidebar } from './Sidebar';

function renderSidebar(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><Sidebar /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders the routing nav items as links', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Priorities' })).toHaveAttribute('href', '/priorities');
    expect(screen.getByRole('link', { name: 'Habits' })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: 'Calendar Sync' })).toHaveAttribute('href', '/settings');
  });

  it('renders aspirational items as disabled with Soon', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Smart Meetings' })).toBeNull();
    expect(screen.getByText('Smart Meetings')).toBeInTheDocument();
    expect(screen.getAllByText(/soon/i).length).toBeGreaterThan(0);
  });

  it('shows the brand wordmark', () => {
    renderSidebar();
    expect(screen.getByText(/notreclaim/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/Sidebar.test.tsx`
Expected: FAIL (the current Sidebar has no Priorities/Calendar Sync links).

- [ ] **Step 9: Replace `src/app/Sidebar.tsx`**

```tsx
import { useState } from 'react';
import { Logo } from './shell/Logo';
import { NavLinkItem, NavDisabledItem, NavSection } from './shell/NavItem';
import { Icons } from './shell/icons';

export function Sidebar() {
  const [tbOpen, setTbOpen] = useState(true);
  const [mtOpen, setMtOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <aside className="dark-scroll flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      <div className="flex items-center justify-between px-[18px] pb-[14px] pt-5">
        <Logo />
        <span className="text-sidebarMuted"><Icons.pin size={18} /></span>
      </div>

      <nav className="flex flex-col gap-0.5 px-[14px] py-1.5">
        <NavLinkItem to="/" end label="Planner" icon={<Icons.planner size={20} />} />
        <NavLinkItem to="/priorities" label="Priorities" icon={<Icons.priorities size={20} />} />
        <NavLinkItem to="/stats" label="Stats" icon={<Icons.stats size={20} />} />

        <NavSection label="Time blocking" icon={<Icons.timeblock size={20} />} open={tbOpen} onToggle={() => setTbOpen((v) => !v)} />
        {tbOpen && (
          <>
            <NavDisabledItem label="Focus" indent />
            <NavLinkItem to="/habits" label="Habits" indent />
            <NavDisabledItem label="Buffers" indent />
            <NavDisabledItem label="Tasks" indent />
          </>
        )}

        <NavSection label="Meetings" icon={<Icons.meetings size={20} />} open={mtOpen} onToggle={() => setMtOpen((v) => !v)} />
        {mtOpen && (
          <>
            <NavDisabledItem label="Smart Meetings" indent />
            <NavDisabledItem label="Scheduling Links" indent />
          </>
        )}

        <NavLinkItem to="/settings" label="Calendar Sync" icon={<Icons.sync size={20} />} />
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 px-[14px] pb-[18px] pt-2.5">
        <NavSection label="Help" icon={<Icons.help size={20} />} open={helpOpen} onToggle={() => setHelpOpen((v) => !v)} />
        {helpOpen && (
          <>
            <NavDisabledItem label="Documentation" indent />
            <NavDisabledItem label="Contact support" indent />
            <NavDisabledItem label="What's new" indent />
          </>
        )}
        <NavDisabledItem label="Invite teammates" icon={<Icons.invite size={20} />} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 10: Run Sidebar test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/Sidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 11: Update `src/app/App.test.tsx` nav assertions**

In the test `'renders the shell with nav links when authenticated'`, replace the Tasks assertion and add Priorities:

```tsx
    expect(screen.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
```

Then **delete** the `'signs out back to /signin'` test entirely (the Sign-out control moves into the account menu in Task 3, which re-adds this test). Leave the `'redirects to /signin when unauthenticated'` and `'navigates to the Habits page via the sidebar'` tests as-is.

- [ ] **Step 12: Run the full web suite**

Run: `npm test -w @notreclaim/web`
Expected: PASS (App, Sidebar, NavItem green; no Tasks-link/sign-out failures).

- [ ] **Step 13: Commit**

```bash
git add packages/web/src/app/shell/icons.tsx packages/web/src/app/shell/Logo.tsx \
  packages/web/src/app/shell/NavItem.tsx packages/web/src/app/shell/NavItem.test.tsx \
  packages/web/src/app/Sidebar.tsx packages/web/src/app/Sidebar.test.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): dark sidebar with logo, icons, routing/disabled/expandable nav"
```

---

## Task 3: TopBar + AccountMenu + AppShell restructure

**Files:**
- Create: `src/app/shell/routeTitle.ts`, `src/app/shell/routeTitle.test.ts`
- Create: `src/app/shell/AccountMenu.tsx`
- Create: `src/app/shell/TopBar.tsx`, `src/app/shell/TopBar.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write the failing test `src/app/shell/routeTitle.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { routeTitle } from './routeTitle';

describe('routeTitle', () => {
  it('maps known routes to titles', () => {
    expect(routeTitle('/')).toBe('Planner');
    expect(routeTitle('/priorities')).toBe('Priorities');
    expect(routeTitle('/habits')).toBe('Habits');
    expect(routeTitle('/settings')).toBe('Settings');
    expect(routeTitle('/stats')).toBe('Stats');
  });
  it('falls back to the app name for unknown routes', () => {
    expect(routeTitle('/nope')).toBe('NotReclaim');
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/shell/routeTitle.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/shell/routeTitle.ts`**

```ts
const TITLES: Record<string, string> = {
  '/': 'Planner',
  '/priorities': 'Priorities',
  '/habits': 'Habits',
  '/settings': 'Settings',
  '/stats': 'Stats',
};

export function routeTitle(pathname: string): string {
  return TITLES[pathname] ?? 'NotReclaim';
}
```

- [ ] **Step 4: Run routeTitle test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/shell/routeTitle.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/app/shell/AccountMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from './icons';

export function AccountMenu() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-label="Account menu" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-[30px] py-1 pl-1 pr-1.5"
      >
        <span className="h-[38px] w-[38px] rounded-full" style={{ background: 'conic-gradient(from 140deg, #7c87ff, #6ee0c8, #ffd166, #f4b8c2, #7c87ff)' }} />
        <Icons.chevDown size={16} className="text-inkSoft" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[200px] animate-pop rounded-xl border border-line bg-card p-1.5 shadow-pop">
          <NavLink to="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3.5 py-2 text-[15px] font-semibold text-ink hover:bg-bg">
            Settings
          </NavLink>
          <button type="button" onClick={signOut} className="block w-full rounded-lg px-3.5 py-2 text-left text-[15px] font-semibold text-ink hover:bg-bg">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

NOTE: the `conic-gradient` avatar fill is the one permitted inline `style` (Tailwind cannot express a conic gradient); everything else uses utility classes.

- [ ] **Step 6: Write the failing test `src/app/shell/TopBar.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthContext';
import { TopBar } from './TopBar';

function renderTopBar(onNewTask = vi.fn(), path = '/priorities') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><TopBar onNewTask={onNewTask} /></AuthProvider>
    </MemoryRouter>,
  );
  return onNewTask;
}

describe('TopBar', () => {
  it('shows the page title from the route', () => {
    renderTopBar(vi.fn(), '/priorities');
    expect(screen.getByRole('heading', { name: 'Priorities' })).toBeInTheDocument();
  });

  it('fires onNewTask when New Task is clicked', () => {
    const onNewTask = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('opens the account menu to reveal Sign out', () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/shell/TopBar.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 8: Implement `src/app/shell/TopBar.tsx`**

```tsx
import { useLocation } from 'react-router-dom';
import { Icons } from './icons';
import { routeTitle } from './routeTitle';
import { AccountMenu } from './AccountMenu';

export function TopBar({ onNewTask }: { onNewTask: () => void }) {
  const { pathname } = useLocation();
  return (
    <header className="flex h-[70px] shrink-0 items-center gap-3.5 bg-bg pl-[30px] pr-[26px]">
      <h1 className="flex-1 text-[27px] font-extrabold tracking-[-.5px] text-ink">{routeTitle(pathname)}</h1>

      <div className="flex cursor-default items-center gap-1.5 rounded-[9px] px-3 py-2 text-[15.5px] font-semibold text-ink/40" aria-disabled="true">
        <Icons.clock size={18} /> Find a time
        <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-inkSoft">Soon</span>
      </div>

      <button type="button" onClick={onNewTask} className="flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[15.5px] font-bold text-ink hover:bg-[#eceef3]">
        <Icons.plus size={18} /> New Task
      </button>

      <button type="button" aria-label="Search" aria-disabled="true" className="cursor-default rounded-[9px] p-2 text-inkSoft/50">
        <Icons.search size={20} />
      </button>

      <AccountMenu />
    </header>
  );
}
```

- [ ] **Step 9: Run TopBar test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/shell/TopBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 10: Restructure `src/app/AppShell.tsx`** (owns New Task modal state; the modal component is created in Task 4 — for now wire a no-op placeholder so this task stays self-contained, then Task 4 swaps the import)

```tsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskPlaceholder onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}

// Temporary stand-in until Task 4 replaces it with the real NewTaskModal.
function NewTaskPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="new-task-modal" className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-[rgba(24,26,42,.35)] pt-[70px]" onClick={onClose}>
      <div className="animate-pop rounded-[18px] bg-card p-6 shadow-modal" onClick={(e) => e.stopPropagation()}>New Task</div>
    </div>
  );
}
```

- [ ] **Step 11: Re-add the sign-out test to `src/app/App.test.tsx`** (replaces the one deleted in Task 2; now goes through the account menu)

```tsx
  it('signs out via the account menu', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'], api: authedApi() });
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });
```

- [ ] **Step 12: Run the full web suite**

Run: `npm test -w @notreclaim/web`
Expected: PASS (TopBar, routeTitle, App all green; shell renders title + actions + account menu).

- [ ] **Step 13: Commit**

```bash
git add packages/web/src/app/shell/routeTitle.ts packages/web/src/app/shell/routeTitle.test.ts \
  packages/web/src/app/shell/AccountMenu.tsx packages/web/src/app/shell/TopBar.tsx \
  packages/web/src/app/shell/TopBar.test.tsx packages/web/src/app/AppShell.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): top bar with route title, New Task trigger, account menu; shell restructure"
```

---

## Task 4: New Task modal (`newTaskForm` + `NewTaskModal`)

**Files:**
- Create: `src/app/shell/newTaskForm.ts`, `src/app/shell/newTaskForm.test.ts`
- Create: `src/app/shell/NewTaskModal.tsx`, `src/app/shell/NewTaskModal.test.tsx`
- Modify: `src/app/AppShell.tsx`

- [ ] **Step 1: Write the failing test `src/app/shell/newTaskForm.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput } from './newTaskForm';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

describe('newTaskForm', () => {
  it('defaults: 1h duration, split on, due in 7 days, settings chunk defaults', () => {
    const s = defaultNewTaskForm(NOW, { defaultMinChunkMs: 900_000, defaultMaxChunkMs: 5_400_000 });
    expect(s.durationMs).toBe(3_600_000);
    expect(s.split).toBe(true);
    expect(s.minChunkMs).toBe(900_000);
    expect(s.maxChunkMs).toBe(5_400_000);
    expect(toCreateTaskInput(s).dueBy).toBe('2026-01-12T00:00:00.000Z');
  });

  it('falls back to 30m/120m chunk when no settings', () => {
    const s = defaultNewTaskForm(NOW);
    expect(s.minChunkMs).toBe(1_800_000);
    expect(s.maxChunkMs).toBe(7_200_000);
  });

  it('validates title, positive duration, and min <= max', () => {
    const base = defaultNewTaskForm(NOW);
    expect(validateNewTaskForm({ ...base, title: '' }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, durationMs: 0 }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'x', minChunkMs: 9_000_000, maxChunkMs: 1_000_000 }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'Write spec' }).ok).toBe(true);
  });

  it('toCreateTaskInput uses priority 4 and split-off collapses min=max=duration', () => {
    const s = { ...defaultNewTaskForm(NOW), title: 'Write spec', durationMs: 3_600_000, split: false, minChunkMs: 1_800_000, maxChunkMs: 7_200_000 };
    const input = toCreateTaskInput(s);
    expect(input.priority).toBe(4);
    expect(input.minChunkMs).toBe(3_600_000);
    expect(input.maxChunkMs).toBe(3_600_000);
    expect(input.title).toBe('Write spec');
    expect(input.category).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/shell/newTaskForm.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/shell/newTaskForm.ts`**

```ts
import type { CreateTaskInput } from '../../api/types';
import { isoToLocalInput, localInputToIso } from '../lib/duration';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewTaskFormState {
  title: string;
  durationMs: number;
  split: boolean;
  minChunkMs: number;
  maxChunkMs: number;
  dueByLocal: string; // "YYYY-MM-DDTHH:MM"
}

export function defaultNewTaskForm(
  now: number,
  settings?: { defaultMinChunkMs: number; defaultMaxChunkMs: number },
): NewTaskFormState {
  return {
    title: '',
    durationMs: 60 * 60_000,
    split: true,
    minChunkMs: settings?.defaultMinChunkMs ?? 30 * 60_000,
    maxChunkMs: settings?.defaultMaxChunkMs ?? 120 * 60_000,
    dueByLocal: isoToLocalInput(new Date(now + 7 * DAY_MS).toISOString()),
  };
}

export type NewTaskFormErrors = Partial<Record<keyof NewTaskFormState, string>>;

export function validateNewTaskForm(s: NewTaskFormState): { ok: boolean; errors: NewTaskFormErrors } {
  const errors: NewTaskFormErrors = {};
  if (!s.title.trim()) errors.title = 'Task name is required';
  if (!(s.durationMs > 0)) errors.durationMs = 'Duration must be positive';
  if (!(s.minChunkMs > 0)) errors.minChunkMs = 'Min must be positive';
  if (!(s.maxChunkMs > 0)) errors.maxChunkMs = 'Max must be positive';
  else if (s.minChunkMs > s.maxChunkMs) errors.maxChunkMs = 'Max must be ≥ min';
  if (!s.dueByLocal || Number.isNaN(Date.parse(s.dueByLocal))) errors.dueByLocal = 'A valid due date is required';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toCreateTaskInput(s: NewTaskFormState): CreateTaskInput {
  const minChunkMs = s.split ? s.minChunkMs : s.durationMs;
  const maxChunkMs = s.split ? s.maxChunkMs : s.durationMs;
  return {
    title: s.title.trim(),
    priority: 4,
    durationMs: s.durationMs,
    dueBy: localInputToIso(s.dueByLocal),
    minChunkMs,
    maxChunkMs,
    category: null,
  };
}
```

- [ ] **Step 4: Run newTaskForm test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/shell/newTaskForm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test `src/app/shell/NewTaskModal.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Task } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from './NewTaskModal';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const task = (over: Partial<Task> = {}): Task => ({
  id: 't9', userId: 'u1', title: 'x', priority: 4, durationMs: 3_600_000,
  dueBy: '2026-01-12T00:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

function api(createTask = vi.fn(async () => task())) {
  return { createTask, getSettings: vi.fn(() => Promise.reject(new Error('404'))) };
}

describe('NewTaskModal', () => {
  it('creates a task with priority 4 from the entered name', async () => {
    const createTask = vi.fn(async () => task());
    const onClose = vi.fn();
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={onClose} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write spec' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write spec', priority: 4, durationMs: 3_600_000 })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not create when the name is empty (Create disabled)', () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('with Split off, sends min=max=duration', async () => {
    const createTask = vi.fn(async () => task());
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api: fakeApiClient(api(createTask) as never) });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Solid block' } });
    fireEvent.click(screen.getByRole('button', { name: /split up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 3_600_000, maxChunkMs: 3_600_000 })));
  });
});
```

- [ ] **Step 6: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/shell/NewTaskModal.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `src/app/shell/NewTaskModal.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useSettingsQuery } from '../../api/queries';
import { msToHM } from '../lib/duration';
import { Icons } from './icons';
import {
  type NewTaskFormState, defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput,
} from './newTaskForm';

function durationLabel(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${minutes} mins`;
}
const STEP = 15 * 60_000;

function Stepper({ valueMs, onChange, disabled = false, label }: { valueMs: number; onChange: (ms: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[18px] font-bold">{durationLabel(valueMs)}</span>
      <div className="flex gap-2 text-indigo">
        <button type="button" aria-label={`decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(STEP, valueMs - STEP))} className="disabled:opacity-40"><Icons.minusCircle size={26} /></button>
        <button type="button" aria-label={`increase ${label}`} disabled={disabled} onClick={() => onChange(valueMs + STEP)} className="disabled:opacity-40"><Icons.plusCircle size={26} /></button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
      <span className="text-[13px] font-semibold text-inkSoft">{label}</span>
      {children}
    </div>
  );
}

export function NewTaskModal({ onClose, now = () => Date.now() }: { onClose: () => void; now?: () => number }) {
  const settingsQ = useSettingsQuery();
  const createM = useCreateTaskMutation();
  const chunkDefaults = settingsQ.data
    ? { defaultMinChunkMs: settingsQ.data.defaultMinChunkMs, defaultMaxChunkMs: settingsQ.data.defaultMaxChunkMs }
    : undefined;
  const [form, setForm] = useState<NewTaskFormState>(() => defaultNewTaskForm(now(), chunkDefaults));
  const set = <K extends keyof NewTaskFormState>(k: K, v: NewTaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const { ok } = validateNewTaskForm(form);
  const error = createM.error instanceof ApiError ? createM.error : null;

  const submit = () => {
    if (!ok) return;
    createM.mutate(toCreateTaskInput(form), { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-[rgba(24,26,42,.35)] pt-[70px]" onClick={onClose}>
      <div className="w-[500px] animate-pop rounded-[18px] bg-card px-[22px] pb-[22px] pt-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-inkSoft"><Icons.close size={22} /></button>
        </div>

        <div className="mb-[18px] mt-0.5 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2.5 rounded-[11px] border-2 border-indigo px-3.5 py-3 ring-[3px] ring-indigoSoft">
            <Icons.emoji size={22} className="text-indigo" />
            <input autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Task name…" className="flex-1 text-[18px] font-semibold text-ink outline-none" />
          </div>
        </div>

        <div className="mb-3.5 flex items-center gap-4">
          <div className="basis-[250px]">
            <Field label="Duration"><Stepper label="duration" valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} /></Field>
          </div>
          <button type="button" onClick={() => set('split', !form.split)} className="flex items-center gap-2.5">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md ${form.split ? 'bg-indigo text-white' : 'border-2 border-[#c7cad6]'}`}>{form.split && <Icons.check size={17} />}</span>
            <span className="text-[18px] font-bold text-ink">Split up</span>
          </button>
        </div>

        <div className="mb-3.5 flex gap-4">
          <Field label="Min duration"><Stepper label="min" disabled={!form.split} valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} /></Field>
          <Field label="Max duration"><Stepper label="max" disabled={!form.split} valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} /></Field>
        </div>

        <div className="mb-2 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-inkSoft">Hours</span>
          <div className="flex items-center">
            <Icons.info size={19} className="mr-2.5 text-indigo" />
            <span className="flex-1 text-[18px] font-bold">Working Hours</span>
            <Icons.chevDown size={20} className="text-inkSoft" />
          </div>
        </div>

        <div className="mb-4 flex gap-4">
          <Field label="Schedule after"><span className="text-[18px] font-bold text-[#aeb2c0]">Now</span></Field>
          <Field label="Due date">
            <input type="datetime-local" value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} className="text-[16px] font-bold text-ink outline-none" />
          </Field>
        </div>

        {error && <p data-testid="modal-error" className="mb-2 text-[12px] text-crit">{error.message}</p>}

        <div className="flex items-center justify-end">
          <button type="button" disabled={!ok || createM.isPending} onClick={submit} className="rounded-[30px] bg-indigo px-[34px] py-3 text-[17px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run NewTaskModal test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/shell/NewTaskModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Wire the real modal into `src/app/AppShell.tsx`** — remove the `NewTaskPlaceholder` function and its usage; import and render the real modal:

```tsx
import { NewTaskModal } from './shell/NewTaskModal';
```

Replace the placeholder render line with:

```tsx
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
```

- [ ] **Step 10: Run the full web suite**

Run: `npm test -w @notreclaim/web`
Expected: PASS (modal + form green; AppShell still renders).

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/app/shell/newTaskForm.ts packages/web/src/app/shell/newTaskForm.test.ts \
  packages/web/src/app/shell/NewTaskModal.tsx packages/web/src/app/shell/NewTaskModal.test.tsx packages/web/src/app/AppShell.tsx
git commit -m "feat(web): New Task modal wired to createTask (priority 4, split-aware chunks)"
```

---

## Task 5: `priorityBucket` pure module

**Files:**
- Create: `src/app/priorities/priorityBucket.ts`, `src/app/priorities/priorityBucket.test.ts`

- [ ] **Step 1: Write the failing test `src/app/priorities/priorityBucket.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SchedulePreview } from '../../api/types';
import { priorityToBucket, bucketToPriority, relativeDayTimeLabel, nextBlockMsForTask, BUCKETS } from './priorityBucket';

describe('priorityToBucket', () => {
  it('maps priority numbers to buckets', () => {
    expect(priorityToBucket(0)).toBe('critical');
    expect(priorityToBucket(1)).toBe('critical');
    expect(priorityToBucket(2)).toBe('high');
    expect(priorityToBucket(3)).toBe('medium');
    expect(priorityToBucket(4)).toBe('low');
    expect(priorityToBucket(9)).toBe('low');
  });
  it('bucketToPriority round-trips', () => {
    for (const b of BUCKETS) expect(priorityToBucket(bucketToPriority(b))).toBe(b);
  });
});

describe('relativeDayTimeLabel', () => {
  const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday
  it('uses Today / Tomorrow / weekday (TZ=UTC)', () => {
    expect(relativeDayTimeLabel(Date.parse('2026-01-07T17:00:00.000Z'), NOW)).toBe('Today 5:00pm');
    expect(relativeDayTimeLabel(Date.parse('2026-01-08T09:30:00.000Z'), NOW)).toBe('Tomorrow 9:30am');
    expect(relativeDayTimeLabel(Date.parse('2026-01-10T08:15:00.000Z'), NOW)).toBe('Sat 8:15am');
  });
});

describe('nextBlockMsForTask', () => {
  const preview: SchedulePreview = {
    blocks: [
      { id: 'a', sourceType: 'task', sourceId: 't1', title: 'A', start: 300, end: 400 },
      { id: 'b', sourceType: 'task', sourceId: 't1', title: 'A', start: 100, end: 200 },
      { id: 'c', sourceType: 'habit', sourceId: 't1', title: 'H', start: 50, end: 80 },
    ],
    unscheduled: [],
  };
  it('returns the soonest matching task block', () => {
    expect(nextBlockMsForTask('t1', preview)).toBe(100);
  });
  it('returns null when no task block matches or preview is undefined', () => {
    expect(nextBlockMsForTask('zzz', preview)).toBeNull();
    expect(nextBlockMsForTask('t1', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/priorities/priorityBucket.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/priorities/priorityBucket.ts`**

```ts
import type { SchedulePreview } from '../../api/types';

export const BUCKETS = ['critical', 'high', 'medium', 'low'] as const;
export type BucketKey = (typeof BUCKETS)[number];

export function priorityToBucket(priority: number): BucketKey {
  if (priority <= 1) return 'critical';
  if (priority === 2) return 'high';
  if (priority === 3) return 'medium';
  return 'low';
}

export function bucketToPriority(bucket: BucketKey): 1 | 2 | 3 | 4 {
  switch (bucket) {
    case 'critical': return 1;
    case 'high': return 2;
    case 'medium': return 3;
    case 'low': return 4;
  }
}

// Tailwind needs these literal class strings present in source to generate them.
export const BUCKET_META: Record<BucketKey, { label: string; dot: string; leftBorder: string }> = {
  critical: { label: 'Critical', dot: 'bg-crit', leftBorder: 'border-l-crit' },
  high: { label: 'High priority', dot: 'bg-high', leftBorder: 'border-l-high' },
  medium: { label: 'Medium priority', dot: 'bg-med', leftBorder: 'border-l-med' },
  low: { label: 'Low priority', dot: 'bg-low', leftBorder: 'border-l-low' },
};

function timeLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace(/\s+/g, '')
    .toLowerCase();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function relativeDayTimeLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const diffDays = Math.round((startOfDay(ms) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return `Today ${timeLabel(d)}`;
  if (diffDays === 1) return `Tomorrow ${timeLabel(d)}`;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d);
  return `${weekday} ${timeLabel(d)}`;
}

export function nextBlockMsForTask(taskId: string, preview: SchedulePreview | undefined): number | null {
  if (!preview) return null;
  const starts = preview.blocks
    .filter((b) => b.sourceType === 'task' && b.sourceId === taskId)
    .map((b) => b.start);
  return starts.length ? Math.min(...starts) : null;
}
```

- [ ] **Step 4: Run priorityBucket test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/priorities/priorityBucket.test.ts`
Expected: PASS (all cases). If a `timeLabel` assertion mismatches due to ICU spacing, the `.replace(/\s+/g, '')` already strips it — verify the expected strings have no spaces (`5:00pm`).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/priorities/priorityBucket.ts packages/web/src/app/priorities/priorityBucket.test.ts
git commit -m "feat(web): priorityBucket mapping + relative time + next-block helpers"
```

---

## Task 6: Priorities board components + page

**Files:**
- Create: `src/app/priorities/Dropdown.tsx`
- Create: `src/app/priorities/TaskRow.tsx`
- Create: `src/app/priorities/TasksCard.tsx`
- Create: `src/app/priorities/Column.tsx`
- Create: `src/app/priorities/Board.tsx`
- Create: `src/app/priorities/Toolbar.tsx`
- Create: `src/app/pages/Priorities.tsx`, `src/app/pages/Priorities.test.tsx`

- [ ] **Step 1: Implement `src/app/priorities/Dropdown.tsx`** (popover primitives; no dedicated test — exercised via the page test)

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icons } from '../shell/icons';

export function Dropdown({ icon, label, width = 240, children }: { icon: ReactNode; label: string; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[15.5px] font-bold text-indigo ${open ? 'bg-indigoSoft' : 'hover:bg-indigoSoft'}`}>
        {icon} {label} {open ? <Icons.chevUp size={16} /> : <Icons.chevDown size={16} />}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 animate-pop rounded-xl border border-line bg-card p-1.5 shadow-pop" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuRow({ label, checked, dotClass, onClick }: { label: string; checked?: boolean; dotClass?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2 text-left text-[15px] font-semibold text-ink hover:bg-bg">
      <span className={`flex h-[19px] w-[19px] items-center justify-center rounded-[5px] ${checked ? 'bg-indigo text-white' : 'border-2 border-[#c7cad6]'}`}>{checked && <Icons.check size={13} />}</span>
      {dotClass && <span className={`h-2.5 w-2.5 rounded-[3px] ${dotClass}`} />}
      <span className="flex-1">{label}</span>
    </button>
  );
}
```

- [ ] **Step 2: Implement `src/app/priorities/TaskRow.tsx`**

```tsx
import { useState } from 'react';
import type { Task } from '../../api/types';
import { Icons } from '../shell/icons';
import { type BucketKey, BUCKET_META, relativeDayTimeLabel } from './priorityBucket';

function dueShort(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

export interface TaskRowProps {
  task: Task;
  bucket: BucketKey;
  nextMs: number | null;
  now: number;
  dragging: boolean;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}

export function TaskRow({ task, bucket, nextMs, now, dragging, onComplete, onEdit, onDelete, onDragStart, onDragEnd }: TaskRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const done = task.status === 'completed';
  const meta = `Due ${dueShort(task.dueBy)}${nextMs !== null ? ` · Next: ${relativeDayTimeLabel(nextMs, now)}` : ''}`;

  return (
    <div
      data-testid="task-row" data-task-id={task.id} data-bucket={bucket}
      draggable
      onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      onClick={() => onEdit(task)}
      className={`flex cursor-grab items-start gap-3 border-t border-l-4 border-t-line ${BUCKET_META[bucket].leftBorder} bg-card py-3.5 pl-4 pr-3.5 transition-colors hover:bg-[#fafbfc] ${dragging ? 'opacity-40' : done ? 'opacity-45' : ''}`}
    >
      <button
        type="button" aria-label="complete"
        onClick={(e) => { e.stopPropagation(); onComplete(task); }}
        className={`mt-0.5 ${done ? 'text-low' : 'text-[#b9bdcb]'}`}
      >
        <Icons.check size={21} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-[16px] font-semibold text-ink ${done ? 'line-through' : ''}`}>{task.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[14px] text-inkSoft">
          <Icons.calendar size={15} /><span>{meta}</span>
        </div>
      </div>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="task menu" onClick={() => setMenuOpen((v) => !v)} className="rounded-md p-1 text-inkSoft hover:bg-[#eef0f4]">
          <Icons.dots size={18} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-[140px] animate-pop rounded-lg border border-line bg-card p-1 shadow-pop">
            <button type="button" onClick={() => { setMenuOpen(false); onEdit(task); }} className="block w-full rounded px-3 py-1.5 text-left text-[14px] hover:bg-bg">Edit</button>
            <button type="button" onClick={() => { setMenuOpen(false); onDelete(task); }} className="block w-full rounded px-3 py-1.5 text-left text-[14px] text-crit hover:bg-bg">Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/app/priorities/TasksCard.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { Icons } from '../shell/icons';

export function TasksCard({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3.5 overflow-hidden rounded-xl border border-line bg-card shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-4 py-3.5 text-ink">
        <span className="text-[16px] font-bold">Tasks</span>
        <span className="rounded-md bg-[#eef0f4] px-2 py-px text-[13px] font-bold text-inkSoft">{count}</span>
        <span className="flex-1" />
        {open ? <Icons.chevUp size={18} className="text-inkSoft" /> : <Icons.chevDown size={18} className="text-inkSoft" />}
      </button>
      {open && children}
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/priorities/Column.tsx`**

```tsx
import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BucketKey, BUCKET_META } from './priorityBucket';
import { TasksCard } from './TasksCard';
import { TaskRow } from './TaskRow';

export interface ColumnDnd {
  id: string | null;
  over: BucketKey | null;
  start: (id: string) => void;
  end: () => void;
  setOver: (k: BucketKey) => void;
  drop: (to: BucketKey) => void;
}

export interface ColumnProps {
  bucket: BucketKey;
  tasks: Task[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  dnd: ColumnDnd;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function Column({ bucket, tasks, now, nextMsFor, dnd, onComplete, onEdit, onDelete }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isTarget = dnd.over === bucket && dnd.id !== null;

  return (
    <div
      data-testid={`column-${bucket}`}
      onDragOver={(e) => { if (dnd.id !== null) { e.preventDefault(); dnd.setOver(bucket); } }}
      onDrop={(e) => { e.preventDefault(); dnd.drop(bucket); }}
      className={`shrink-0 transition-[width] ${collapsed ? 'w-[250px]' : 'w-[372px]'}`}
    >
      <div className="mb-3 flex items-center pr-1">
        <span className="flex-1 text-[16.5px] font-bold text-inkSoft">{BUCKET_META[bucket].label}</span>
        <button type="button" onClick={() => setCollapsed((v) => !v)} className="text-[15.5px] font-bold text-indigo">
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className={`rounded-[13px] ${isTarget ? 'outline-dashed outline-2 outline-offset-[3px] outline-indigo' : ''}`}>
          {tasks.length > 0 ? (
            <TasksCard count={tasks.length}>
              {tasks.map((t) => (
                <TaskRow
                  key={t.id} task={t} bucket={bucket} now={now} nextMs={nextMsFor(t.id)}
                  dragging={dnd.id === t.id}
                  onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
                  onDragStart={dnd.start} onDragEnd={dnd.end}
                />
              ))}
            </TasksCard>
          ) : (
            <div className={`rounded-xl border-[1.5px] px-1 py-[22px] text-center text-[14.5px] ${isTarget ? 'border-dashed border-indigo font-bold text-indigo' : 'border-transparent text-[#aeb2c0]'}`}>
              {isTarget ? 'Drop to move here' : 'Nothing here yet'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/app/priorities/Board.tsx`**

```tsx
import { useState } from 'react';
import type { Task } from '../../api/types';
import { type BucketKey } from './priorityBucket';
import { Column, type ColumnDnd } from './Column';

export interface BoardColumn { key: BucketKey; tasks: Task[]; }

export interface BoardProps {
  columns: BoardColumn[];
  now: number;
  nextMsFor: (taskId: string) => number | null;
  onMove: (taskId: string, to: BucketKey) => void;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function Board({ columns, now, nextMsFor, onMove, onComplete, onEdit, onDelete }: BoardProps) {
  const [drag, setDrag] = useState<{ id: string | null; over: BucketKey | null }>({ id: null, over: null });
  const dnd: ColumnDnd = {
    id: drag.id,
    over: drag.over,
    start: (id) => setDrag({ id, over: null }),
    end: () => setDrag({ id: null, over: null }),
    setOver: (k) => setDrag((d) => (d.over === k ? d : { ...d, over: k })),
    drop: (to) => { if (drag.id !== null) onMove(drag.id, to); setDrag({ id: null, over: null }); },
  };
  return (
    <div className="flex items-start gap-[26px]" style={{ minWidth: 'min-content' }}>
      {columns.map((c) => (
        <Column
          key={c.key} bucket={c.key} tasks={c.tasks} now={now} nextMsFor={nextMsFor} dnd={dnd}
          onComplete={onComplete} onEdit={onEdit} onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/app/priorities/Toolbar.tsx`**

```tsx
import { Icons } from '../shell/icons';
import { Dropdown, MenuRow } from './Dropdown';
import { type BucketKey, BUCKETS, BUCKET_META } from './priorityBucket';

export interface ToolbarProps {
  query: string;
  setQuery: (s: string) => void;
  hideCompleted: boolean;
  setHideCompleted: (b: boolean) => void;
  colsVisible: Record<BucketKey, boolean>;
  setColsVisible: (r: Record<BucketKey, boolean>) => void;
}

export function Toolbar({ query, setQuery, hideCompleted, setHideCompleted, colsVisible, setColsVisible }: ToolbarProps) {
  return (
    <div className="flex items-center gap-3 pb-[18px] pl-[30px] pr-[26px] pt-1.5">
      <div className="flex h-12 w-[430px] items-center gap-2.5 rounded-[30px] border border-line bg-card px-5 shadow-card">
        <Icons.search size={20} className="text-inkSoft" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for something…" className="flex-1 bg-transparent text-[16px] text-ink outline-none" />
      </div>
      <div className="flex-1" />
      <Dropdown icon={<Icons.filter size={18} />} label="Filter">
        <div className="px-3.5 pb-1 pt-2 text-[12.5px] font-extrabold uppercase tracking-wide text-inkSoft">Task status</div>
        <MenuRow label="Hide completed" checked={hideCompleted} onClick={() => setHideCompleted(!hideCompleted)} />
      </Dropdown>
      <Dropdown icon={<Icons.columns size={18} />} label="Columns">
        <div className="px-3.5 pb-1 pt-2 text-[12.5px] font-extrabold uppercase tracking-wide text-inkSoft">Show columns</div>
        {BUCKETS.map((b) => (
          <MenuRow key={b} label={BUCKET_META[b].label} dotClass={BUCKET_META[b].dot} checked={colsVisible[b]} onClick={() => setColsVisible({ ...colsVisible, [b]: !colsVisible[b] })} />
        ))}
      </Dropdown>
      <Dropdown icon={<Icons.help size={18} />} label="Help" width={220}>
        <MenuRow label="Keyboard shortcuts (Soon)" />
        <MenuRow label="Watch a tutorial (Soon)" />
        <MenuRow label="Contact support (Soon)" />
      </Dropdown>
    </div>
  );
}
```

- [ ] **Step 7: Write the failing test `src/app/pages/Priorities.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Priorities } from './Priorities';

const NOW = Date.parse('2026-01-07T12:00:00.000Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const preview: SchedulePreview = { blocks: [], unscheduled: [] };

function makeApi(over = {}) {
  return fakeApiClient({
    listTasks: vi.fn(async () => [
      task({ id: 'c1', title: 'Critical thing', priority: 1 }),
      task({ id: 'l1', title: 'Low thing', priority: 4 }),
      task({ id: 'd1', title: 'Done thing', priority: 4, status: 'completed' }),
    ]),
    getSchedulePreview: vi.fn(async () => preview),
    updateTask: vi.fn(async () => task()),
    deleteTask: vi.fn(async () => undefined),
    ...over,
  } as never);
}

const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' });

describe('Priorities board', () => {
  it('groups tasks into their priority columns', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    expect(within(screen.getByTestId('column-critical')).getByText('Critical thing')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-low')).getByText('Low thing')).toBeInTheDocument();
  });

  it('completes a task via the check button', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    const row = screen.getByText('Critical thing').closest('[data-testid="task-row"]')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('c1', { status: 'completed' }));
  });

  it('filters by search text', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/search for something/i), { target: { value: 'low' } });
    expect(screen.queryByText('Critical thing')).toBeNull();
    expect(screen.getByText('Low thing')).toBeInTheDocument();
  });

  it('hides completed tasks via the Filter dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Done thing')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide completed/i }));
    expect(screen.queryByText('Done thing')).toBeNull();
  });

  it('hides a column via the Columns dropdown', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByTestId('column-critical')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));
    expect(screen.queryByTestId('column-critical')).toBeNull();
    expect(screen.getByTestId('column-low')).toBeInTheDocument();
  });

  it('collapses a column to hide its tasks', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Critical thing')).toBeInTheDocument());
    const col = screen.getByTestId('column-critical');
    fireEvent.click(within(col).getByRole('button', { name: 'Collapse' }));
    expect(within(col).queryByText('Critical thing')).toBeNull();
  });

  it('reprioritizes via drag and drop', async () => {
    const updateTask = vi.fn(async () => task());
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ updateTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const row = screen.getByText('Low thing').closest('[data-testid="task-row"]')! as HTMLElement;
    const target = screen.getByTestId('column-critical');
    fireEvent.dragStart(row, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(target, { dataTransfer: dataTransfer() });
    fireEvent.drop(target, { dataTransfer: dataTransfer() });
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('l1', { priority: 1 }));
  });

  it('opens the edit drawer from the row menu and deletes', async () => {
    const deleteTask = vi.fn(async () => undefined);
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi({ deleteTask }) });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    const row = screen.getByText('Low thing').closest('[data-testid="task-row"]')! as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /task menu/i }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('l1'));
  });

  it('opens the drawer when a row is clicked', async () => {
    renderWithProviders(<Priorities now={() => NOW} />, { api: makeApi() });
    await waitFor(() => expect(screen.getByText('Low thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Low thing'));
    expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to confirm failure**

Run: `npm test -w @notreclaim/web -- src/app/pages/Priorities.test.tsx`
Expected: FAIL (module `./Priorities` not found).

- [ ] **Step 9: Implement `src/app/pages/Priorities.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useSchedulePreviewQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { Toolbar } from '../priorities/Toolbar';
import { Board, type BoardColumn } from '../priorities/Board';
import { type BucketKey, BUCKETS, priorityToBucket, bucketToPriority, nextBlockMsForTask } from '../priorities/priorityBucket';

export function Priorities({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const previewQ = useSchedulePreviewQuery();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();

  const [query, setQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [colsVisible, setColsVisible] = useState<Record<BucketKey, boolean>>({ critical: true, high: true, medium: true, low: true });
  const [editing, setEditing] = useState<Task | null>(null);
  const nowMs = now();

  const columns: BoardColumn[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (tasksQ.data ?? []).filter((t) =>
      t.status !== 'archived'
      && (!hideCompleted || t.status !== 'completed')
      && (!q || t.title.toLowerCase().includes(q)));
    return BUCKETS.filter((b) => colsVisible[b]).map((key) => ({
      key,
      tasks: visible.filter((t) => priorityToBucket(t.priority) === key),
    }));
  }, [tasksQ.data, query, hideCompleted, colsVisible]);

  const nextMsFor = (taskId: string) => nextBlockMsForTask(taskId, previewQ.data);
  const onComplete = (t: Task) => updateM.mutate({ id: t.id, patch: { status: t.status === 'completed' ? 'pending' : 'completed' } });
  const onDelete = (t: Task) => deleteM.mutate(t.id);
  const onMove = (taskId: string, to: BucketKey) => {
    const t = (tasksQ.data ?? []).find((x) => x.id === taskId);
    if (!t || priorityToBucket(t.priority) === to) return;
    updateM.mutate({ id: taskId, patch: { priority: bucketToPriority(to) } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        query={query} setQuery={setQuery}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        colsVisible={colsVisible} setColsVisible={setColsVisible}
      />
      <div className="min-h-0 flex-1 overflow-auto px-[30px] pb-10">
        {tasksQ.isLoading && <p className="text-sm text-inkSoft">Loading tasks…</p>}
        {tasksQ.isError && (
          <p className="text-sm">
            <span className="text-crit">Couldn't load tasks.</span>{' '}
            <button onClick={() => void tasksQ.refetch()} className="rounded border border-line px-2">Retry</button>
          </p>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && (
          <Board
            columns={columns} now={nowMs} nextMsFor={nextMsFor}
            onMove={onMove} onComplete={onComplete} onEdit={setEditing} onDelete={onDelete}
          />
        )}
      </div>
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Run the Priorities test to confirm pass**

Run: `npm test -w @notreclaim/web -- src/app/pages/Priorities.test.tsx`
Expected: PASS (7 tests). If the drag/drop test's `data-task-id` lookup needs the row element, note `TaskRow` already sets `data-testid="task-row"` and the closest-selector in the test resolves it.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/app/priorities/Dropdown.tsx packages/web/src/app/priorities/TaskRow.tsx \
  packages/web/src/app/priorities/TasksCard.tsx packages/web/src/app/priorities/Column.tsx \
  packages/web/src/app/priorities/Board.tsx packages/web/src/app/priorities/Toolbar.tsx \
  packages/web/src/app/pages/Priorities.tsx packages/web/src/app/pages/Priorities.test.tsx
git commit -m "feat(web): Priorities Kanban board (group, complete, search, filter, drag-reprioritize, edit/delete)"
```

---

## Task 7: Routing, retire Tasks page, final verification

**Files:**
- Create: `src/app/pages/StatsPlaceholder.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Delete: `src/app/pages/Tasks.tsx`, `src/app/pages/Tasks.test.tsx`, `src/app/tasks/TaskRow.tsx`, `src/app/tasks/TaskRow.test.tsx`

- [ ] **Step 1: Implement `src/app/pages/StatsPlaceholder.tsx`**

```tsx
import { Icons } from '../shell/icons';

export function StatsPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-[#aeb2c0]">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-card">
        <Icons.stats size={30} className="text-[#cfd2dd]" />
      </div>
      <div className="text-[19px] font-bold text-inkSoft">Stats</div>
      <div className="text-[15px]">Coming soon.</div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/app/App.tsx`** (add Priorities/Stats, redirect /tasks, drop Tasks import)

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { SignIn } from '../auth/SignIn';
import { AuthCallback } from '../auth/AuthCallback';
import { ProtectedRoute } from './ProtectedRoute';
import { AppShell } from './AppShell';
import { Planner } from './pages/Planner';
import { Priorities } from './pages/Priorities';
import { Habits } from './pages/Habits';
import { Settings } from './pages/Settings';
import { StatsPlaceholder } from './pages/StatsPlaceholder';

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Planner />} />
          <Route path="/priorities" element={<Priorities />} />
          <Route path="/stats" element={<StatsPlaceholder />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/tasks" element={<Navigate to="/priorities" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 3: Delete the retired files**

```bash
git rm packages/web/src/app/pages/Tasks.tsx packages/web/src/app/pages/Tasks.test.tsx \
  packages/web/src/app/tasks/TaskRow.tsx packages/web/src/app/tasks/TaskRow.test.tsx
```

- [ ] **Step 4: Add routing tests to `src/app/App.test.tsx`** (append inside the `describe('App routing', …)` block)

```tsx
  it('renders the Priorities board at /priorities', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/priorities'], api: authedApi() });
    expect(await screen.findByPlaceholderText(/search for something/i)).toBeInTheDocument();
  });

  it('redirects /tasks to /priorities', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/tasks'], api: authedApi() });
    expect(await screen.findByPlaceholderText(/search for something/i)).toBeInTheDocument();
  });

  it('shows the Stats placeholder at /stats', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/stats'], api: authedApi() });
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
```

The `authedApi()` helper already returns `listTasks: async () => []` and `getSchedulePreview: async () => ({ blocks: [], unscheduled: [] })`, which the Priorities page consumes. No change needed there.

- [ ] **Step 5: Run the full web suite**

Run: `npm test -w @notreclaim/web`
Expected: PASS (all suites; no references to the deleted Tasks page/row remain).

- [ ] **Step 6: Run the web build (typechecks tests too)**

Run: `npm run build -w @notreclaim/web`
Expected: build succeeds.

- [ ] **Step 7: Run the whole monorepo suite** (Postgres must be running for `@notreclaim/db`)

Run:
```bash
npm test -w @notreclaim/core
npm test -w @notreclaim/scheduler
npm test -w @notreclaim/google
npm test -w @notreclaim/db
npm test -w @notreclaim/server
npm test -w @notreclaim/web
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/pages/StatsPlaceholder.tsx packages/web/src/app/App.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): route Priorities/Stats, redirect /tasks, retire Tasks page"
```

---

## Notes for the implementer

- **Never** `import React`; use named hook imports. **Extensionless** imports only.
- Tailwind utility classes only. The two permitted inline `style` uses are the **conic-gradient avatar** (AccountMenu/TopBar) and the board's `minWidth: 'min-content'` — Tailwind can't express those cleanly. Everything else is utilities/arbitrary values.
- Keep `data-testid`s exactly as written (`task-row`, `column-<bucket>`, `task-drawer`, `new-task-modal`, `modal-error`) — tests depend on them.
- Bucket left-border / dot classes live as **literal strings** in `priorityBucket.ts` so Tailwind's content scanner emits them; do not build them by string concatenation.
- The existing `TaskDrawer` is imported from `../tasks/TaskDrawer` and reused unchanged.
- After deleting the Tasks page, double-check no other file imports `pages/Tasks` or `tasks/TaskRow` (grep before committing Task 7).
```
