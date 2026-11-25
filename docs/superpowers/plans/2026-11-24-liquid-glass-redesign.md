# Liquid-Glass Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Each `Task` below is sized for one Opus subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole web app into the "liquid glass" language from `notreclaim-redesign/` with dark + light themes on CSS-variable tokens, Manrope, a 76px rail, a new header, a rebuilt planner (single block layer, ghost/lift/spring, keyboard moves, shake, filters, Re-plan drop-in, detail card), a dialog-grade New task modal, a glass Priorities board, and restyled Stats/Habits/Buffers/Hours/Settings — while keeping every existing feature and behaviour.

**Spec (read first, binding):** `docs/superpowers/specs/2026-11-24-liquid-glass-redesign-design.md` — decisions D1–D20, token mapping §2, block matrix §3, per-screen mapping §4, interactions §5, a11y §6, reduced motion §7, non-goals §9.

**Design references (local, untracked — never `git add`):** `notreclaim-redesign/screenshots/*.png` (visual truth), `notreclaim-redesign/prototype/*.dc.html` (exact CSS in `<helmet><style>`, logic in the `Component` class), `notreclaim-redesign/design-tokens/tokens.css`.

**Tech:** React 18 + TS strict (`noUncheckedIndexedAccess`), Vite 5, Tailwind v3.4 (JIT, literal class strings only), TanStack Query v5, react-router v6, dnd-kit (lists), raw pointer events (planner blocks), luxon, vitest + jsdom + Testing Library.

## Global constraints (every task)

- **Git:** never run branch-switching or history-rewriting commands (`checkout`, `switch`, `restore`, `reset`, `stash`, `rebase`, `commit --amend`). Work on `feat/redesign`. `git add <explicit paths>` only; never add `notreclaim-redesign/`, `review/`, `seed-dev.mjs`, `.env*`, `*.tsbuildinfo`, `.claude/`. One commit per task, conventional message (`feat(web): …`, `refactor(web): …`, `test(web): …`). No attribution trailer.
- **Scope:** `packages/web` only. No API/server/db changes.
- **Suite:** baseline **843 tests / 81 files** green. `npm test -w @notreclaim/web` (script sets `TZ=UTC` — never bypass) and `npm run build -w @notreclaim/web` (type-checks tests too) must both pass at the end of **every task**, not just every phase.
- **Test policy (spec D19):** when a class assertion breaks, decide: palette/visual → replace with a role / testid / `data-*` assertion (add the `data-*` to the component); layout guarantee (`min-h-0`, `flex-1`, `overflow-y-auto`, `overscroll-contain`, `shrink-0`, `md:hidden`, `coarse:` targets) → keep it and keep the class in the new markup. Never delete a test without replacing the behaviour it pinned. Never weaken an assertion to `toBeTruthy`.
- **Tailwind:** literal utility strings only; multi-value tokens live in `@layer components` classes (`.glass`, `.btn-accent`, `.block-task`, …) defined in P1.
- **Web conventions:** extensionless imports, no `import React`, times rendered in `settings.timezone`.
- **Keep every existing feature** (spec §4 lists where each lands). If a task would drop one, stop and flag it.
- **Live verification** (whenever a task says "live"): `npm run dev -w @notreclaim/web` (restart Vite first — stale Vite state has produced false "not fixed" reports), API from `packages/server/dist` with `.env.run`, demo login via `node --env-file=.env.run seed-dev.mjs`; navigate client-side from `/` (a full-page load of `/settings` etc. hits the API proxy). Check both themes, 1440px and 390px. Compare against the matching PNG. Gestures: Firefox **and** Chromium.
- **Reduced motion:** every new animation must be covered by the global kill switch (CSS) or `usePrefersReducedMotion` (JS-driven motion).

## Phase map and parallelism

| Phase | Depends on | Can run in parallel with | Shared-file hazards |
|---|---|---|---|
| P1 Tokens/theme/font plumbing | — | nothing (foundation) | `tailwind.config.js`, `index.css`, `index.html` |
| P2 Shell | P1 | — (touches `AppShell`, `TopBar`, `icons.tsx` used by everyone) | `shell/icons.tsx` (append-only after P2) |
| P3 Planner static layout | P2 | P5, P6, P7 | `pages/Planner.tsx`, `planner/*` |
| P4 Planner interactions | P3 | P5, P6, P7 | same as P3 — **strictly sequential after P3** |
| P5 New task dialog | P2 | P3/P4, P6, P7 | `components/DurationStepper.tsx`, `PriorityPicker.tsx` (also used by drawers/Settings — P5 owns them; P7 must not edit them) |
| P6 Priorities | P2 | P3/P4, P5, P7 | `priorities/*`, `dnd/sensors.ts` (P6 owns) |
| P7 Stats/Habits/Buffers/Hours/Settings | P2 | P3/P4, P5, P6 | `components/FieldBox.tsx`, `Buttons.tsx`, `formStyles.ts`, `Sheet.tsx`, `DrawerPanel.tsx` — **owned by P2 Task 2.8**; later phases consume, do not edit |
| P8 Light-mode pass + QA | P1–P7 | — | everything (fix-ups) |

Within a phase, tasks are sequential unless marked "∥". Parallel phases must each run in their own git worktree branched from the P2 merge point and be merged back one at a time (re-run the suite after each merge). If worktrees are not used, run phases sequentially in the order P3 → P4 → P5 → P6 → P7.

Task count: P1 4 · P2 9 · P3 8 · P4 8 · P5 3 · P6 4 · P7 6 · P8 5 = **47 tasks**.

---

## P1 — Tokens, theme and font plumbing

**Goal:** the app renders on CSS-variable tokens with a working, persisted, flash-free dark/light switch (no UI for it yet beyond a dev hook) and Manrope, with **no layout change** and the suite green. Existing palette names are re-pointed at tokens, so every screen immediately themes (imperfectly) — screen phases then refine.

**Files:** `packages/web/index.html`, `packages/web/tailwind.config.js`, `packages/web/src/index.css`, new `packages/web/src/styles/tokens.css`, new `packages/web/src/theme/theme.ts`, `theme/useTheme.ts`, `theme/usePrefersReducedMotion.ts`, `src/main.tsx` (import order only), tests alongside.

### Task 1.1 — Port tokens to channel-triplet CSS variables
- [ ] Create `src/styles/tokens.css` from `notreclaim-redesign/design-tokens/tokens.css` per spec §2.1/§2.2: flat colours as `--c-*: R G B` triplets; alpha-baked colours either split (`--c-text-1` + Tailwind alpha) or kept as `--x-*` full values; gradients/shadows/borders/blur as `--x-*`; motion/radius vars verbatim. Selectors `:root, :root[data-theme="dark"]` and `:root[data-theme="light"]`; `color-scheme` per theme. Add `--c-chart-task` and the blocked-hatch vars (spec §2.1 last row). Font var = Manrope in both themes.
- [ ] Import it at the top of `src/index.css` (before `@tailwind base`) and add the reduced-motion kill switch block.
- **Accept:** file compiles through PostCSS (`npm run build -w @notreclaim/web`); every token in the design file has a counterpart (write a 10-line vitest `tokens.test.ts` that reads both files with `fs` and asserts each `--name` from the design file maps to a documented var — mapping table as a const in the test).

### Task 1.2 — Tailwind config on tokens
- [ ] `tailwind.config.js`: `colors` → `rgb(var(--c-…) / <alpha-value>)` for new names (`page`, `fg`, `fg-2`, `fg-3`, `on-accent`, `danger`, `card`, `line`, `primary`, `on-primary`, `accent`, `accent-fg`, `meeting`, `today`, `on-today`, `habit-fg`, `grid`, `now`, `toast-fg`, `chart-meet`, `chart-habit`, `chart-task`, `pri-crit|high|med|low`) **and** legacy names re-pointed (`bg→page`, `ink→fg`, `inkSoft→fg-2`, `crit/high/med/low→pri-*`, `indigo→accent`, `indigo600→accent` (hover handled by opacity), `indigoSoft→accent @ .10` via a fixed-alpha colour, `event→meeting`, `sidebar*`, `kind.*` → nearest tokens). `fg-2`/`fg-3` are fixed-alpha colours (`rgb(var(--c-text-1) / 0.66)`), so `/alpha` on them is not supported — document in a comment.
- [ ] `fontFamily.sans = ['Manrope', …]`; `borderRadius`, `boxShadow` (re-point `card/pop/modal` too), `transitionTimingFunction`, `transitionDuration`, `keyframes` + `animation` per spec §2.2 (port curves from `PlannerDark.dc.html` lines with `@keyframes`). Keep the `coarse:` plugin.
- [ ] `index.html`: swap the Mulish `<link>` for Manrope 300–700.
- **Accept:** suite green **without editing any component**. Tests that compared resolved colours (`rgb(91, 98, 227)` for category accents) are inline styles from user data — unaffected; if any test asserted a legacy palette class it still passes because the class name is unchanged. `grep -r Mulish packages/web` → 0.

### Task 1.3 — Theme runtime + pre-paint script
- [ ] `theme/theme.ts` (pure): `ThemePref`, `THEME_KEY = 'nr.theme'`, `readPref(storage)`, `writePref(storage, pref)` (try/catch, `'system'` removes the key), `resolveTheme(pref, prefersDark)`, `applyTheme(doc, theme)` (sets `data-theme` + `style.colorScheme`, adds `theme-switching` for one frame).
- [ ] `theme/useTheme.ts`: `{ pref, theme, setPref }`, subscribes to `(prefers-color-scheme: dark)` while `pref === 'system'`; uses the existing `useMediaQuery` helpers' guard for missing `matchMedia`.
- [ ] `theme/usePrefersReducedMotion.ts` (false when `matchMedia` missing).
- [ ] Inline `<script>` in `index.html` `<head>` (before CSS paint) duplicating `readPref`+`resolveTheme`+set attribute, wrapped in try/catch, default dark if everything fails. Keep it < 15 lines; add a comment pointing at `theme.ts` as the source of truth.
- [ ] `index.css` base: `body { @apply bg-page text-fg font-sans antialiased; }`, `:focus-visible` accent outline, `.theme-switching * { transition: none !important }`, scrollbar thumb on tokens (replace `#2c3046`).
- **Tests:** `theme.test.ts` (storage round-trip incl. throwing storage, system resolution both ways, apply sets attribute), `useTheme.test.tsx` with `installMatchMedia` (system follows media changes; explicit pref ignores them; listener cleanup). **Accept:** suite green; live: load app in a fresh profile with OS dark and light — no flash of the wrong theme; `localStorage.setItem('nr.theme','light')` + reload → light.

### Task 1.4 — Component-class layer
- [ ] In `index.css` `@layer components`: `.glass`, `.glass-card`, `.glass-card-hover`, `.glass-dialog`, `.btn-glass`, `.btn-primary`, `.btn-accent`, `.chip`, `.block-meeting`, `.block-task`, `.block-habit`, `.block-blocked`, `.toast`, `.hatch` — values from the prototype classes `.g`, `.gc`, `.gbtn`, `.lime`, `.chip`, `.ev-meet`, `.ev-task`, `.ev-habit`, `.toast`, Buffers hatch, all via vars. `.btn-*:active { transform: scale(.96) }`.
- [ ] A dev-only route-less sanity check is **not** added; instead a `components.css.test.ts` asserts each class name exists in `index.css` (guards accidental deletion; cheap).
- **Accept:** build + suite green; live: in devtools, toggling `data-theme` flips page background/text everywhere with no layout shift.

**P1 verification:** suite + build green; live check both themes on every route (expect odd colour pairings — acceptable until each screen phase; nothing unreadable on the Planner/Priorities in either theme — if something is, fix the legacy mapping, not the component).

---

## P2 — Shell: rail, header, theme switch, search, account, Now/Next pill, mobile chrome, banner

**Goal:** every route is framed by the new rail + header in both themes; Search works; shared primitives (buttons, field box, sheet, drawer panel) are restyled once for all later phases.

**Files:** `app/AppShell.tsx`, `app/Sidebar.tsx` (→ rail), `shell/NavItem.tsx`, `shell/Logo.tsx`, `shell/icons.tsx`, `shell/TopBar.tsx`, `shell/routeTitle.ts` (→ `routeHeader.ts`), `shell/AccountMenu.tsx`, new `shell/ThemeSwitch.tsx`, new `shell/TaskSearchPalette.tsx` + `shell/taskSearch.ts`, new `shell/ShellTaskDrawer.tsx`, new `shell/ToastProvider.tsx`, `shell/MobileTopBar.tsx`, `shell/MobileTabBar.tsx`, `shell/GoogleBrokenBanner.tsx`, `components/Buttons.tsx`, `components/FieldBox.tsx`, `components/formStyles.ts`, `components/Sheet.tsx`, `components/DrawerPanel.tsx`, `components/DrawerHost.tsx`, every page file (remove their own `<h2>` title only).

### Task 2.1 — Icons
- [ ] Append to `shell/icons.tsx`: `habits`, `buffers`, `hours`, `sun`, `moon`, `lock`, `pin`, `refresh`, `warning`, `play`, `stop`, `user`, `grip`, `chevLeft`, `chevRight` (no location pin — spec D14) — paths copied from the prototype SVGs. Keep existing names (callers untouched).
- **Accept:** `icons.test.tsx` (new) renders every icon with `aria-hidden="true"`. Suite green.

### Task 2.2 — Rail (Sidebar rewrite) + ThemeSwitch
- [ ] `Sidebar.tsx` → 76px glass capsule (`data-testid="sidebar"` kept, `aria-label="Main"` nav): logo 2×2 dots (`aria-label` "NotReclaim home", link to `/`), `role=group aria-label="Plan"` [Planner `/` end, Priorities, Stats], caption "Time" (`aria-hidden`), group "Time management" [Habits, Buffers, Hours], spacer, `ThemeSwitch`, group [Settings]. `NavLinkItem` → icon-only 46px link with `aria-label`, `data-label` CSS tooltip, `aria-current="page"` + `data-active` when active. Delete `NavSection` (and its collapse state).
- [ ] `ThemeSwitch.tsx`: `role=group aria-label="Theme"`, two buttons "Light mode"/"Dark mode" with `aria-pressed`, uses `useTheme`; spin-in animation on the newly active icon.
- **Tests:** rewrite `Sidebar.test.tsx` / `NavItem.test.tsx` around `getByRole('link', { name })` + `aria-current`; drop assertions about the collapsible "Time management" section (feature intentionally replaced by static groups — note in commit). New `ThemeSwitch.test.tsx` (click sets `data-theme` on `<html>` and persists `nr.theme`). Update `App.test.tsx` link-name queries if they relied on visible text (rail links are named by `aria-label` — same names).
- **Accept:** suite green; live both themes vs `01/02` rail; keyboard Tab reaches every rail item with visible focus; tooltips appear on focus.

### Task 2.3 — Header + route headers
- [ ] `routeHeader.ts` (pure, replaces `routeTitle.ts`; keep a `routeTitle()` wrapper for `MobileTopBar` = plain title text): returns `{ eyebrow, title: [before, bold, after] }` per spec §4.1, with Planner eyebrow from `nowMs`+`zone` ("Tuesday, November 24 · Week 48", ISO week via luxon) and Priorities eyebrow from a passed open-task count (TopBar reads `useTasksQuery`).
- [ ] `TopBar.tsx`: eyebrow 14px `text-fg-2` + `<h1>` 48px weight 300 with `<strong class="font-medium">` word; right cluster: (sidebar toggle kept, spec D20) · Now/Next pill (Task 2.5) · Search button · New task `.btn-primary` · `AccountMenu`. Header is hidden below md as today.
- [ ] Remove the per-page `<h2>` titles from `Habits`, `Buffers`, `Hours`, `SettingsForm` (the `settings-form` testid stays).
- **Tests:** `routeHeader.test.ts` (every route, unknown route fallback, week number across a year boundary in a non-UTC zone); `TopBar.test.tsx` heading assertions via `getByRole('heading', { level: 1 })` text content; page tests that looked for "Habits"/"Buffers" headings now query the TopBar-free page differently (they render pages without the shell — assert form content instead).
- **Accept:** suite green; live vs every screenshot's header.

### Task 2.4 — Account menu
- [ ] 46px round button, violet gradient, `Icons.user` glyph, `aria-label="Account menu"`, `aria-haspopup="menu"`, `aria-expanded`; glass popover `role=menu` with `role=menuitem` Settings (NavLink) and Sign out; Esc closes and returns focus; click-outside kept.
- **Tests:** existing AccountMenu behaviour (via `App.test`/`AppShell.test`) + new Esc/focus test. **Accept:** suite green.

### Task 2.5 — Compact Now/Next pill (non-planner routes)
- [ ] In `TopBar`, render the pill only when `pathname !== '/'`. Running: `chip` "Now · <title>" (`current-task`) + Stop (`stop-task`, `.btn-glass` with danger text). Next: "Next · <title> · <relative time>" (`next-task`) + Start (`next-task-start`, `.btn-accent` small). Truncate title at 24ch.
- **Tests:** update `TopBar.test.tsx`: existing Start/Stop/navigate tests run on `/priorities` (MemoryRouter initialEntries); new test: on `/` the pill is absent. **Accept:** suite green.

### Task 2.6 — Task search palette
- [ ] `taskSearch.ts` (pure): `searchTasks(tasks, query, limit=8)` — non-archived, case-insensitive substring on title (and subtask titles, ranked lower), active before backlog before completed, prefix matches first.
- [ ] `TaskSearchPalette.tsx`: glass dialog (`role=dialog aria-modal aria-label="Search tasks"`), input `role=combobox` + `aria-expanded` + `aria-controls` + `aria-activedescendant`, `role=listbox` of `role=option` rows (priority dot, title, due), ↑/↓/Enter/Esc, empty state "No tasks match". Opened by the header Search button (`aria-label="Search tasks"`, `aria-keyshortcuts="/ Control+K Meta+K"`) and by `/` / Ctrl/Cmd+K when focus is not in an editable element.
- [ ] `ShellTaskDrawer.tsx`: selecting a result opens `TaskDrawer` for that task through `DrawerHost` from `AppShell` (same props/patterns as `Planner`'s drawer: `key={task.id}`, update mutation, close on save). If a page-level drawer is open, the shell drawer replaces it (pages expose nothing new; the shell drawer simply renders above — z-50 → z-[55]).
- **Tests:** `taskSearch.test.ts`; `TaskSearchPalette.test.tsx` (opens via button and `/`, filters, keyboard selection, Esc restores focus to the Search button, selection calls `onSelect(id)`); `AppShell.test.tsx` (select → drawer with the task title visible). **Accept:** suite green; live on every route, both themes, 390px (palette full-width sheet-like).

### Task 2.7 — Toast provider (shell)
- [ ] `ToastProvider.tsx` + `useToast()`: one toast at a time, `role=status aria-live=polite` region always mounted (`data-testid="toast-region"`), `show(text, { icon?: 'lock'|'check' })`, auto-clear 2.4s (fake-timer friendly), animation class `animate-toast` (skipped when reduced motion). Mount in `AppShell`; region positioned bottom-centre above the mobile tab bar. Planner (P4) may pass a container override to anchor its toasts to the calendar panel.
- **Tests:** `ToastProvider.test.tsx` (show/replace/auto-clear with `vi.useFakeTimers`). **Accept:** suite green.

### Task 2.8 — Shared primitives restyle (owned here; later phases only consume)
- [ ] `Buttons.tsx`: `PrimaryButton` → `.btn-accent` pill (lime, `text-on-accent`, `shadow-accent`), `large` variant 46px; `SecondaryButton` → `.btn-glass` pill. `FieldBox` → `.glass-card rounded-field px-4 py-3` with 13px `text-fg-2` label. `formStyles.ts` → token classes (`text-danger` errors). `Sheet.tsx` → glass dialog surface, `bg-overlay` backdrop with `backdrop-blur-[8px]`, rounded top 26px, grabber pill on tokens. `DrawerPanel.tsx` → `.glass-dialog rounded-panel`. `DrawerHost` desktop slot classes are passed by callers — update the two Planner/Priorities call sites' `top-[84px]` to the new header height (measure live; expected ~`top-[120px]`).
- **Tests:** `Sheet.test.tsx` (17 class assertions): keep layout/behaviour ones (`fixed`, `inset-0`, `z-50`, `overflow-y-auto`, focus trap, Esc); replace colour/shadow ones with `data-testid` + role checks; add `data-full-screen` / `data-collapsed` attributes if a class assertion encoded that state. Drawer tests (`TaskDrawer`, `HabitDrawer`, `EventDrawer`) — replace palette assertions likewise.
- **Accept:** suite green; live: open TaskDrawer (Priorities), HabitDrawer, CreatePopover — readable in both themes.

### Task 2.9 — Mobile chrome + banner + frame
- [ ] `AppShell`: page `bg-page`, desktop frame `p-5 gap-5` with rail + content column; `shell-content` padding contract unchanged (`pb-[calc(56px_+_env(safe-area-inset-bottom))] md:pb-0` — `AppShell.test` pins it).
- [ ] `MobileTopBar`: glass bar on tokens, pill + Start/Stop restyled like Task 2.5 (testids unchanged), `+` button `.btn-primary` round.
- [ ] `MobileTabBar`: glass bar, active tab = accent pill behind the icon + `text-fg`, inactive `text-fg-2`; `aria-current` (NavLink default) asserted instead of `text-indigo`.
- [ ] `GoogleBrokenBanner`: glass card, `text-danger` headline, `.btn-glass` Reconnect; `role=alert` kept.
- **Tests:** `MobileTabBar.test.tsx` (6 class asserts → `aria-current`; keep `fixed`, `md:hidden`, safe-area class), `MobileTopBar.test.tsx`, `AppShell.test.tsx`, `GoogleBrokenBanner.test.tsx`. **Accept:** suite green; live at 390px both themes; safe-area padding intact (iOS simulator not required — check computed padding).

**P2 verification:** suite + build; live every route at 1440 and 390, both themes; keyboard-only pass of the shell (rail, theme switch, search, New task, account menu).

---

## P3 — Planner static layout

**Goal:** the Planner matches `01/02-planner-*.png` in both themes with the summary row, Next-up card, glass calendar panel at 60px/hr, the single block layer with the §3 visual matrix, the restyled side panel and the detail card — **interaction behaviour unchanged** (drag/resize still work through the existing `InteractiveBlock` logic, re-hosted in the single layer). P4 then upgrades the interactions.

**Files:** `pages/Planner.tsx`, `planner/WeekGrid.tsx`, `planner/weekModel.ts`, new `planner/blockLayout.ts`, new `planner/blockStyle.ts`, `planner/InteractiveBlock.tsx`, `planner/EventBlock.tsx` (deleted at end of P3), new `planner/CalendarBlock.tsx`, `planner/UnscheduledWarning.tsx` (→ `UnscheduledCard.tsx`), new `planner/NextUpCard.tsx`, `planner/PlannerTaskPanel.tsx`, new `planner/BlockDetailCard.tsx`, `planner/CreatePopover.tsx`, `planner/EventDrawer.tsx`, `tasks/TaskDrawer.tsx` (surface only).

### Task 3.1 — 60px/hr
- [ ] `weekModel.ts`: `HOUR_ROW_PX = 60` (→ `GRID_COLUMN_PX = 1440`); WeekGrid's two `h-[58px]` → `h-[60px]`; update the doc comments.
- **Tests:** `weekModel.test.ts` (58 → 60, 1392 → 1440), `InteractiveBlock.test.tsx` pixel expectations (`14.5px` → `15px`, `calc(5% + 58px)` → `+ 60px`; prefer expressing them via `minutesToPx(...)` so they never hard-code the scale again). **Accept:** suite green; live: blocks align with hour lines.

### Task 3.2 — Pure block layout for a single layer
- [ ] `blockLayout.ts`: `layoutWeek(items: {key,startMs,endMs}[], days: number[]): Map<key, {dayIndex, topPct, heightPct, leftPct, widthPct}>` — per day: filter by `startMs ∈ [d, d+24h)` (exact current rule), `placeInDay`, `layoutOverlaps`; horizontal: `leftPct = (dayIndex + lane/lanes) / N * 100`, `widthPct = 1/(lanes*N) * 100`. Export `INSET_PX = 5`, `LANE_GAP_PX = 2` and `blockLeftCss(leftPct, lane, lanes)`/`blockWidthCss(...)` returning `calc()` strings (5px inset at the day edges, 2px between lanes).
- **Tests:** `blockLayout.test.ts`: 1-, 3-, 7-day N; two overlapping blocks → halves of the right column; touching blocks share no lane; block straddling the column boundary clipped (matches `placeInDay`); out-of-range items absent. **Accept:** suite green.

### Task 3.3 — Block styling module + CalendarBlock shell
- [ ] `blockStyle.ts` (pure): `blockVariant({kind, source, pinned, started, accent})` → `{ className, style, locked, icon: 'lock'|'pin'|null, chip }` exactly per spec §3 (Google meeting locked; app event unlocked; blocked hatched; task/habit dashed; pinned adds pin icon + stronger fill; accent → inline `borderColor`/`color` for movable, `backgroundColor` no longer used since pinned stays dashed — accent on pinned = border+text like movable).
- [ ] `CalendarBlock.tsx`: positioned wrapper `data-testid="event-block"` with `data-kind`, `data-pinned`, `data-locked`, `data-source`, `data-started`, `data-selected`; inner focus target `button[data-testid="block-body"]` (aria-label per spec §5.2, `tabIndex=0`), time/title layout (row layout when < 45 min), lock/pin icon (pin = Unpin `<button aria-label="Unpin">` sibling when `onUnpin`), hover × (`aria-label` "Delete block"/"Delete event"; coarse always visible), resize handle sibling. **This task renders static blocks only** (no pointer logic yet); `InteractiveBlock` keeps owning drag in Task 3.4.
- **Tests:** rewrite `EventBlock.test.tsx` as `CalendarBlock.test.tsx` + `blockStyle.test.ts`: the 37 class asserts become `data-*` + icon presence (`getByRole('button', { name: 'Unpin' })`, lock icon via `data-icon="lock"`) + accent inline-style asserts (kept — they are user data). Keep the coarse "delete always visible" assertion via a `data-always-visible` attr or by asserting the `hidden group-hover:flex` absence (layout-ish; either is fine — prefer the attribute). **Accept:** suite green.

### Task 3.4 — WeekGrid single layer + InteractiveBlock re-host
- [ ] `WeekGrid`: background day columns keep `day-col-i` (click-to-create, `DayDropZone`, tint `data-drop-target` instead of `bg-indigoSoft/60`, today column tint, grid lines via `repeating-linear-gradient` on `--c-grid`), plus **one** `data-testid="block-layer"` absolute layer over the columns rendering every item via `layoutWeek`, keys `b:<id>`/`e:<id>`. Interactive items → `InteractiveBlock` (now rendering through `CalendarBlock` for its markup and passing pointer handlers to the wrapper); Google events + (unchanged behaviour) → `CalendarBlock` static. `colWidth` for cross-day drag = `layer.getBoundingClientRect().width / days.length` (was `parentElement` width — the parent is now the layer). Now-line + pulsing dot drawn in the layer on today's column (`now-line` testid kept). Task drop indicator and CreatePopover stay inside the day column.
- [ ] Toolbar/header restyle (spec §4.2): glass round prev/next (`aria-label` "Previous"/"Next" kept for tests, add `title`), range label, Today `.btn-glass`, legend → static Locked/Blocked chips (filters arrive in P4), panel toggle kept. Day header: DOW caps + 40px round number, today `bg-today text-on-today` (`data-today` already exists). Card → `.glass rounded-panel`.
- **Tests:** `WeekGrid.test.tsx` (33 asserts): `style.top` assertions now target blocks in the layer (same `%` values); add `left/width` expectations through `blockLayout` helpers; `bg-indigoSoft/60` → `data-drop-target`; blocked tile `bg-slate-100` → `data-kind="blocked"`; keep scroll-container and toolbar layout-guarantee asserts (`overflow-y-auto`, `overscroll-contain`, `md:overscroll-auto`, `min-h-0`, `flex-1`, `flex-wrap md:flex-nowrap`, `shrink-0`, legend `hidden md:flex`, `min-w-0 overflow-hidden max-h-[22px]` — adapt the max-h if the legend height changes, keeping the clip). `InteractiveBlock.test.tsx`: mount inside a fake layer; cross-day `translate(120px…)` math uses layer width / N. **Accept:** suite green; live: drag within a day, across days, resize, delete ×, Unpin, click-to-create, drag-from-panel all work exactly as before (Firefox + Chromium), at 1, 3 and 7 days, with `dayStartMinute=180`, overlap lanes side by side.

### Task 3.5 — Summary row: UnscheduledCard + NextUpCard
- [ ] `UnscheduledCard.tsx` (replaces `UnscheduledWarning.tsx`; reuse `summarizeUnscheduled` — extend `UnscheduledEntry` with `title` + `detail` so chips render "Check I94 · 30m left"): spec D12/§4.2. Testids: `unscheduled-warning` (root, `role=status`), `unscheduled-count`, `unscheduled-chip`, `unscheduled-more` (calls `onShowAll`), `replan-button` (owns `onReplan`/`replanPending`; label "Re-plan"/"Re-planning…"). Zero state copy. Compact: 1 chip.
- [ ] `NextUpCard.tsx`: spec §4.2/D7 using `useNowNextControls(now)` + `pickCurrentOrNext`; also computes the following block (next after `nextBlock`) for line two; "in 1h 29m" chip from a small pure `untilLabel(ms, now)` (in `lib/duration.ts`). Testids: `next-up-card`, `next-task-start`, `stop-task`, `current-task`, `next-task` (reused names — TopBar hides its pill on `/`, so no duplicates).
- [ ] `Planner.tsx`: summary row above `[grid | panel]` with the same flex split; Re-plan wiring moves here (remove `onReplan`/`replanPending` from `WeekGrid` props); error line "Re-plan failed. Try again." kept under the card. Compact: summary card only (no Next-up card).
- **Tests:** rename/rewrite `UnscheduledWarning.test.tsx` → `UnscheduledCard.test.tsx` (keep: role=status, self-clearing → now zero-state, "+N more" behaviour, compact 1 chip); `unscheduledSummary.test.ts` updated for new fields; `NextUpCard.test.tsx` (next / running / empty, Start/Stop call the mutations); `Planner.test.tsx` replan button now found in the card; `WeekGrid.test` drops Re-plan assertions (`shrink-0` re-plan layout assert moves to the card test). **Accept:** suite green; live vs `01/02`.

### Task 3.6 — Side panel restyle + All tasks by due + Show more
- [ ] `PlannerTaskPanel.tsx` per spec §4.2: glass panel, `role=tablist` with `role=tab aria-selected` "Priorities"/"All tasks" (arrow-key roving), group headers (glowing dot `shadow-[0_0_8px]` in priority colour, uppercase label, count), tiles (check circle with pop, title, `panel-at-risk` warning icon `role=img aria-label="Not scheduled"`, "Due Sep 10"/"No deadline", 3px progress bar `panel-progress`, "0m / 1h", duration chip), hover ✎/× kept (coarse visible), dnd-kit draggable kept (`panel-task`, `role=group`, `tabIndex=-1`). Show-more: first 5 per group, `panel-show-more-<bucket>` button "Show N more" toggles the rest. All tasks: sort by due (undated last), tie → priority → title; each row shows priority dot + short label. Expose `tab`/`onTabChange` as optional controlled props so the summary card's "+N more" can switch to All tasks.
- **Tests:** `PlannerTaskPanel.test.tsx` (9 class asserts → roles/`aria-selected`/testids); new tests for show-more and due sort. **Accept:** suite green; live vs `01/02` side panel, drag a card onto the grid still works.

### Task 3.7 — Selection + BlockDetailCard
- [ ] `Planner.tsx`: `selectedKey` state (spec §5.4); `WeekGrid` gets `selectedKey` + `onSelect(key)`; `CalendarBlock` body click → `onSelect` on fine pointers at md+ (coarse/compact keeps today's tap-opens-drawer path, spec §5.2). **Post-drag click swallow:** `InteractiveBlock` already calls `onClick` only for zero-delta presses — keep that contract and route it to `onSelect`; add a test that a real drag does not select.
- [ ] `BlockDetailCard.tsx` per spec §5.4 (chip from `blockVariant().chip`, title, long day, Time + Duration tiles, task extras, primary Open task/Open event/Open habits, secondary Unpin/Stop/Delete, ✕ `aria-label="Close details"`), rendered at the top of the side column (above the panel; when the panel is hidden, alone in the side column). Esc deselects. Deleting/unpinning updates through existing mutations.
- **Tests:** `BlockDetailCard.test.tsx` (each block type → chip + actions per matrix; Google meeting has no Unpin/Delete; Open task calls `onOpenTask(taskId)`), `Planner.test.tsx` (click block → card; ✕/Esc closes; Open task → TaskDrawer; drag does not select). **Accept:** suite green; live.

### Task 3.8 — Planner surfaces sweep + EventBlock removal
- [ ] Restyle `CreatePopover` (glass popover, segmented Event/Task/Blocked `role=radiogroup` or keep current buttons with `aria-pressed`, token inputs), `EventDrawer`/`TaskDrawer` surfaces (layout untouched), drag-from-panel `DragOverlay` (glass + `rotate(-1.5deg)`), task drop indicator `bg-accent`, loading/error states on tokens. Delete `EventBlock.tsx` (all callers migrated) and the legacy `variantClass/accentStyle/BASE/DELETE_BTN_CLASS` exports.
- **Tests:** `CreatePopover.test.tsx` (12 asserts) and drawer tests → behaviour/data assertions. `grep -rn "EventBlock" packages/web/src` → 0. **Accept:** suite green; live full Planner pass both themes, 1440/390, keyboard reachability of every block body.

**P3 verification:** suite + build; live regression list: drag/resize (mouse + touch emulation), long-press on touch, edge auto-scroll, header swipe, click-to-create (desktop popover + compact sheet), delete ×, Unpin, drag-from-panel incl. compact sheet collapse, Start/Stop from Next-up, panel hide toggle, Google-broken banner, category accents, subtask labels on blocks, dayStartMinute=03:00, tz ≠ browser tz.

---

## P4 — Planner interactions

**Goal:** the motion and input model of `specs/interactions.md §1`, adapted per spec §5 — and the R10/R11 release-jump class of bug must not return.

**Files:** `planner/InteractiveBlock.tsx` (→ thin wrapper or deleted), new `planner/useBlockDrag.ts`, new `planner/dragModel.ts` (pure), new `planner/blockKeyboard.ts` (pure), `planner/CalendarBlock.tsx`, `planner/WeekGrid.tsx`, `pages/Planner.tsx`, new `planner/replanDiff.ts`, new `planner/usePlannerFilters.ts`, `planner/PlannerToast` usage of `useToast`.

### Task 4.1 — Pure drag model
- [ ] `dragModel.ts`: `moveTarget({origDay, origStartMin, durationMin, dx, dy, colWidth, dayCount, scale})` → `{dayIndex, startMin}` (snap15, clamp to window and days); `resizeTarget({startMin, origEndMin, dy})` → `{endMin}` (min 15, max window end); `ghostLabel(...)` ("Sat · 12:15 AM" / "1h 15m · ends 9:15 PM", zone-aware via `formatHm`/`weekdayLabel`); `pastThreshold(dx, dy, 5)`.
- **Tests:** `dragModel.test.ts` exhaustive (edges, negative deltas, DST day via zone, render scale ≠ 1). **Accept:** suite green.

### Task 4.2 — useBlockDrag: follow-pointer drag, ghost, lift, spring release
- [ ] Extract the pointer machinery from `InteractiveBlock` into `useBlockDrag` (keep: long-press arming, first-pointer-wins capture, `blockTouchScroll`, edge auto-scroll + scroll compensation, tap detection). New visuals: raw-pointer `translate(dx,dy) scale(1.05) rotate(-0.8deg)` with transitions off while dragging (`data-dragging`), `shadow-lift` + accent ring; ghost element (`drag-ghost`, `drag-label`) rendered by `WeekGrid` in the layer at the snapped target (140ms top/left ease). Release: commit via existing callbacks, then render `left/top` = target, transform = none, transition `left,top,transform` `duration-move ease-spring` **in the same commit**; hold the target locally until props match (safety timeout 1.5s → spring back). Delete the `heldMove/heldDay/landing` state.
- **Tests:** rewrite `InteractiveBlock.test.tsx` (34 asserts) as `useBlockDrag`/`CalendarBlock` tests: during drag the ghost's `style.top/left` equals the snapped target (was: block transform snapped); block transform contains `scale(1.05)`; release fires one commit with the right ISO times (keep every existing commit-math test: same-day, cross-day zone-aware, clamp at window, no-op release, tap → onClick, second pointer ignored, long-press cancel on travel, edge-scroll compensation); after props update the wrapper has no transform and carries `data-settling` until `transitionend`. **Accept:** suite green; **live (both browsers):** release never jumps back to the origin; cross-day move animates horizontally; rollback (kill the API mid-drag) springs back.

### Task 4.3 — Resize with ghost + spring
- [ ] Bottom-edge handle: hover grip pill (22px → 30px while resizing), window listeners, height follows pointer exactly, ghost shows snapped height + label, release → `duration-resize ease-spring-strong` settle; coarse 24px target rule kept (`resizeHandleClass`).
- **Tests:** resize tests migrated (min 15, window clamp, zero-delta no-op, label text). **Accept:** suite green; live vs `04-planner-dark-resizing.png`.

### Task 4.4 — Keyboard move/resize
- [ ] `blockKeyboard.ts` (pure): key + shift + current `{dayIndex,startMin,endMin}` + bounds → new interval or `{edge:'left'|'right'}` or `null`. `CalendarBlock` body `onKeyDown`: arrows/Shift+arrows on movable blocks → instant local preview + **debounced (400ms) single commit** through the same `onCommit`/`onCommitEvent`; focus stays on the block (stable key); Enter/Space select; Escape deselect; Delete → `onDelete`. Edge → toast "Use the arrows above to see more days". Spring animations apply (same transition classes).
- **Tests:** `blockKeyboard.test.ts`; component test: three ArrowDown presses → one commit 45 min later (fake timers), focus retained after rerender with new props; ArrowRight crosses day. **Accept:** suite green; live keyboard-only move/resize persists after reload.

### Task 4.5 — Locked shake + toast
- [ ] Google meetings: pointerdown or arrow keys → `data-shake` bump re-triggering `animate-shake` (450ms) + `useToast().show("Locked — synced from Google Calendar", {icon:'lock'})`; Planner anchors its toasts inside the calendar panel (absolute bottom-centre). No capture/drag for locked blocks.
- **Tests:** shake attribute toggles; toast text appears in `toast-region`; no `onCommit`. **Accept:** suite green; live.

### Task 4.6 — Meetings / Movable filters
- [ ] `usePlannerFilters()` (persisted `nr.plannerFilters`, try/catch). Toolbar toggle pills (`aria-pressed`, swatch solid violet / dashed lime). Hidden blocks: `data-hidden`, fade/scale-out classes, `pointer-events-none`, body `tabIndex=-1`, wrapper `aria-hidden` — not unmounted. Selected block hidden → deselect.
- **Tests:** `usePlannerFilters.test.ts`; WeekGrid test: toggling Meetings sets `data-hidden` on event blocks only and removes them from tab order. **Accept:** suite green; live.

### Task 4.7 — Re-plan loading + drop-in
- [ ] `replanDiff.ts` (pure): `newBlockIds(before: Set<string>, after: ScheduledBlock[], range)`, `dropInDelays(ids, blocks)` (180ms stagger by start). `Planner`: snapshot ids at click; after `replan` success, wait for the schedule query's next `dataUpdatedAt`, diff, set `newKeys` → blocks get `data-new` + `animate-land` with inline `animationDelay`; clear after the longest delay + 900ms (immediately under reduced motion). WS refetches never set `newKeys`. Button spinner + "Re-planning…" with 600ms minimum.
- **Tests:** `replanDiff.test.ts`; `Planner.test.tsx`: mock replan → refetch returns an extra block → that block has `data-new`, pre-existing ones don't; a WS-style invalidate without replan sets nothing. **Accept:** suite green; live vs `03-planner-dark-dragging-and-replanned.png`.

### Task 4.8 — Entrance motion + polish
- [ ] Panels `animate-rise` with 60ms stagger (route mount only); blocks `animate-ev-in` staggered 45ms × dayIndex on first data and on paging (gate with a ref keyed by the range); pulsing now dot; checkbox pop + strike-draw in the side panel; Re-plan icon hover rotate; `active:scale-[.96]` on buttons; theme-switch transition suppression verified on the planner.
- **Tests:** light — assert `data-entering` attributes appear on first render and not after a refetch. **Accept:** suite green; live with OS reduced-motion ON: nothing animates, drag/resize still commit, toasts still announce.

**P4 verification:** suite + build; full live gesture matrix (mouse, touch emulation, keyboard) × (task, pinned task, habit, app event, blocked, Google meeting) × (1/3/7 days) × both themes; the P3 regression list again.

---

## P5 — New task dialog

**Goal:** `NewTaskModal` matches `05/06-new-task-dialog-*.png` and the a11y/motion contract of `specs/interactions.md §3`, still creating a real task with every existing field.

**Files:** `shell/NewTaskModal.tsx`, `components/DurationStepper.tsx`, `components/PriorityPicker.tsx` (P5 owns both; their other callers — TaskDrawer, HabitDrawer, CreatePopover, SettingsForm — pick up the restyle automatically), `shell/AppShell.tsx` (focus-return wiring only), `planner/PlannerTaskPanel.tsx` (fresh glow — coordinate: if P3/P4 run in parallel, do this one-line attribute in P5 *after* merging P3).

### Task 5.1 — Stepper + priority picker restyle
- [ ] `DurationStepper`: 22px value (tabular), 34px round `.btn-glass` −/+ buttons (`aria-label` unchanged: "decrease …"/"increase …"), `size` prop still honoured for icon size; coarse padding rules kept.
- [ ] `PriorityPicker`: 2×2 pills 36px, dot + first word, selected inverted (`bg-fg text-page`), `role=radiogroup aria-label="Priority"` with `role=radio aria-checked` and roving tabindex + arrow keys (was `role=group` + `aria-pressed`).
- **Tests:** `DurationStepper.test.tsx`, `PriorityPicker.test.tsx` (`aria-pressed` → `aria-checked`, arrow-key test added); grep other tests for `aria-pressed` on priority chips (`NewTaskModal.test`, `TaskDrawer.test`) and update. **Accept:** suite green; live in NewTaskModal, TaskDrawer, Settings steppers.

### Task 5.2 — Dialog structure, a11y and motion
- [ ] `NewTaskModal`: `role=dialog aria-modal="true" aria-labelledby` → "New task" `<h2>`; ✕; Esc closes; backdrop click closes; Cancel button (new); focus trap (reuse `Sheet`'s trap helper or a small `useFocusTrap`); focus returns to the opener (AppShell stores `document.activeElement` on open). Enter in the name field submits when valid. Close = add `data-closing` → `animate-modal-out` + backdrop `animate-bd-out` 220ms → unmount (immediate under reduced motion). Open = `animate-bd-in` + `animate-modal-in` (spring 500ms), backdrop `bg-overlay backdrop-blur-[8px]`.
- [ ] Layout per spec §4.3: name box (smiley, 60px, violet focus ring), 2-col grid Duration | Priority, Split up custom checkbox → reveals Min/Max (`expand` animation; not rendered when off), Hours field (select + "+ New" inline category creation kept — testids `category-select`, `new-category-btn`, `new-category-name`, `new-category-confirm`), Schedule after / Due date (`schedule-after`, `due-date`, hint text kept), error `modal-error`, footer Cancel + Create (`.btn-accent`, disabled until valid). Mobile keeps near-full-screen.
- **Tests:** `NewTaskModal.test.tsx` (14 class asserts): replace visual ones; add Esc / backdrop / Cancel / Enter-submit / focus-return / `role=dialog` tests; Split-off now means min/max steppers **absent** (was disabled) — update those assertions; keep chunk/zone reseed tests untouched. **Accept:** suite green; live vs `05`/`06`, keyboard-only create.

### Task 5.3 — After-create feedback
- [ ] On success: `useToast().show('Task created', {icon:'check'})`; the planner side panel marks the new task's tile `data-fresh` (1.3s `animate-fresh` glow) — pass the created id through a tiny shell context (`useRecentlyCreated`) rather than prop-drilling; the unscheduled count updates via the existing invalidations.
- **Tests:** NewTaskModal → toast text; PlannerTaskPanel tile with `data-fresh` when the context id matches. **Accept:** suite green; live.

---

## P6 — Priorities board

**Goal:** `07-priorities.png` look with Backlog + Completed as extra glass columns, Filter/Columns menus, and dnd-kit motion approximating `specs/interactions.md §2`.

**Files:** `pages/Priorities.tsx`, `priorities/Board.tsx`, `priorities/Column.tsx`, `priorities/TaskRow.tsx`, `priorities/TasksCard.tsx`, `priorities/Toolbar.tsx`, `priorities/Dropdown.tsx`, `priorities/useFlip.ts`, `priorities/boardPane.ts`, `priorities/priorityBucket.ts` (meta classes → tokens), `dnd/sensors.ts` (owned by P6; touch activation unchanged).

### Task 6.1 — Toolbar + menus
- [ ] Glass search field (`aria-label="Search tasks"` kept, placeholder "Search tasks…"), Filter / Columns `.btn-glass` pills, glass dropdown menus (`Dropdown.tsx`: `aria-haspopup`, `aria-expanded`, Esc closes, `role=menuitemcheckbox aria-checked` rows). Priorities eyebrow count comes from the header (P2) — nothing here.
- **Tests:** `Toolbar.test.tsx` (9 asserts) → roles/`aria-checked`; keep the md width/`min-w-0` layout asserts. **Accept:** suite green.

### Task 6.2 — Columns + cards restyle
- [ ] `Column`: glass panel, header glowing dot + name + count chip + chevron collapse (`aria-expanded`, `aria-label` "Collapse High priority"); collapsed = header-only narrow card; empty state dashed "Drop tasks here"; Backlog dot neutral, Completed dot `pri-low`. `priorityBucket.ts` META → token classes (`bg-pri-crit`…, backlog `bg-fg-3`). Board layout: `grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5` when the pane is ≥ 6×260+gaps, else keep the horizontal snap pane (`boardPane.ts` contract unchanged).
- [ ] `TaskRow`: `.glass-card rounded-card`, 6-dot grip (`aria-label="Drag <title>"`, the touch activator), check circle (pop), title 2-line clamp + strike-draw when done, "Due 9/10" + `subtask-count` `0/1`, duration chip, kebab menu (Edit/Delete) on glass; card subtasks checklist kept (nested dnd-kit kept). Drop the coloured left border (dot carries priority) — keep `data-bucket`.
- **Tests:** `TaskRow.test.tsx` (12 asserts), `Priorities.test.tsx` (8): replace `border-l-*`/opacity classes with `data-bucket`, `data-muted`, `data-done`, `data-dragging`. **Accept:** suite green; live vs `07` (dark) and derived light.

### Task 6.3 — DnD motion with dnd-kit
- [ ] `DragOverlay`: clone of the card (title + meta) `rotate(-1.5deg) scale(1.03)`, accent ring, `shadow-lift`; `dropAnimation` = `{ duration: 520, easing: 'cubic-bezier(.34,1.4,.5,1)', sideEffects: defaultDropAnimationSideEffects(...) }` (instant under reduced motion). Source card while dragging = placeholder (`data-placeholder`, dashed accent border, contents `invisible`, same height). Hovered column: accent border (`data-drop-target`). Dropping onto a collapsed column expands it. `useFlip` → `duration 240ms`, `easing var(--ease-out)` literal, skipped under reduced motion. Keyboard: grip focus, ↑/↓/←/→ via existing `boardKeyboardCoordinates`; announcements "Moved X to High priority, position 2" (extend `boardDropTargetName`/`makeAnnouncements` onDragEnd text if needed).
- **Tests:** `boardDnd.test.ts` unchanged logic (+ announcement string test); `Priorities.test.tsx` keyboard drag (KeyboardSensor in jsdom works) moves a card to the next column and calls PATCH with the new priority; collapsed-column-expands test. **Accept:** suite green; live: mouse, touch (grip), keyboard; landing spring visible; `sortOrder`/priority persisted after reload.

### Task 6.4 — Priorities page polish
- [ ] Loading/error/empty states on tokens; TaskDrawer host slot `top-[…]` aligned with the new header (P2 measured value); the board pane scroll/snap still un-snaps during drag (`boardPane.ts` test).
- **Accept:** suite green; live 390px (horizontal snap, one column visible, grip drag works).

---

## P7 — Stats, Habits, Buffers, Hours, Settings

**Goal:** screens 08–12 in dark; light derived from tokens. Each task is independent (∥) once P2 is merged; they touch disjoint files except shared primitives owned by P2/P5 (do not edit those here).

### Task 7.1 ∥ — Stats
- [ ] `StatCard` (64px light number + small unit, sub, swatch for meetings, progress bar for Tasks done), `HoursByDayChart` (stacked meetings/habits/tasks with `chart-*` tokens, 2px gaps, 4px rounded tops, y-axis ticks from max, value labels, hover/focus tooltip, bars `animate-grow` staggered 50ms), Chart|Table segmented `role=tablist` (table = `<table>` with caption, per-day rows incl. totals), `TimeSplitDonut` (SVG donut, centre total, draw-in, legend rows with hours + %). `Stats.tsx` layout per `08`. `statsModel` unchanged (add a `tableRows` selector if useful).
- **Tests:** `StatsComponents.test.tsx` (8 asserts), `Stats.test.tsx` (4): palette → `data-series`; new: Table tab renders a row per day with the same numbers as the chart labels. **Accept:** suite green; live vs `08`; light-theme chart colours re-validated for contrast/CVD separation (dataviz skill, P8 records results).

### Task 7.2 ∥ — Habits
- [ ] Summary strip (active / hours per week / paused, pure `habitSummary(habits)` in `habitForm.ts` or new `habits/habitSummary.ts`), `QuickAdd` glass input + lime Add (`aria-label` on the input), `HabitRow` per spec §4.6 (read-only day pills `S M T W T F S` with `aria-hidden` + sr-only "Days: …", "any day" when all 7, Paused chip, `habit-at-risk` ⚠ chip, Edit/Pause|Resume/✕ with inline confirm kept), `HabitDrawer` host: glass dialog over `bg-overlay`.
- **Tests:** `HabitRow.test.tsx`, `Habits.test.tsx` (2 asserts), `HabitDrawer.test.tsx` (7) → data/roles; `habitSummary.test.ts`. **Accept:** suite green; live vs `09`.

### Task 7.3 ∥ — Buffers
- [ ] Two glass cards with − / editable number / + (5-min steps, floor 0, no upper clamp; testids `meeting-buffer`, `task-buffer` stay on the inputs; `aria-label`s "Decrease buffer around meetings" etc.), helper text, `BufferPreview` (hatched buffer — meeting — hatched buffer — dashed task — gap line — dashed task; widths `transition-[width] duration-reflow`; legend "Buffer · N min", "Gap · N min"), Save `.btn-accent` + `saved` / new `unsaved` status, `form-error`.
- **Tests:** `Buffers.test.tsx` (+ stepper and unsaved-status tests; validation tests unchanged). **Accept:** suite green; live vs `10`.

### Task 7.4 ∥ — Hours
- [ ] `Hours.tsx` + `CategoriesSection.tsx` per spec §4.8: "Categories" caption, glass card per category (name input `cat-name-*`, Default / Follows Settings / "Nh per week" chips [pure `weeklyHoursTotal(windows)` in `weeklyHours.ts`], Delete), colour swatches `role=radiogroup` / `role=radio aria-checked` (testids `cat-color-*` kept; palette hexes are data, stay inline), default category custom-hours checkbox + Settings link note, `WeeklyHoursEditor` restyle with a 24h coverage bar per row (`data-testid` `${idPrefix}-${wd}-bar`, left/width from start/end) and 12a/6a/12p/6p/12a ticks, Save hours `.btn-accent`, dashed full-width "+ Add category" (`add-category`). `WeeklyHoursEditor` is shared with Settings — this task owns it (Task 7.5 consumes).
- **Tests:** `CategoriesSection.test.tsx`, `categoryForm.test.ts` unchanged logic; swatch `aria-checked`; coverage bar geometry; total chip. **Accept:** suite green; live vs `11`.

### Task 7.5 — Settings (after 7.4: shares `WeeklyHoursEditor`)
- [ ] `Settings.tsx` + `SettingsForm.tsx`: 2-col grid (Working hours card with weekly total | Timezone card + Planner card), full-width Scheduling card (horizon, Min/Max chunk steppers, require-start checkbox), Save kept (testids `save`, `saved`, `form-error`, `timezone`, `day-start`, `horizon`, `require-start`); new **Appearance** card: segmented System / Light / Dark (`role=radiogroup`, `useTheme`); `AccountSection` glass restyle (`google-broken`, `google-connected`, `google-link-error` kept); mobile link rows + `mobile-account-row` + `app-version` footer kept.
- **Tests:** `SettingsForm.test.tsx` (2), `Settings.test.tsx` (4), `AccountSection.test.tsx`; new Appearance test (sets `data-theme`, System clears `nr.theme`). **Accept:** suite green; live vs `12`.

### Task 7.6 ∥ — Auth pages + leftovers
- [ ] `SignIn`, `Register`, `AuthCallback`, `ProtectedRoute` loading state: glass card on `bg-page`, `.btn-accent`, token inputs. Sweep remaining raw palette literals in non-test source: `grep -rnE "#[0-9a-fA-F]{6}|text-red-|bg-blue-|text-gray-|border-gray-|text-green-|amber-|slate-" packages/web/src --include=*.tsx | grep -v test` → only category/user-data colours may remain (document each survivor in the commit message).
- **Tests:** `SignIn.test.tsx`, `Register.test.tsx` unaffected or data-attribute updates. **Accept:** suite green; live sign-in in both themes (pre-paint script works on `/signin`).

**P7 verification:** suite + build; live each screen at 1440 + 390 in both themes against its PNG.

---

## P8 — Light-mode pass and QA

**Goal:** every screen is correct in light mode, accessible, motion-safe and phone-safe; legacy palette names removed.

### Task 8.1 — Light-mode pass
- [ ] Walk every route + every overlay (drawers, popover, palette, dialog, sheets, menus, toasts, detail card, drag ghost) in light; compare the planner to `02/06`, derive the rest in the same tone (white glass panels, `bg-page #E3E4E7`, olive `accent-fg` for lime text, black primary). Fix token values only in `tokens.css` where a light value is wrong; component edits only for wrong token *choice* (e.g. lime text that should be `accent-fg`). Re-validate `--chart-*` light values (dataviz skill palette validator) and record results in the commit.
- **Accept:** written checklist in the PR description; suite green.

### Task 8.2 — Legacy palette removal
- [ ] Remove legacy colour names from `tailwind.config.js` (`indigo`, `indigo600`, `indigoSoft`, `sidebar*`, `bg`, `ink`, `inkSoft`, `crit/high/med/low`, `event`, `kind.*`) once `grep` finds no usage; migrate stragglers to semantic names. Keep `card`/`line` only if they ended up as real tokens.
- **Accept:** build fails on none; suite green; `grep` evidence in commit message.

### Task 8.3 — Accessibility + keyboard-only pass
- [ ] Keyboard-only: rail → header (search, new task, account) → planner (filters, every block body, keyboard move/resize, detail card, panel tabs, show-more) → priorities (grip drag) → each page; focus always visible, no traps except dialogs, focus returns correctly. Run the a11y-debugging skill (Lighthouse a11y + contrast) on every route in both themes; fix contrast < 4.5:1 for text. Verify every icon-only button has a name (`grep -n "aria-label" -L` style audit + axe in devtools).
- **Accept:** findings + fixes listed in the commit; suite green.

### Task 8.4 — Reduced motion + 390px
- [ ] OS reduced-motion ON: no animation anywhere (entrance, drop-in, shake, FLIP, modal, toast, theme icon spin), all features still work. 390px: every route, every overlay, planner 1-day view, sheets, tab bar safe area, no horizontal page scroll (except the Priorities snap pane and the planner's own scrollers by design).
- **Accept:** checklist recorded; suite green.

### Task 8.5 — Screenshot comparison + final verification
- [ ] Seed demo data approximating the design (dev DB only), capture 1440px screenshots of every screen/state matching `notreclaim-redesign/screenshots/01–12` (dark, plus light for 02/06 and derived light for the rest) with the chrome-devtools or playwright tools; compare side by side; fix spacing/type/colour gaps that are not explained by real data or spec deviations (§9 non-goals, D11 window, D12 zero-state). Store captures under `review/` (untracked).
- [ ] Final: `npm test` (all workspaces), `npm run build`, web suite count reported vs baseline 843, `git status` clean apart from known untracked local files.
- **Accept:** README acceptance checklist (`notreclaim-redesign/README.md`) walked item by item with evidence; deviations listed with the spec section that justifies them.

---

## Phase exit checklist (every phase)
- [ ] `npm test -w @notreclaim/web` green; count reported (never lower than the previous phase unless a removed test was replaced — explain).
- [ ] `npm run build -w @notreclaim/web` green.
- [ ] Live check per the phase's verification list, both themes, 1440 + 390; Vite restarted first.
- [ ] No branch switching / history rewriting happened; only intended paths committed.
- [ ] Spec deviations found during the phase are written back into the spec's Open questions (not silently implemented).
