# Liquid-Glass Redesign — Design

**Status:** approved for planning (owner decisions 1–7 binding, orchestrator defaults applied).
**Plan:** `docs/superpowers/plans/2026-11-24-liquid-glass-redesign.md`
**Design handoff (local only, never committed):** `notreclaim-redesign/` — `README.md`, `specs/screens.md`, `specs/interactions.md`, `design-tokens/tokens.css`, `screenshots/01–12*.png`, `prototype/*.dc.html` (exact CSS values + interaction logic).
**Scope:** `packages/web` only. No server, db, core, scheduler or Google changes. No new endpoints.

## 0. Baseline (survey 2026-11-24, branch `feat/redesign` @ 7e4220e)

- Web suite: **843 tests / 81 files**, green (`npm test -w @notreclaim/web`, TZ=UTC).
- `tailwind.config.js`: fixed hex palette (`indigo`, `indigo600`, `indigoSoft`, `sidebar*`, `bg`, `card`, `line`, `ink`, `inkSoft`, `crit/high/med/low`, `event`, `kind.*`), `fontFamily.sans = Mulish`, shadows `card/pop/modal`, keyframes `pop/fade`, custom `coarse:` variant. No dark mode, no CSS variables, no reduced-motion handling. `index.css` hard-codes `.dark-scroll` thumb `#2c3046`. ~18 hard-coded hex values remain in non-test `.tsx` (category palette, avatar gradient, gutter label `#a6aab8`, grid line `#f1f2f6`, empty-column `#aeb2c0`, …).
- Shell: `AppShell` = `Sidebar` (280px, dark, hidden below md, optional hide toggle `nr.sidebarHidden`) + `TopBar` (route title from `routeTitle`, Now/Next pill + Start/Stop via `useNowNextControls`, "New Task", **disabled** Search placeholder, `AccountMenu` [Settings, Sign out] with a conic-gradient avatar) + `MobileTopBar` + `GoogleBrokenBanner` + `MobileTabBar` + `NewTaskModal`.
- Planner: `pages/Planner.tsx` owns queries, drawers (`TaskDrawer`/`EventDrawer` in a fixed `right-3 top-[84px]` slot via `DrawerHost`), a dnd-kit `DndContext` for drag-from-panel (`PlannerTaskPanel` → day column → pinned block), `UnscheduledWarning` (amber strip, `role=status`). `WeekGrid` renders toolbar + legend + Re-plan + panel toggle, a pinned day header (header swipe paging), and a 24h vertically scrolling body (`hours-scroll`), with **one absolutely-positioned layer per day column**; blocks are `InteractiveBlock` (tasks/habits/app events: raw pointer drag/resize, long-press on touch, edge auto-scroll, held-preview + `landing` transition bridge, hover ×, 🔒 Unpin) or `EventBlock` (Google events, blocked time). Geometry in `weekModel.ts` (`HOUR_ROW_PX = 58`, `GRID_COLUMN_PX = 1392`, `daysThatFit`, `dayAnchor`/`dayStartMinute`, zone-aware labels). Overlaps via `overlapLayout.layoutOverlaps` (`leftPct/widthPct` inside the column).
- Priorities: dnd-kit board (`Board`/`Column`/`TaskRow`/`TasksCard`, `boardDnd.ts`, `useFlip`), 4 priority columns + Backlog + Completed, Toolbar with search, Filter (Hide completed), Columns menus. KeyboardSensor already wired (`boardKeyboardCoordinates`).
- Data facts: `POST /schedule/replan` returns counts only; `CalendarEvent` has **no location**; `AuthContext`/`tokenStore` hold only `token` + `userId` (no email/name); `CalendarEvent.source: 'app'|'google'`, `kind?: 'event'|'blocked'`; `ScheduledBlock.pinned`, `startedAt`.
- Test surface: ~250 class/style assertions across 26 test files (heaviest: `EventBlock` 37, `InteractiveBlock` 34, `WeekGrid` 33, `Sheet` 17, `NewTaskModal` 14, `TaskRow` 12, `CreatePopover` 12); 658 `*ByTestId` queries.

## 1. Decisions

| # | Topic | Decision | Source |
|---|---|---|---|
| D1 | Font | **Manrope for both themes** (Outfit dropped). Google Fonts `Manrope:wght@300;400;500;600;700`. | Owner 1 |
| D2 | Themes | Dark ("graphite") + light ("light glass") from `tokens.css`. Every screen built on tokens; non-planner light versions derived from tokens in the light planner's tone. | Owner 2 |
| D3 | Theme switching | `data-theme="dark|light"` on `<html>`; default = `prefers-color-scheme`; explicit choice persisted in `localStorage['nr.theme']`; applied **before first paint** by an inline script in `index.html`; sun/moon switch in the rail above Settings. "System" = no stored key. | Orchestrator |
| D4 | Header | Eyebrow + 48px light title with one bold word; right side: Search (round glass) → client-side task search palette; **New task** primary pill; **avatar = account menu** (Settings, Sign out), generic person glyph (no initial — not derivable client-side, no `/auth/me`). | Owner 3 |
| D5 | Locking (hybrid) | Google meetings (`source==='google'`, kind event): solid violet + lock icon, **locked** — pointer-down / arrow keys → 450ms shake + "Locked" toast. App events (`source==='app'`): solid violet, **no lock**, draggable/resizable as today. Pinned task/habit blocks: dashed (movable style) + pin icon; detail card's secondary action = **Unpin**. Blocked time: existing behaviour (app-owned → movable), muted hatched style from tokens. | Owner 4 |
| D6 | Detail card | **Card then drawer.** Click a block → selected (outline) + detail card atop the side panel. Card's primary button ("Open task"/"Open event"/"Open habit") opens the existing `TaskDrawer`/`EventDrawer` (habits: navigate to `/habits`, see §5.4). Post-drag click is swallowed. | Owner 5 |
| D7 | Start/Stop | Planner **Next up card** gets Start/Stop with today's current-or-next semantics (`useNowNextControls`/`pickCurrentOrNext`). Other desktop screens keep a **compact Now/Next pill** in the header. Mobile keeps its top-bar pill. | Owner 6 |
| D8 | Priorities | 4 glass priority columns **+ Backlog + Completed** glass columns; keep Filter (Hide completed) and Columns menus; keep dnd-kit; approximate design motion with dnd-kit (`DragOverlay` tilted clone, dashed placeholder, landing spring, ←/→ = change priority). | Owner 7 |
| D9 | Block layer | Adopt the design's **single absolutely-positioned block layer** spanning all N rendered day columns. `left = (dayIndex + lane/lanes) / N`, `width = 1/(lanes·N)` (percent of the layer) minus a 5px inset each side (2px when `lanes>1`). Stable keys (`b:<id>` / `e:<id>`) so a cross-day move reuses the element and transitions `left/top`. Generalises to 1–7 days and overlap lanes on paper (geometry is per-day `placeInDay` + `layoutOverlaps`, unchanged); **not yet prototyped** — Task 3.4 must prove click-to-create (layer `pointer-events-none`, blocks `pointer-events-auto`), popover/drop-indicator stacking and cross-day drag before P4 builds on it. | Orchestrator (feasibility assessed from code, not tested) |
| D10 | Hour scale | **60px/hr** (`HOUR_ROW_PX = 60`, `GRID_COLUMN_PX = 1440`). Contained: 1 constant + 2 `h-[58px]` literals in `WeekGrid` + `weekModel.test.ts` + `InteractiveBlock.test.tsx` pixel expectations. `scheduleDrop` tests are fraction-based and unaffected. | Orchestrator |
| D11 | Planner geometry kept | Responsive 1–7 day count (`daysThatFit`), 24h vertically scrolling columns, `dayStartMinute` anchoring, overlap lanes, `settings.timezone` rendering, header swipe paging. The design's fixed "1 PM–2 AM" window is **not** adopted. | Orchestrator |
| D12 | Unscheduled | Summary card replaces the amber `UnscheduledWarning` strip; keeps `role=status`; count = number of unscheduled entries; first 3 chips + "+N more" (switches side panel to All tasks); lime Re-plan button lives here. Card is **always** rendered on desktop (shows "Everything fits" state with count 0) so the Re-plan button has a home. | Orchestrator |
| D13 | Re-plan | Loading state (spinning icon + "Re-planning…"); drop-in animation for **newly scheduled** blocks found by a client-side diff of block IDs captured before `replan.mutate()` vs the first schedule refetch after success. | Orchestrator |
| D14 | Location | Omitted everywhere (no data). | Orchestrator |
| D15 | Mobile | Keep bottom tab bar, sheets, safe-area chrome, top-bar pill; restyle with tokens. The design's horizontal rail-on-top is **not** adopted. | Orchestrator |
| D16 | Habits day pills | Read-only display of `eligibleDays`. | Orchestrator |
| D17 | Tailwind | Existing palette names and new token names map to CSS variables holding **RGB channel triplets** (`--c-text-1: 244 245 247`) so `/alpha` modifiers keep working: `colors.ink = 'rgb(var(--c-text-1) / <alpha-value>)'`. Non-colour tokens (gradients, shadows, blur, easing, durations, radii) are plain CSS vars exposed as Tailwind `boxShadow`/`backgroundImage`/`transitionTimingFunction`/`transitionDuration`/`borderRadius` extensions. | Orchestrator |
| D18 | Reduced motion | Global kill switch in `index.css` (tokens.css block) **plus** JS checks (`usePrefersReducedMotion`) where motion is scripted (FLIP via WAAPI, drop-in staggers, toast timers keep their text but skip animation). | Orchestrator |
| D19 | Tests | Assert behaviour via roles/testids/data-attributes (`data-locked`, `data-kind`, `data-pinned`, `data-source`, `data-selected`, `data-hidden`, `data-dragging`, `data-new`, `data-theme`, `data-today`, `data-active`), not palette class names. Layout-guarantee class assertions (`min-h-0`, `flex-1`, `overflow-y-auto`, `overscroll-contain`, `shrink-0`, `md:hidden`) stay when the new markup still carries them. Suite green at the end of every phase. | Orchestrator |
| D20 | Sidebar hide toggle | The 76px rail is always shown at md+; the R13 `toggle-sidebar` button and `nr.sidebarHidden` are **retained** as a header icon button (see Open question Q1). | Keep-all-features default |

## 2. Token mapping

`packages/web/src/styles/tokens.css` (new) is a port of `tokens.css` with colour values rewritten as channel triplets where the value is a flat colour (alpha baked into the token stays in a separate `--c-*-a` var or becomes a Tailwind alpha modifier at the call site). Non-flat values (gradients, multi-shadows, borders with style) stay verbatim as `--x-*` vars. Selectors: `:root, :root[data-theme="dark"]` (dark is the token file's default) and `:root[data-theme="light"]`. The inline pre-paint script always sets `data-theme`, so `prefers-color-scheme` is only read in JS (avoids duplicating the light block under a media query).

### 2.1 Colour tokens → Tailwind names

| Token (design) | CSS var (channels) | New Tailwind name | Legacy name re-pointed (kept so untouched classes still theme) |
|---|---|---|---|
| `--bg-page` | `--c-page` | `page` | `bg` |
| `--text-1` | `--c-text-1` | `fg` | `ink`, `sidebarText` (→ `fg-2`) |
| `--text-2` (white/ink @ .66) | `--c-text-1` + alpha | `fg-2` = `rgb(var(--c-text-1) / .66)` (fixed alpha colour) | `inkSoft`, `sidebarMuted` |
| `--text-3` (@ .55) | same | `fg-3` | — |
| `--text-on-accent` | `--c-on-accent` | `on-accent` | — |
| `--text-danger` | `--c-danger` | `danger` | `crit` keeps the priority red (see priority row) |
| `--panel-bg` (flat dark / gradient light) | `--x-panel-bg` | utility `.glass` (component class) | `card` → `--c-card` (dark `22 22 26`, light `255 255 255`) for opaque cards |
| `--panel-border` | `--x-panel-border` | in `.glass` | `line` → fixed-alpha colour `rgb(var(--c-line-rgb) / 0.07)` (`--c-line-rgb` = white in dark, ink in light); like `fg-2`, no `/alpha` modifier support |
| `--card-bg` / `--card-border` / `--card-hover` | `--x-card-*` | `.glass-card`, `.glass-card-hover` | — |
| `--btn-bg` / `--btn-border` / `--btn-bg-hover` | `--x-btn-*` | `.btn-glass` | — |
| `--btn-primary-bg` / `-text` | `--c-primary`, `--c-on-primary` | `primary`, `on-primary` | — |
| `--accent` (lime fill) | `--c-accent` | `accent` | — (legacy `indigo` is **not** pointed here: today's `bg-indigo text-white` buttons would become white-on-lime. During P1–P7 legacy `indigo`/`indigo600` point at `meeting` violet; each screen phase moves brand fills to `bg-accent text-on-accent`) |
| `--accent-text` (lime / olive) | `--c-accent-text` | `accent-fg` | brand *text* (`text-indigo`) migrates to `accent-fg` per screen (lime text is unreadable on light) |
| `--accent-soft` / `--accent-line` | via `accent` + alpha | `accent/[.06]`, `accent-line` | `indigoSoft` → `meeting` @ .12 (transitional, fixed-alpha) |
| `--meeting-bg` (flat dark / gradient light) | `--c-meeting` (flat) + `--x-meeting-bg` | `meeting` (dot/legend/chart) + `.block-meeting` | `event` |
| `--meeting-border`, `--meeting-text`, `--meeting-shadow` | `--x-meeting-*` | in `.block-meeting` | — |
| `--today-bg` / `--today-text` / `--today-column` | `--c-today`, `--c-on-today`, `--x-today-col` | `today`, `on-today` | — |
| `--habit-bg` / `--habit-border` / `--habit-text` | `--x-habit-*`, `--c-habit-fg` | `.block-habit`, `habit-fg` | `kind.habitText` |
| `--task-bg` / `--task-border` | `--x-task-*` | `.block-task` | — |
| `--grid-line` | `--c-line-rgb` | `grid` = fixed-alpha `rgb(var(--c-line-rgb) / 0.065)` | `#f1f2f6` literal in WeekGrid |
| `--now-line` | `--c-now` | `now` | — |
| `--overlay` | `--x-overlay` | `bg-overlay` (backgroundColor ext) | `bg-[rgba(24,26,42,.35)]` in NewTaskModal, `bg-black/20` in Habits drawer host |
| `--dialog-bg` | `--x-dialog-bg` | `.glass-dialog` | — |
| `--toast-bg` / `--toast-text` | `--x-toast-bg`, `--c-toast-fg` | `.toast` | — |
| `--chart-meetings` / `--chart-habits` | `--c-chart-meet`, `--c-chart-habit` | `chart-meet`, `chart-habit` | `kind.meetingBar`, `kind.habitBar`; `kind.taskBar` → new `--c-chart-task` (derived: dark `#E6E7EA`-ish neutral, light `#3A3D45`; validate) |
| `--pri-critical/high/medium/low` | `--c-pri-*` | `pri-crit/high/med/low` | `crit`, `high`, `med`, `low` |
| (new) blocked hatch | `--x-blocked-bg` = `repeating-linear-gradient(45deg, rgb(var(--c-text-1)/.10) 0 2px, transparent 2px 6px)`, `--x-blocked-border` = `1px solid rgb(var(--c-text-1)/.14)` | `.block-blocked` | `slate-*` literals in `EventBlock.variantClass` |

Rules: (1) re-pointed legacy names make the codebase theme-able on day one of P1 without touching every component; (2) each screen phase migrates its files to the new semantic names and removes legacy usages; (3) P8 deletes legacy names from the config once `grep` shows zero usages (`indigo600`, `sidebar*`, `kind.*`, `event`, `indigoSoft`). The `coarse:` variant plugin is kept.

### 2.2 Non-colour tokens → Tailwind

| Token | Tailwind |
|---|---|
| `--radius-panel/rail/card/field/input/event/pill` | `rounded-panel` (22), `rounded-rail` (38), `rounded-card` (16), `rounded-field` (18), `rounded-input` (12), `rounded-event` (12), `rounded-pill` |
| `--panel-shadow`, `--meeting-shadow`, primary/lime glow | `shadow-panel`, `shadow-meeting`, `shadow-accent` (`0 10px 30px -10px rgb(var(--c-accent)/.7), inset 0 1px 0 rgba(255,255,255,.6)`), `shadow-lift` (drag: `0 26px 50px -14px rgba(0,0,0,.8)`) — legacy `shadow-card/pop/modal` re-pointed to token shadows |
| `--panel-blur` | `.glass` uses `backdrop-filter: var(--panel-blur)` (none in dark) |
| `--ease-spring/-spring-strong/-pop/-out` | `ease-spring`, `ease-spring-strong`, `ease-pop`, `ease-out-soft` |
| `--dur-move/resize/land/reflow/enter/modal-in/modal-out/toast` | `duration-move` (550), `duration-resize` (500), `duration-land` (520), `duration-reflow` (240), `duration-enter` (600), `duration-modal-in` (500), `duration-modal-out` (220) |
| keyframes | `rise`, `fade-up`, `ev-in`, `land`, `shake`, `toast`, `pulse-dot`, `pop-check`, `expand`, `modal-in`, `modal-out`, `bd-in`, `bd-out`, `th-in`, `spin`, `fresh` (new-task glow), `grow` (Stats bars), `donut-draw` (Stats donut) — exact curves from `PlannerDark.dc.html` / `Stats.dc.html` §style. All ship in P1; `tailwind.config.js`/`index.css` are frozen during the parallel phases. |
| `--font-sans` | `fontFamily.sans = ['Manrope', 'system-ui', 'sans-serif']` |
| `--page-pad`, `--gap-*`, `--rail-width`, `--side-panel-basis` | literal Tailwind arbitrary values at the call site (`w-[76px]`, `basis-[330px]`, `gap-5`) — not worth config entries |

Component classes (`@layer components` in `index.css`): `.glass`, `.glass-card`, `.btn-glass`, `.btn-primary`, `.btn-accent` (lime), `.chip`, `.block-meeting`, `.block-task`, `.block-habit`, `.block-blocked`, `.toast`, `.focus-ring` (`outline 2px accent offset 2px`). These are literal class names (JIT-safe) and keep multi-value tokens out of 200-char utility strings.

## 3. Block-type visual matrix (planner)

All blocks: `rounded-event`, `px-[9px] py-1.5`, time label 11px tabular, title 13px/500. Short blocks (< 45 min) use the single-row layout (title left, start time right). Category accent (`accents[taskId]`) continues to apply to task blocks: dashed border + text colour = accent (movable), unchanged inline-style mechanism. Selection = `outline-2 outline-fg outline-offset-2` + `data-selected`.

| Type | Detection | Look | Icon | Move/resize | Keyboard | Click | Detail chip | Secondary action | data-* |
|---|---|---|---|---|---|---|---|---|---|
| Google meeting | event, `source==='google'`, kind≠blocked | `.block-meeting` solid violet, meeting shadow | lock (top-right) | **No** → shake + toast "Locked — it's synced from Google Calendar" | arrows → shake + toast | select | "Meeting · Locked" | none (hidden) | `data-kind=meeting data-locked=true data-source=google` |
| App event | event, `source==='app'`, kind≠blocked | `.block-meeting`, no lock | — | Yes (PATCH `/calendar/events/:id`) | arrows/Shift+arrows | select | "Event · Movable" | Delete event | `data-kind=meeting data-locked=false data-source=app` |
| Blocked time | event kind `blocked` (app-owned) | `.block-blocked` hatched, `text-fg-2`, 1px border | — | Yes (as today) | yes | select | "Blocked time" | Delete | `data-kind=blocked` |
| Auto task | block, `taskId`, `!pinned` | `.block-task` dashed fg | — | Yes (commit pins it — existing semantics) | yes | select | "Task · Auto-scheduled" | Delete block | `data-kind=task data-pinned=false` |
| Pinned task | block, `taskId`, `pinned` | `.block-task` dashed + slightly stronger fill (`bg-fg/[.08]`) | pin | Yes | yes | select | "Task · Pinned" | **Unpin** | `data-kind=task data-pinned=true` |
| Habit | block, `habitId`, `!pinned` | `.block-habit` dashed lime/olive | — | Yes | yes | select | "Habit · Movable" | Delete block | `data-kind=habit data-pinned=false` |
| Pinned habit | block, `habitId`, `pinned` | `.block-habit` + pin | pin | Yes | yes | select | "Habit · Pinned" | **Unpin** | `data-kind=habit data-pinned=true` |
| Started task | block with `startedAt != null` | task look + 3px accent left bar + "Now" dot when running | play/clock | Yes (unchanged rules) | yes | select | "Task · In progress" | Stop (if running) / Unpin | `data-started=true` |

Hover × delete stays on every block that has `onDelete` today (touch: always visible). The R9 Unpin button becomes the pin icon button (aria-label "Unpin") — still a separate `<button>`, never nested inside the block's focus target (see §5.2 structure).

## 4. Per-screen component mapping

### 4.1 Shell (all routes)

| Design element | Existing file | Change |
|---|---|---|
| Sidebar rail (76px glass capsule, logo dots, groups Plan [Planner, Priorities, Stats] / caption TIME / Time [Habits, Buffers, Hours], spacer, theme switch, Settings) | `app/Sidebar.tsx`, `shell/NavItem.tsx`, `shell/Logo.tsx`, `shell/icons.tsx` | Rewrite `Sidebar` as `Rail`; `NavLinkItem` → icon-only 46px round link, `aria-label`, CSS tooltip (`::after` from `data-label`), active = `bg-accent text-on-accent shadow-accent` + `aria-current`. `NavSection` (collapsible group) deleted — groups are static. Logo becomes 2×2 dots. Add icons: `habits` (repeat arrows), `buffers` (layers), `hours` (clock), `sun`, `moon`, `lock`, `pin`, `refresh`, `warning`, `play`, `stop`, `user`, `grip`. |
| Theme switch | new `shell/ThemeSwitch.tsx`, new `theme/theme.ts`, `theme/useTheme.ts`, `index.html` | Two-button group (`role=group aria-label="Theme"`, buttons `aria-pressed`), active knob, icon spin-in (`th-in`). |
| Header (eyebrow + title with bold word; Search, New task, avatar) | `shell/TopBar.tsx`, `shell/routeTitle.ts` | `routeTitle` → `routeHeader(pathname, nowMs, zone)` returning `{ eyebrow, before, bold, after }` (Planner: "Tuesday, November 24 · Week 48" / "Your **week** planner"; Priorities: "N open tasks across 4 priority levels · drag to reorder" / "Your **priorities**"; Stats: "Week 48 · Nov 24 – Nov 30" / "Your **stats**"; Habits/Buffers/Hours: "Time management" / "Your **habits**", "Scheduling **buffers**", "Your **hours**"; Settings: "Preferences" / "**Settings**"). Pages drop their own `<h2>` titles. Disabled Search → `SearchButton` opening `TaskSearchPalette`. New task → `.btn-primary` pill. |
| Avatar / account menu | `shell/AccountMenu.tsx` | 46px round violet-gradient button with a generic `user` glyph; menu = glass popover, Settings + Sign out; Esc closes, focus returns. |
| Now/Next pill (non-planner desktop routes) | `shell/TopBar.tsx` + `useNowNextControls` | Compact `.chip`-style pill "Now · Title [Stop]" / "Next · Title · Today 4:30pm [Start]"; hidden on `/` (Planner has the Next up card). Testids `current-task`, `stop-task`, `next-task`, `next-task-start` preserved. |
| Search | new `shell/TaskSearchPalette.tsx` | `role=dialog` palette with combobox input (`role=combobox`, `aria-controls` listbox, `aria-activedescendant`), filters `useTasksQuery()` titles client-side (case-insensitive substring, non-archived; completed shown last, dimmed), ↑/↓/Enter/Esc, `/` and Ctrl/Cmd+K open it. Select → opens the task in a `TaskDrawer` hosted by the shell (new `ShellTaskDrawer` using `DrawerHost`) — works on every route without navigating. |
| Google-broken banner | `shell/GoogleBrokenBanner.tsx` | Glass card with `danger` text + `.btn-glass` Reconnect; `role=alert` kept. |
| Mobile top bar / tab bar | `shell/MobileTopBar.tsx`, `shell/MobileTabBar.tsx` | Token restyle only (glass bar, active tab = accent pill behind icon, `aria-current`). Theme switch reachable on mobile via a Settings "Appearance" row (§4.8). |
| Content frame | `app/AppShell.tsx` | Page `bg-page`, 20px page padding, rail + content with 20px gap; `shell-content` scroll container + mobile bottom padding unchanged. |

### 4.2 Planner

| Design element | Existing file | Change |
|---|---|---|
| Summary row (same split as row below: `flex 999 1 640px` / `1 1 330px`, gap 20) | `pages/Planner.tsx` | New top row above the grid/panel row; when the panel is hidden the Next-up card moves into the summary row's end (still visible). |
| Unscheduled card | replaces `planner/UnscheduledWarning.tsx` → new `planner/UnscheduledCard.tsx` (reuse `unscheduledSummary.ts`) | 44px light count, danger line, chips (title + "Xh left" / "N missed"), "+N more" (`unscheduled-more`, switches panel to All tasks, opens the sheet on compact), Re-plan button (`replan-button`). `role=status`, `data-testid="unscheduled-warning"` retained for continuity. Zero state: "Everything fits · nothing left unscheduled". Compact: one chip. |
| Next up card | new `planner/NextUpCard.tsx` | "Next up · Today 11:29 PM", "in 1h 29m" chip, title, second line = the following block ("Tomorrow · X 4:30 PM") or nothing; **Start** (`next-task-start`) / **Stop** (`stop-task`) via `useNowNextControls`; running state "Now · until 5:45 PM". Empty: "Nothing scheduled next". Not shown on compact (mobile top-bar pill covers it). |
| Calendar panel toolbar | `planner/WeekGrid.tsx` | glass round prev/next (aria "Previous days"/"Next days"), range label, Today, toast slot (absolute, bottom-centre of panel), filter pills Meetings / Movable (`aria-pressed`), static legend Locked / Blocked, panel toggle (kept). Re-plan button **moves** to the summary card (WeekGrid `onReplan`/`replanPending` props removed). |
| Day header | `WeekGrid.tsx` | DOW 12px caps + 40px round day number; today = filled `bg-today text-on-today` circle; swipe paging unchanged. |
| Grid body | `WeekGrid.tsx` | 60px/hr, gutter labels `text-fg-3`, grid lines via `repeating-linear-gradient` with `--c-grid`, today column `--x-today-col`, now-line `bg-now` + pulsing dot on today's column. Day columns stay as the click-to-create / dnd-kit drop / tint layer (`DayDropZone`, `day-col-i`). |
| Block layer | `WeekGrid.tsx` + `planner/blockLayout.ts` (new, pure) | One absolute layer over the day columns; `layoutWeek(items, days)` → per item `{dayIndex, topPct, heightPct, leftPct, widthPct}` using `placeInDay` + per-day `layoutOverlaps`. |
| Block | `planner/InteractiveBlock.tsx`, `planner/EventBlock.tsx` → new `planner/CalendarBlock.tsx` (+ `planner/blockStyle.ts`, `planner/useBlockDrag.ts`) | Single component for all kinds; locked meetings are the same component with `locked`. `EventBlock.tsx` deleted; `InteractiveBlock` logic moves into `useBlockDrag` (§5.2). |
| Ghost + label | new in `CalendarBlock`/`WeekGrid` | §5.2. |
| Side panel | `planner/PlannerTaskPanel.tsx` | Glass panel, segmented `role=tablist` Priorities / All tasks (`role=tab aria-selected`; was `aria-pressed` buttons), groups with glowing dot + uppercase label + count, compact two-line tiles (check circle, title + red "Not scheduled" warning icon [`panel-at-risk`, `role=img aria-label="Not scheduled"`], "Due Sep 10" + 3px progress bar + "0m / 1h", duration chip), hover edit/delete kept, dnd-kit drag-to-calendar kept. "Show N more" per group after 5 (`panel-show-more-<bucket>`). All tasks = flat list sorted by **due** (undated last; tie → priority → title) with priority dot + label. |
| Detail card | new `planner/BlockDetailCard.tsx` | §5.4. |
| Drawers | `TaskDrawer`, `EventDrawer`, `DrawerHost`, `DrawerPanel` | Glass dialog surface; desktop slot `top-[84px]` recomputed for the taller header (`top-[120px]`, or anchor to the side panel's top) — verify live. |
| Create popover | `planner/CreatePopover.tsx` | Glass popover, segmented Event/Task/Blocked, token inputs; behaviour unchanged. |
| Drag-from-panel overlay | `pages/Planner.tsx` `DragOverlay` | Glass card + tilt; drop indicator `bg-accent`. |

### 4.3 New task dialog — `shell/NewTaskModal.tsx`

Glass dialog `role=dialog aria-modal aria-labelledby` ("New task" heading), ✕ (`aria-label="Close"`), name box (smiley icon, 60px, violet focus ring, autofocus, **Enter submits**), 2-col grid: Duration field (`DurationStepper` restyled: 22px value, 34px round ± glass buttons) | Priority (`PriorityPicker` restyled: 2×2 pills, selected = inverted `bg-fg text-page`, `role=radiogroup` + `role=radio aria-checked` — was `aria-pressed`), Split up (custom checkbox, lime when on) → **reveals** Min/Max duration with `expand` slide (hidden, not disabled, when off), Hours field (select + inline "+ New" category creation kept), Schedule after / Due date (datetime-local, "Leave empty for no deadline"), footer Cancel + Create (`.btn-accent`, disabled until valid). Esc / ✕ / Cancel / backdrop close with 220ms exit then unmount; focus returns to the opener (New task button, or mobile `+`). After create: "Task created" toast (shell toast region) + the new card in the planner panel gets `data-fresh` glow for 1.3s. Steppers keep 15-min steps for both min and max (design's 30-min max step not adopted — avoids a behaviour change). Mobile: near-full-screen as today.

### 4.4 Priorities — `pages/Priorities.tsx`, `priorities/*`

Toolbar: glass search field (filters live), Filter / Columns as `.btn-glass` pills with glass dropdown menus (`Dropdown.tsx`). Board: auto-fit grid `repeat(auto-fit, minmax(260px, 1fr))` on wide screens with 6 columns (4 priority + Backlog + Completed); horizontal scroll-snap pane kept below the width where 6×260 doesn't fit (existing `boardPane.ts`). Column = glass panel, header: glowing priority dot, name, count chip, collapse chevron (`aria-expanded`). Cards (`TaskRow`): 6-dot grip (drag handle on touch), check circle (pop animation), title 2-line clamp (strike-draw when done), "Due 9/10" + subtask `0/1`, duration chip, kebab (Edit/Delete). Backlog muted; Completed faded and non-draggable (unchanged). Empty column: dashed "Drop tasks here". DnD (dnd-kit): `DragOverlay` clone `rotate(-1.5deg) scale(1.03)` + accent ring + `shadow-lift`; source slot rendered as dashed accent placeholder of the card's height; hovered column accent border; drop animation via dnd-kit `dropAnimation` with `ease-spring-strong` 520ms; existing `useFlip` re-tuned to `duration-reflow` + `ease-out-soft`. Keyboard: grip focusable; ↑/↓ reorder, ←/→ neighbouring column (existing `boardKeyboardCoordinates`); announcements "Moved X to High priority, position 2" via the existing `makeAnnouncements`.

### 4.5 Stats — `pages/Stats.tsx`, `stats/*`

4 KPI tiles (`StatCard`: label, 64px light number + small unit, sub; "In meetings" with meeting swatch; "Tasks done" with progress bar). Hours by day (`HoursByDayChart`): stacked bars meetings over habits **over tasks** (task segment kept — the app has task time, the design omits it; colour `chart-task`), 2px gap, 4px rounded tops, y-axis 0/2/4/6h (scaled to max), value label per bar, hover tooltip, **Chart | Table** segmented switch (table = accessible alternative: `<table>` with day rows). Time split (`TimeSplitDonut`): SVG donut with total in centre, legend rows hours + %. Bars grow / donut draws in (reduced-motion off).

### 4.6 Habits — `pages/Habits.tsx`, `habits/*`, `components/QuickAdd.tsx`

Summary strip (active habits, hours booked per week = Σ chunk × perPeriod for active, paused). Glass "Add a habit…" input + lime Add (`QuickAdd` restyle). `HabitRow`: name + "Paused" chip + ⚠ chip (`habit-at-risk`, kept), "30m × 7/week · any day|Mon Tue…", 7 read-only day pills (S M T W T F S, eligible = lime outline/fill, `aria-hidden` group + sr-only text "Days: Mon, Tue…"), Edit / Pause|Resume / ✕ (red) with inline delete confirm kept; paused rows 55% opacity. `HabitDrawer` in a glass dialog.

### 4.7 Buffers — `pages/Buffers.tsx`

Two glass cards with − / value / + steppers (5-min steps, floor 0, **no upper clamp** — the middle value stays an editable number input keeping `meeting-buffer`/`task-buffer` testids), helper text. Preview strip (new `buffers/BufferPreview.tsx`): hatched buffer | Meeting 60 min | hatched buffer | dashed Task | gap line | dashed Task, widths proportional and transitioning. Save (lime) + status "Saved" (`saved`) / "Unsaved changes" (new `unsaved`) by comparing form to initial.

### 4.8 Hours & Settings — `pages/Hours.tsx`, `settings/*`

Hours: "CATEGORIES" caption; each category a glass card: name input, "Default" chip, "Follows Settings" chip (default w/o custom), "Nh per week" chip (computed from windows), Delete (disabled on default; red text otherwise), colour swatches as `role=radiogroup` (`role=radio aria-checked`, 9 incl. "No color"; testids kept), Default: "Use custom working hours" checkbox + note "Uses your working hours from **Settings**" (link); day rows (`WeeklyHoursEditor` restyle: custom checkbox, time inputs, 24h coverage bar with 12a/6a/12p/6p/12a ticks), Save hours (lime). "+ Add category" dashed full-width button. Settings: two-column grid — Working hours card (7 rows + "Nh per week") | Timezone card + Planner card ("Day starts at" + explanation); full-width Scheduling card (horizon number, Min/Max chunk steppers, "Only count time after I press Start"); **Save button kept** (eyebrow does NOT claim autosave); Account section restyled (password, Google status incl. broken state); new **Appearance** row (System / Light / Dark segmented — the mobile path to the theme switch); mobile Buffers/Hours link rows + Signed-in row kept; version footer kept.

### 4.9 Auth pages — `auth/SignIn.tsx`, `auth/Register.tsx`, `AuthCallback`

Token restyle only (glass card on `bg-page`), theme applies (pre-paint script runs on every route).

## 5. Interaction specs (adapted)

### 5.1 Theme
`theme.ts`: `type ThemePref = 'light'|'dark'|'system'`; `readPref()` (try/catch localStorage), `resolve(pref, mql)`, `apply(theme)` sets `document.documentElement.dataset.theme` and `style.colorScheme`. `useTheme()` returns `{ pref, theme, setPref }`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` while pref is system. Inline script in `index.html` (≤ 15 lines, try/catch) applies the same resolution before React loads. Rail switch: clicking sun/moon sets an explicit pref; Settings Appearance offers System. Theme change toggles a `theme-switching` class for one frame to suppress transitions (prevents every block animating colours).

### 5.2 Planner blocks: structure, drag, resize, keyboard
**Structure.** `CalendarBlock` renders a positioned wrapper `div[data-testid="event-block"]` (position, transitions, `data-*`) containing: the focus target `button[data-testid="block-body"]` (`aria-label` = "<title>, <Weekday> <start>–<end>, <state>" with state = "locked, synced from Google" or "movable: drag or use arrow keys, Shift+arrows to resize"; `aria-describedby` → shared hidden instructions), and sibling action buttons (× delete, pin/Unpin) absolutely positioned — never nested in the focus target. The resize handle is a sibling `span[data-testid="resize-handle"]` (10px, `cursor-ns-resize`, 22px grip pill fades in on hover/focus; coarse keeps the 24px `h-6` target rule from `resizeHandleClass`).

**Drag to move (pointer).** Port the design, keeping existing hard-won mechanics: long-press arming on touch (`longPress.ts`), first-pointer-wins capture, non-passive `touchmove` block, edge auto-scroll + scroll compensation (`edgeScroll.ts`). Threshold 5px (mouse) before drag state. While dragging: block follows the raw pointer `transform: translate(dx,dy) scale(1.05) rotate(-0.8deg)` with transitions off, `shadow-lift` + 1.5px accent ring, `data-dragging`; a **ghost** (`data-testid="drag-ghost"`, dashed accent, faint fill, `transition top/left 140ms`) sits at the snapped target with a pill label `"Sat · 12:15 AM"` (`data-testid="drag-label"`); the block's own time label shows the snapped time. Target: `day = clamp(origDay + round(dx / colWidth), 0, N-1)`, `startMin = clampToWindow(snap15(origStart + dyMinutes))`; colWidth = layer width / N (render-scale corrected: `rect.width / offsetWidth`). Release: commit through the existing paths (`onCommit` → `useUpdateScheduledBlockMutation` with `pinned:true`; app events → `onCommitEvent`), set `left/top` to the target and drop the transform **in the same render** with `transition: left/top/transform var(--dur-move) var(--ease-spring)` — the sum of the top and transform transitions is continuous, so the block springs from the drop point into the slot. The R10/R11 held-preview + `landing` bridge is replaced by: the component holds the *target* position locally (`heldTarget`) from pointer-up until props reflect it (or 1.5s safety timeout → spring back on rollback). **Regression guard:** the R11 release-jump (block paints new top with a stale transform and glides from the start) must be live-verified in Firefox and Chromium.

**Resize (bottom edge).** Handle `pointerdown` stops propagation; window `pointermove/up`; height follows pointer exactly (no transition); ghost shows snapped height with label `"1h 15m · ends 9:15 PM"`; release: `newEnd = clamp(snap15(origEnd + dy), start + 15, windowEnd)`; height transitions `var(--dur-resize) var(--ease-spring-strong)`. Commit via existing paths.

**Keyboard.** Focused movable block: ↑/↓ ±15 min, ←/→ ±1 day (clamped to rendered days; at the edge, no-op + toast "Use the arrows above to see more days"), Shift+↑/↓ shorter/longer by 15 (min 15). Each key press commits immediately through the same mutation (debounced 400ms per block so key-repeat does not flood: preview moves instantly, one PATCH after the last key) and keeps focus on the block (stable key → same element). Enter/Space = select (detail card). Escape = deselect. Locked: any arrow → shake + toast. Delete key on a block with `onDelete` → same as ×.

**Click vs drag.** A press that crossed the drag threshold swallows the following `click` (no selection toggle). At md+ (any pointer, incl. iPad touch): click/tap selects (detail card) — a change from today, where a coarse tap at md+ opens the TaskDrawer directly (Q6). Compact layout (below md), where the side panel is a sheet: **tap keeps today's behaviour and opens the drawer directly** (TaskDrawer for task blocks, EventDrawer for app events/blocked time; Google meetings and habit blocks show a toast "Synced from Google" / "Edit habits on the Habits page"). The detail card is an md+ feature.

**Locked shake + toast.** `pointerdown` or arrow on a Google meeting → `animate-shake` (450ms) via a `data-shake` key bump, plus toast. No capture, no drag.

**Toast.** `planner/PlannerToast.tsx` + `useToast()` (shell-level provider so NewTaskModal can raise "Task created"): floating pill bottom-centre of the calendar panel (absolute; shell toasts bottom-centre of viewport above the mobile tab bar), `role=status aria-live=polite` region always mounted, 2.4s enter/hold/exit, one at a time (newest replaces).

### 5.3 Filters
Meetings (all calendar events: Google meetings, app events, blocked time — see Q2) and Movable (task + habit blocks) toggle buttons, `aria-pressed`, persisted in `localStorage['nr.plannerFilters']`. Hidden blocks get `data-hidden=true`, `opacity-0 scale-[.92] pointer-events-none`, `tabIndex=-1` on the body and `aria-hidden` on the wrapper — not unmounted (so they animate back). Ghost/now-line unaffected.

### 5.4 Selection + detail card
`selectedKey` state in `Planner` (`b:<id>`/`e:<id>`), cleared on Escape, ✕, block deletion, or when the item disappears from data. Card (glass, top of side panel; if the panel is hidden, the card shows anyway as a floating panel in the side column): type chip (§3 matrix), title (28px), long day ("Wednesday, Nov 25"), Time tile ("4:30 PM – 5:45 PM") + Duration tile ("1h 15m"), task extras (priority dot + label, "Due …", spent/left), buttons: primary **Open task** (→ `TaskDrawer` of `taskId`) / **Open event** (→ `EventDrawer`, app events and blocked only) / **Open habits** (→ `/habits`; habit drawer is not reachable from the planner today) / Google meeting: primary "Open in Google Calendar" only if an `htmlLink` existed — it does not, so the primary button is omitted and the card states "Synced from Google Calendar"; secondary **Unpin** (pinned blocks), **Stop** (running block), else **Delete**. ✕ = `aria-label="Close details"`. Focus moves to the card heading on open (from keyboard selection) and back to the block on close.

### 5.5 Re-plan
`useReplanMutation` unchanged. `Planner` captures `prevIds = new Set(schedule.data.map(b=>b.id))` on click; after success, the first schedule data whose `dataUpdatedAt` is newer than the mutation's settle time is diffed; `newIds = ids − prevIds` (restricted to the visible range). New blocks render with `data-new` and `animate-land` (900ms, staggered 180ms by start time); flags cleared after the animation. Blocks with unchanged ids that moved just glide (`left/top` spring). Button: spinning refresh icon + "Re-planning…" while `isPending` (min display 600ms to avoid flicker); `disabled`. WS-driven `schedule.updated` refetches do **not** trigger drop-ins (only user-initiated replans). The count + chips in the summary card update from the preview query as today.

### 5.6 Entrance & small motion
Glass panels `animate-rise` (600ms, stagger 60ms via inline `animationDelay`) on route mount only; calendar blocks `animate-ev-in` staggered 45ms by day index on first load and on page navigation (not on every refetch — gated by a `mountedRef`); now dot `animate-pulse-dot`; checkbox `animate-pop-check`; done strike-draw (`background-size` transition); buttons `active:scale-[.96]`; Re-plan icon rotates −30° on hover; rail tooltips slide 6px; theme icon spins in.

### 5.7 Priorities DnD
§4.4. dnd-kit `DragOverlay` + custom `dropAnimation` (`duration: 520, easing: var(--ease-spring-strong)` resolved to the literal cubic-bezier since dnd-kit needs a string), placeholder = the sortable source item rendered with `data-placeholder` (dashed accent, content `invisible`). Dropping into a collapsed column expands it.

## 6. Accessibility
- Real `<button>`/`<a>`/`<input>`+`<label>`; every icon-only button has `aria-label`; decorative SVGs `aria-hidden` (already the `Ic` default).
- Toggles `aria-pressed` (filters, theme buttons); tabs `role=tablist/tab` + `aria-selected` + arrow-key roving (panel tabs, Stats Chart|Table, Settings Appearance); radio pills `role=radiogroup/radio` + `aria-checked` (priority picker, colour swatches).
- Contrast ≥ 4.5:1 for text: lime **text** uses `accent-fg` (olive in light); secondary text uses `fg-2` (.66) — `fg-3` (.55) only for ≥ 12px non-essential labels (gutter hours) — checked with the a11y-debugging skill in P8.
- Focus: `:focus-visible` 2px accent outline offset 2 on everything (`.focus-ring` base style); blocks show the outline above the selection outline.
- Live regions: planner toast `role=status`; unscheduled card `role=status`; board announcements via dnd-kit; Google banner `role=alert`.
- Touch targets ≥ 44px on coarse pointers (existing `coarse:` rules preserved); calendar blocks are exempt but have keyboard alternatives.
- Dialog: NewTaskModal, TaskSearchPalette and AccountMenu trap/return focus (reuse `Sheet`'s focus logic where possible).

## 7. Reduced motion
`@media (prefers-reduced-motion: reduce)` global kill switch from `tokens.css` in `index.css`. JS: `usePrefersReducedMotion()` (matchMedia, false in jsdom) gates: WAAPI FLIP (`useFlip` returns early), drop-in stagger timers (flags cleared immediately), shake (toast still shows), entrance staggers, toast animation (text still announced and auto-clears after 2.4s). Drag still works (it is direct manipulation) but the release snaps without spring.

## 8. Testing approach
- Pure modules get unit tests: `theme.ts`, `blockLayout.ts` (N-day + lanes geometry), `blockStyle.ts` (kind → classes/data, locked rule), `replanDiff.ts` (id diff), `taskSearch.ts` (filter/rank), `routeHeader.ts`, `blockKeyboard.ts` (key → patch), `stepBuffer`.
- Component tests assert roles, testids and `data-*` (`data-locked`, `data-kind`, `data-pinned`, `data-source`, `data-selected`, `data-hidden`, `data-dragging`, `data-new`, `data-today`, `data-active`), not palette classes. Geometry assertions (`style.top/left/height`) remain where they encode behaviour.
- jsdom cannot drive real gestures, run CSS, or evaluate media queries: gestures are tested through pointer-event wiring + pure decision modules and live-verified in the browser (dev server, Firefox + Chromium; geckodriver per memory).
- Screenshot comparison vs `notreclaim-redesign/screenshots/*` at 1440 wide is a P8 manual QA step (side-by-side), not an automated gate.

## 9. Non-goals
- No backend/API changes: no `/auth/me`, no location field, no server-side theme preference, no autosave for Settings, no richer replan response.
- No change to scheduling semantics, pin semantics (drag still pins), started-task rules, or dayStartMinute behaviour.
- The design's fixed 1 PM–2 AM window, horizontal phone rail, Outfit font, per-theme fonts, canned replan placements and demo data are not ported.
- No new screens; no habit drawer inside the planner (detail card links to /habits).
- Google meetings are not made editable ("Unlock" action does not exist for them).
- No icon library, no animation library, no CSS-in-JS; dnd-kit remains the list DnD engine.
- Max-duration 30-min step and buffer 0–60 clamp from the design are not adopted (behaviour change).

## 10. Open questions (not blocking; defaults applied)
- **Q1 Sidebar hide toggle.** The 76px rail costs little; keep the R13 hide toggle (default) or drop it? Default: keep, as a small header icon.
- **Q2 Meetings filter scope.** Default: "Meetings" toggles all calendar events incl. app events and blocked time; "Movable" toggles task + habit blocks. Alternative: blocked time always visible.
- **Q3 Detail card for Google meetings** has no primary action (no event link stored). Acceptable, or add `htmlLink` server-side later (out of scope)?
- **Q4 Keyboard ←/→ at the view edge** — no-op + hint (default) vs auto-page the view.
- **Q5 Accent repurposing.** All former indigo "brand" fills become lime; indigo-as-violet survives only in meetings/today (dark). Confirm during P2 live review.
- **Q6 Click-to-select scope.** Owner decision 5 says clicking a block selects it. Default: selection at md+ for every pointer type (an iPad tap now selects instead of opening the drawer directly); below md a tap still opens the drawer because the side panel is a sheet there. Alternative: keep iPad (coarse at md+) on tap-opens-drawer.

### P1 implementation notes (2026-11-25): deviations and contracts for later phases
- **Fixed-alpha colours accept `/alpha`.** Tailwind 3.4 parses `rgb(var(--x) / 0.66)`, so `text-fg-2/50` compiles. The modifier **replaces** the baked alpha (giving text at .50); it does not multiply it. The plan said modifiers were unsupported. Use the base name (`text-fg/50`) instead. The config comment documents this.
- **Toast:** the prototype's keyframe has `translate(-50%, …)` baked in. P1's `toast` keyframe moves only vertically, and `.toast` carries no positioning. The caller (P2 `ToastProvider`, P4 planner anchor) centres it with a flex wrapper.
- **Donut:** `animate-donut-draw` follows the prototype and animates `stroke-dasharray` from `0 var(--donut-c, 503)`, not `stroke-dashoffset`. Contract for P7: each arc sets its final `stroke-dasharray` as "<len> <circumference>" and sets `--donut-c` to the circumference.
- **Legacy `sidebar*` colours** are kept as a fixed dark island using the dark-theme values, not tokens. The old sidebar's active item is `bg-sidebarHover text-white`, which would be white-on-white on a light surface. P2's rail rewrite removes them.
- **Extra tokens / Tailwind names:**
  - Vars: `--c-accent-glow`. Lime glows, the `.lime` shadow, and the `land`, `pulse-dot` and `fresh` keyframes all use it. Light is olive `120 155 0`, not the fill colour. Also `--c-on-meeting`, `--c-chip-fg` + `--x-chip-*`, `--x-btn-shadow`/`-border-hover`, `--x-card-shadow`, `--x-*-bg-hover`, `--x-toast-border`/`-shadow`, `--x-hatch-bg`, `--x-shadow-pop`/`-modal`.
  - Tailwind names: `on-meeting`, `chip-fg`, `accent-soft`, `accent-line` (raw vars, no alpha), `bg-today-col`, `shadow-accent-hover`.
- **Fonts:** Manrope is loaded at 300–700. The 11 existing `font-extrabold`/`font-black` usages now render at 700.
- **System theme:** `systemPrefersDark` falls back to dark when `matchMedia` is missing or throws. A browser that reports no preference resolves to light, because the dark query is false. The pre-paint script matches this behaviour, and `theme.test.ts` runs the script's text against the same decision table.
- **Things in dark mode the legacy mapping cannot fix:** these are hex literals in components and are left to their screen phases.
  - Priorities count chip `bg-[#eef0f4] text-inkSoft` in `TasksCard`: **unreadable** (light chip, light text). Fix in P6.
  - TaskRow hovers `#fafbfc`/`#eef0f4`.
  - WeekGrid grid lines `#f1f2f6` (bright) and the gutter label `#a6aab8` (P3).
  - The amber `UnscheduledWarning` strip stays light (P3).
  - Stats donut `KIND_HEX` (P7).
  - Logo/avatar hexes (P2).

### P2 implementation notes (2026-11-25): deviations and contracts for later phases
- **Order.** `useFocusTrap(ref, { onEscape, restoreTo, initialFocus })` was extracted from `Sheet.tsx` first, in its own behaviour-preserving commit, because 2.6 consumes it before 2.8. It returns the `onKeyDown` handler for the surface. Contract for P5: put the handler on the dialog element, and pass `initialFocus` explicitly. **Do not rely on `autoFocus` alone.** In Chromium, the palette lost `autoFocus` to the trap's container focus when it was opened by a shortcut pressed on a focused button. `initialFocus: () => inputRef.current` fixed it.
- **AccountMenu does not use the modal trap.** It follows the WAI-ARIA menu-button pattern:
  - Opening focuses the first item; ↑/↓/Home/End move between items.
  - Escape closes the menu and refocuses the button; Tab closes it and lets focus move on.
  - An outside press closes it **without** moving focus, since that press may be focusing something else.
  - Items are `role=menuitem`, so tests query `getByRole('menuitem', { name: /sign out/i })`.
- **Rail.**
  - The `data-testid="sidebar"` element is the `<nav aria-label="Main">` itself (`hidden md:flex` kept). It has `rounded-panel` (22px, matching the screenshots; `--radius-rail` 38px is unused) and `relative z-30`.
  - It has no overflow clipping, so the `::after` tooltips (`data-label`) can overhang the content column.
  - Wells and the theme knob have no token. They use a literal `[[data-theme=light]_&]:` variant (`RAIL_GROUP` in `NavItem.tsx`). There are no new tokens: `index.css`/the config stay frozen.
  - `NavLinkItem` sets `data-active` via `useMatch`. `NavSection` and the collapsible group are deleted.
  - The legacy `sidebar*` colours and `.dark-scroll` now have no users; P8 removes them.
- **ThemeSwitch.** `aria-pressed` follows the **resolved** theme, so exactly one button is pressed under "system". Clicking a button stores an explicit pref.
- **Header.**
  - `routeHeader(pathname, { nowMs, zone, openTaskCount })` is a pure function returning `{ eyebrow, title: [before, bold, after] }`. The compact `routeTitle()` lives in the same file (`routeTitle.ts` is deleted).
  - The Stats eyebrow uses the Mon–Sun settings-zone week that the Stats page reports on (e.g. "Week 48 · Nov 23 – Nov 29"), not the screenshot's Tue–Mon.
  - The Priorities count is active (pending/scheduled) tasks. It reads "Tasks across…" while the count is unknown.
  - The right cluster is: sidebar toggle (D20, 46px glass) · Now/Next pill · Search · New task · avatar. The pill and the toggle are not in screenshots 01/02 (expected deviation, owner decisions).
  - Header bottom is at 101px and content starts at 121px at md+, so drawer slots are now `top-[120px]` (measured live). `DrawerPanel` max-height is `calc(100dvh-140px)`.
- **Now/Next pill.**
  - Only TopBar uses the structured label: "Now · title" or "Next · title · Today 2:00pm", with the title truncated by CSS `max-w-[24ch] truncate`. `useNowNextControls` now also returns `nextTime`. `nextLabel` (mobile) reads "Next · title · time".
  - The pill still renders on `/`. Task 3.5 owns the `pathname !== '/'` gate.
- **Search.**
  - Palette state, the `/` and Ctrl/Cmd+K listener (`useTaskSearchShortcut`) and `ShellTaskDrawer` live in `AppShell`.
  - The shortcut is ignored in editable targets, while any `[aria-modal="true"]` is open, and for keys that were already prevented.
  - A blank query shows "Type to search your tasks"; nothing listed matches "No tasks match".
  - Below md the header is hidden and `MobileTopBar` pins "no search button", so search on phones is keyboard-only (hardware `/`). Decide in P8 whether to add a mobile entry point.
  - Z-tiers: shell drawer `z-[55]` (above page drawers at z-50), palette `z-[60]`, toast region `z-[70]`.
- **Toasts.**
  - `useToast()` outside a `ToastProvider` is a **silent no-op**, because pages render bare in tests. Page tests that want to assert a toast must wrap in `ToastProvider`.
  - P4 anchoring: `const { setAnchor } = useToast(); <div ref={setAnchor} … />` portals the visible pill into the planner panel. The `role=status` live region stays in the shell with an sr-only copy. Call `setAnchor(null)` (ref cleanup) on unmount.
  - Under reduced motion `animate-toast` is omitted, not just shortened: its keyframe ends at opacity 0 with fill `both`. `data-animated` exposes this to tests.
- **Primitives.**
  - The Sheet surface is `[background:var(--x-dialog-bg)]` + `shadow-modal`, **without** `.glass-dialog`, because a `backdrop-filter` (non-none in light) would make the sheet the containing block for `fixed` descendants.
  - The backdrop is `bg-overlay backdrop-blur-[8px]`, but only when not collapsed. `data-full-screen`/`data-collapsed` were added for tests.
  - `DrawerPanel` desktop = `.glass-dialog rounded-panel`. `FieldBox` shows its focus cue as `focus-within:border-accent/60`, because the controls inside have `outline-none`.
- **Icons.** `planner`/`priorities`/`stats` glyphs were redrawn to the prototype paths. `pin`/`play`/`stop`/`user` are drawn in the same style, since the prototype has no glyph for them (and the location pin is excluded). `grip` is re-centred on the 24 grid.
- **Mobile.** The tab bar and top bar are `.glass` with `rounded-none` and one-side borders. The active tab is a 48×28 accent pill behind the icon, plus `aria-current`/`data-active`. The Habits tab now uses the `habits` glyph.
- **Left for later phases:**
  - Pages still carry their own outer padding (e.g. Planner `md:p-4`), so content sits ~12–16px inside the header's left edge (P3/P7).
  - The Buffers card heading duplicates the new "Scheduling buffers" headline (P7).

### Survey notes for risky assumptions (checked 2026-11-24)
- **Block id stability (D13).** `packages/core/src/apply.ts` applies the desired schedule as a keyed (`engineKey`) in-place diff: a block whose engine key survives a replan is **updated in place and keeps its id**, so moved blocks glide and only genuinely new chunks drop in. Caveat: when a task's chunk count changes, keys are reissued and some blocks are deleted/created — those will drop in. That is acceptable ("newly placed" is a fair reading).
- **CSP vs the inline theme script (D3).** No `Content-Security-Policy` header is set in `packages/server` or the `docs/deploy` runbooks (Tailscale Serve, Docker Compose), so the inline pre-paint script is allowed. If a CSP is added later it needs a hash for that script.
