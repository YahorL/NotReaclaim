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

Component classes (`@layer components` in `index.css`): `.glass`, `.glass-card`, `.btn-glass`, `.btn-primary`, `.btn-accent` (lime), `.chip`, `.block-meeting`, `.block-task`, `.block-habit`, `.block-blocked`, `.toast`, `.focus-ring` (`outline 2px` focus colour `--c-focus`, offset 2px — see §6). These are literal class names (JIT-safe) and keep multi-value tokens out of 200-char utility strings.

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
`theme.ts`: `type ThemePref = 'light'|'dark'|'system'`; `readPref()` (try/catch localStorage), `resolve(pref, mql)`, `apply(theme)` sets `document.documentElement.dataset.theme` and `style.colorScheme`. `useTheme()` returns `{ pref, theme, setPref }`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` while pref is system. `App` calls `useThemeSync()` (a `useTheme()` wrapper) so that subscription exists on every route — the rail's ThemeSwitch is absent on the auth pages and when the sidebar is hidden. Inline script in `index.html` (≤ 15 lines, try/catch) applies the same resolution before React loads. Rail switch: clicking sun/moon sets an explicit pref; Settings Appearance offers System. Theme change toggles a `theme-switching` class for one frame to suppress transitions (prevents every block animating colours).

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
- Contrast ≥ 4.5:1 for text: lime **text** uses `accent-fg` (olive in light); secondary text uses `fg-2` (.66) — `fg-3` (.55, ~3.9:1 in light) only for ≥ 12px non-essential labels (gutter hours); smaller text such as the rail's 10px TIME caption and the palette's 11px `Esc` key uses `fg-2` — checked with the a11y-debugging skill in P8.
- Focus: `:focus-visible` 2px outline offset 2 on everything (`.focus-ring` base style) in the theme-aware **focus token** `--c-focus` (Tailwind `focus`: `outline-focus`, `border-focus`) — never the accent fill. Dark = lime `#C6F432`; light = ink `#111214`, because the light lime fill `#D7FF3F` is ~1.1:1 on the light page/cards and olive `#3F4D00` is only ~1.9:1 on the meeting tile, where CalendarBlock draws the ring inset. Field boxes and inputs that drop their outline (`FieldBox`, CreatePopover, TaskDrawer subtask input) use a full-strength `border-focus` on focus. WCAG 1.4.11 ≥ 3:1 against `--c-page`, `--c-card` and `--c-meeting` in both themes is pinned by `tokens.test.ts`. Blocks show the outline above the selection outline.
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
- **Order.** `useFocusTrap(ref, { onEscape, restoreTo, initialFocus })` was extracted from `Sheet.tsx` first, in its own behaviour-preserving commit, because 2.6 consumes it before 2.8. It returns the `onKeyDown` handler for the surface. Contract for P5: put the handler on the dialog element, and pass `initialFocus` explicitly. The `restoreTo`/`initialFocus`/`onEscape` options are tested in `Sheet.test.tsx`. **Do not rely on `autoFocus` alone.** Under `<StrictMode>` (`main.tsx`, dev), effects run twice. The first cleanup refocuses the opener, and when the dialog was opened from a focused button, the re-run then focuses the container instead of the autoFocused field. P5's dialog will hit this. `initialFocus: () => inputRef.current` fixes it, and a StrictMode test in `TaskSearchPalette.test.tsx` pins it.
- **AccountMenu does not use the modal trap.** It follows the WAI-ARIA menu-button pattern:
  - Opening focuses the first item; ↑/↓/Home/End move between items.
  - Escape closes the menu and refocuses the button; Tab closes it and lets focus move on.
  - An outside press closes it **without** moving focus, since that press may be focusing something else.
  - Items are `role=menuitem`, so tests query `getByRole('menuitem', { name: /sign out/i })`.
- **Rail.**
  - The `data-testid="sidebar"` element is the `<nav aria-label="Main">` itself (`hidden md:flex` kept). It has `rounded-panel` (22px, matching the screenshots; `--radius-rail` 38px is unused) and `relative z-30`.
  - It has no overflow clipping, so the `::after` tooltips (`data-label`) can overhang the content column.
  - Wells and the theme knob have no token. They use a literal `[[data-theme=light]_&]:` variant (`RAIL_GROUP` in `NavItem.tsx`). There are no new tokens: `index.css`/the config stay frozen.
  - On short viewports (`[@media(max-height:760px)]:` variants) the items, logo, gaps and spacer compact, so Settings stays on screen down to ~620px tall (measured live at 650px). The old 280px sidebar scrolled. The rail can't, because overflow would clip the tooltips. Below ~620px the bottom items clip; P8 should decide whether that matters.
  - `NavLinkItem` sets `data-active` via `useMatch`. `NavSection` and the collapsible group are deleted.
  - The legacy `sidebar*` colours and `.dark-scroll` now have no users; P8 removes them.
- **ThemeSwitch.** `aria-pressed` follows the **resolved** theme, so exactly one button is pressed under "system". Clicking a button stores an explicit pref.
- **Header.**
  - `routeHeader(pathname, { nowMs, zone, openTaskCount })` is a pure function returning `{ eyebrow, title: [before, bold, after] }`. The compact `routeTitle()` lives in the same file (`routeTitle.ts` is deleted).
  - The Stats eyebrow uses the Mon–Sun settings-zone week that the Stats page reports on (e.g. "Week 48 · Nov 23 – Nov 29"), not the screenshot's Tue–Mon.
  - The Priorities count is active (pending/scheduled) tasks. It reads "Tasks across…" while the count is unknown.
  - The right cluster is: sidebar toggle (D20, 46px glass) · Now/Next pill · Search · New task · avatar. The pill and the toggle are not in screenshots 01/02 (expected deviation, owner decisions).
  - Header bottom is at 101px and content starts at 121px at md+ (one-row header). The header is `flex-wrap` and wraps below ~1150px, so the drawer slot is **not** a fixed offset: AppShell measures `shell-content`'s top (ResizeObserver, which also catches the Google banner) into `--drawer-top` on the shell root, and `DESKTOP_DRAWER_SLOT` (`DrawerHost.tsx`) is `fixed right-3 top-[var(--drawer-top,120px)]` for the Planner, Priorities and shell drawers. `DrawerPanel` max-height is `calc(100dvh - var(--drawer-top,120px) - 20px)`. The 120px fallback covers jsdom and pages rendered without the shell; 0 is never published.
- **Now/Next pill.**
  - Only TopBar uses the structured label: "Now · title" or "Next · title · Today 2:00pm", with the title truncated by CSS `max-w-[24ch] truncate`. `useNowNextControls` now also returns `nextTime`. `nextLabel` (mobile) reads "Next · title · time".
  - The pill still renders on `/`. Task 3.5 owns the `pathname !== '/'` gate.
- **Search.**
  - Palette state, the `/` and Ctrl/Cmd+K listener (`useTaskSearchShortcut`) and `ShellTaskDrawer` live in `AppShell`.
  - The shortcut is ignored in editable targets (event target or focused element), while any overlay is open (`OVERLAY_OPEN_SELECTOR` in `lib/overlay.ts`: `[role=dialog]`, `[aria-modal=true]`, `[role=menu]`, the create popover — shared with the planner's Escape-to-deselect), and for keys that were already prevented. `NewTaskModal` is `role=dialog aria-modal=true aria-label="New task"` ahead of its P5 restyle.
  - `useFocusTrap`'s Escape calls `preventDefault` (not `stopPropagation`: dnd-kit's KeyboardSensor listens on the document and must still see Escape to cancel a keyboard drag inside a sheet). Document-level Escape listeners (CreatePopover, Planner deselect) ignore `defaultPrevented` events, so Escape in the palette no longer closes the create popover under it.
  - A blank query shows "Type to search your tasks"; nothing listed matches "No tasks match".
  - Selecting a task moves focus into the desktop `ShellTaskDrawer` (its first field; passive effect, after the palette's own restore to Search), and closing the drawer returns focus to the opener when it was left on `<body>`. Compact hosts in a Sheet, whose trap covers this.
  - Below md the header is hidden and `MobileTopBar` pins "no search button", so search on phones is keyboard-only (hardware `/`). Decide in P8 whether to add a mobile entry point.
  - Z-tiers: shell drawer `z-[55]` (above page drawers at z-50), palette `z-[60]`, toast region `z-[70]`.
- **Toasts.**
  - `useToast()` outside a `ToastProvider` is a **silent no-op**, because pages render bare in tests. Page tests that want to assert a toast must wrap in `ToastProvider`.
  - P4 anchoring: `const { setAnchor } = useToast(); <div ref={setAnchor} … />` portals the visible pill into the planner panel. The `role=status` live region stays in the shell with an sr-only copy. Call `setAnchor(null)` (ref cleanup) on unmount.
  - Under reduced motion `animate-toast` is omitted, not just shortened: its keyframe ends at opacity 0 with fill `both`. `data-animated` exposes this to tests.
- **Primitives.**
  - The Sheet surface is `[background:var(--x-dialog-bg)]` + `shadow-modal`, **without** `.glass-dialog`, because a `backdrop-filter` (non-none in light) would make the sheet the containing block for `fixed` descendants.
  - The backdrop is `bg-overlay backdrop-blur-[8px]`, but only when not collapsed. `data-full-screen`/`data-collapsed` were added for tests.
  - `DrawerPanel` desktop = `.glass-dialog rounded-panel`. `FieldBox` shows its focus cue as `focus-within:border-focus` (the §6 focus token; was `accent-fg/60`, ~3:1 at best on light cards), because the controls inside have `outline-none`.
- **Icons.** `planner`/`priorities`/`stats` glyphs were redrawn to the prototype paths. `pin`/`play`/`stop`/`user` are drawn in the same style, since the prototype has no glyph for them (and the location pin is excluded). `grip` is re-centred on the 24 grid.
- **Mobile.** The tab bar and top bar are `.glass` with `rounded-none` and one-side borders. The active tab is a 48×28 accent pill behind the icon, plus `aria-current`/`data-active`. The Habits tab now uses the `habits` glyph.
- **Left for later phases:**
  - Pages still carry their own outer padding (e.g. Planner `md:p-4`), so content sits ~12–16px inside the header's left edge (P3/P7).
  - The Buffers card heading duplicates the new "Scheduling buffers" headline (P7).

### P3 implementation notes (2026-11-25): deviations and contracts for P4
- **Block layer (D9) — proven live** in Chromium and Firefox at 7, 4 and 2 columns and with `dayStartMinute=180`.
  - The body grid is `[gutter | days area]`. The days area holds the `day-col-i` columns (click-to-create, `DayDropZone`, `data-drop-target`, `data-today`, grid lines from an inline `repeating-linear-gradient`) and one `block-layer`.
  - The layer is `pointer-events-none`, and each tile wrapper opts back in. An empty-slot click therefore reaches its column, and elementFromPoint on a block returns the block.
  - **Stacking:** we hoisted rather than raising z-index on the columns, because a column painted above the layer would also take the blocks' clicks. The drop indicator and the desktop `CreatePopover` render in per-column `col-slot-i` wrappers inside the layer (`z-30`, `pointer-events-none`). The popover itself is `pointer-events-auto`.
  - The now-line (`data-day-index`) lives in the layer too.
- **Layer child order is by key** (`b:`/`e:` + id), not by day or time, so a cross-day move never re-inserts the DOM node. Side effect: **Tab order across blocks follows ids, not time**. P4's keyboard task should decide whether that matters (e.g. a roving tabindex in time order).
- **Block geometry:**
  - Tiles carry `data-day-index` and `data-block-key`.
  - `left`/`width` come from `blockLeftCss`/`blockWidthCss`: 5px inset at column edges, 2px between lanes.
  - jsdom serialises `calc()` percentages rounded, so tests compare through a `cssCalc()` round-trip.
- **InteractiveBlock contract:**
  - One column = `closest('[data-testid="block-layer"]')` width / `dayCount`. WeekGrid always passes `dayCount`.
  - `onClick(keyboard: boolean)`: a pointer tap with zero delta passes `false`. The body's own `click` counts only when `detail === 0` (keyboard), so the native click that can follow a short drag never selects.
  - Held preview + `landing` bridge are unchanged (P4 replaces them).
- **CalendarBlock:**
  - The body button holds a full-height inner wrapper. A `<button>` vertically centres content taller than itself, which pushed a short tile's time label above its top edge.
  - Titles wrap by word and clip, never `overflow-wrap:anywhere` (that stacked letters in narrow lanes).
  - Right padding is reserved only for what is always visible in the corner cluster: lock/pin, plus × on coarse pointers.
  - Accessible name: "<title>, <Wed 9:00 AM – 10:00 AM>, <locked, synced from Google | movable, drag to reschedule>". **P4** should add the arrow-key wording and `aria-describedby` once keyboard moves exist.
  - Started tasks get a 3px accent bar (`started-bar`). There is no play icon or "Now" dot: the pin keeps the icon slot.
- **Times:** `formatHm` now renders the unpadded hour ("9:00 AM", `hour: 'numeric'`, still the user's locale), matching the design and the detail/Next-up cards. Its callers are all planner surfaces: tile labels, tile accessible names, the drag/resize label and the CreatePopover slot label.
- **Legend:** four static items (Meetings swatch, Movable dashed swatch, Locked icon, Blocked hatch). P4 turns the first two into the filter toggles.
- **Selection (§5.4, Q6 default applied):**
  - **md+, any pointer:** a click, tap or Enter selects. Behaviour changes: an iPad tap no longer opens the TaskDrawer, and a desktop click on an app event no longer opens the EventDrawer. The card's Open buttons do both.
  - **Below md:** a tap opens the TaskDrawer or EventDrawer. Habit and Google tiles toast "Edit habits on the Habits page" / "Synced from Google Calendar" (they have no drawer). One change: before P3, a task tile opened its drawer only on a coarse pointer, so a mouse click below md did nothing. Now any pointer below md opens it.
  - Escape deselects unless an overlay (`isOverlayOpen()`: dialog, sheet, menu, create popover) is open or the Escape was already handled.
  - Keyboard selection moves focus to the card heading. Closing the card hands focus back to the tile's body.
  - **Known:** the desktop TaskDrawer does not close on Esc (pre-existing). Esc with a drawer open deselects the card underneath.
- **Detail card with the panel hidden** floats at the grid's bottom-right (`absolute`, `shadow-lift`) instead of taking a side column. Narrowing the grid would change `daysThatFit` and could page the selected block out of view, which clears the selection.
- **Detail card actions follow §5.4 literally:**
  - Stop (running) > Unpin (pinned) > Delete. A pinned tile's card has no Delete; the hover × on the tile still deletes.
  - Google meetings get no primary or secondary action, only "Synced from Google Calendar — edit it there".
- **UnscheduledCard:**
  - Copy is "Couldn't schedule everything · didn't fit in your free time": entries include habits, so it does not say "tasks".
  - "+N more" switches the panel to All tasks and shows it (desktop: un-hides it; compact: opens the Tasks sheet). Without `onShowAll` it unfolds inline.
  - The compact card always renders, so Re-plan stays reachable at 390px with zero entries.
- **NextUpCard:**
  - The header uses `relativeDayTimeLabel` ("Next up · Today 3:29pm"); the chip uses `untilLabel` ("in 1h 29m", "in 1d").
  - Running state: "Now · until 2:45pm" with a "45m left" chip.
  - The second line is the next block of any kind (task or habit).
  - It reads the unranged schedule query, so Planner tests filter `getSchedule` calls by args.
- **Side panel:**
  - Group meta (labels and glowing dots on `pri-*` tokens) is local to `PlannerTaskPanel`, because `priorityBucket.ts` META is P6's to migrate.
  - The "Next: …" time moved to its own line (`panel-next`). Beside the due date it starved the progress bar.
  - The panel is `min-h-0 flex-1` inside a 330px side column, under the detail card.
- **Planner padding** is `px-1 pb-1` at md+ (was `md:p-4`), so the panels line up with the header.
  - **P8:** in light theme the panel shadows are clipped by AppShell's `shell-content` `overflow-auto` box, which shows as a faint hard-edged rectangle around the content area. Confirmed live: forcing `overflow: visible` on `shell-content` makes the edge disappear. The fix belongs in AppShell's padding/overflow contract (P2-owned, `AppShell.test` pins the padding).
- **Coarse resize target** (pre-existing): on tiles of 30 minutes or more the 24px handle covers the lower part, so on touch a press in the bottom half of a 45-minute tile resizes instead of long-press-moving. P4's resize task may want a smaller hit area plus a visible grip.
- **Suite:** 1042 → 1137 (`EventBlock.test` and `UnscheduledWarning.test` were replaced by `CalendarBlock`/`blockStyle` and `UnscheduledCard` tests).

### P4 implementation notes (2026-11-25): deviations and contracts for P5/P8
- **Snap rule (deviation from §5.2, owner can flip).** `dragModel.moveTarget` / `resizeTarget` snap the *delta* to 15 min, not the absolute start (`snap15(origStart + dy)` in §5.2). This is what the pre-redesign InteractiveBlock did and what the arrow keys do (±15). A 9:05 block therefore moves to 9:20, and a pure cross-day move keeps its exact time. Side effect: the engine places on a 5-min grid (R24), so a block at 11:10 can never be dragged onto :00. Flipping this means changing one line in `moveTarget`/`resizeTarget` and their tests.
- **Release without a jump.**
  - WeekGrid holds a released or keyboard-previewed target in a *pending override* map, keyed by block. Each entry stores `{start, end}` plus the baseline times the data had when it was set, and is applied before `layoutWeek`.
  - An override renders only while the data still shows that baseline. Once the optimistic write lands, or the server puts the block elsewhere, the data wins.
  - A committed override expires after `HOLD_TIMEOUT_MS` (1.5s). On a failed write the tile then springs home.
  - The release render drops the inline transform and moves the geometry together, with the spring transition on. The held-preview/`landing` machinery is deleted.
  - Idle tiles carry **no inline transform**, so `animate-ev-in`, `animate-land`, `animate-shake` and the filter `scale-[.92]` all work. Spring transitions on top/left/width/height/transform are always on, except while dragging or resizing.
  - Live-sampled every animation frame after mouse-up in Chromium and Firefox, for vertical, cross-day left/right and off-grid drops, and for a rollback (PATCH forced to 500). The first frames sit at the drop point, and no frame comes near the origin.
- **Resize** keeps the pointer-capture path (first-pointer-wins, touch), not the prototype's window listeners.
  - Handle heights: fine pointer `h-2.5` (the design's 10px) on tiles of 30 min or more. Coarse pointer `h-3` on 30–59 min tiles and `h-4` from an hour, so it never reaches the lower half (the P3 note). Every pointer gets `h-1.5` on tiles under 30 min.
  - The grip shows on hover and focus, always shows on touch, and widens 22 → 30px while resizing.
- **Mouse threshold.** A mouse press becomes a drag only past 5px. A drag released back where it started commits nothing and is not a click. A long press lifted in place and released still counts as a tap.
- **Keyboard.**
  - ↑/↓ move by 15 min, ←/→ by one day, Shift+↑/↓ change the length, Delete removes. Each step previews through the hold; one commit goes out 400ms after the last key, or at once on blur, unmount or pointer-down.
  - At the edge of the rendered days the toast reads "Use the arrows above to see more days" (Q4 default: no auto-paging).
  - Block names end "movable: drag or use arrow keys, Shift+arrows to resize", with `aria-describedby` pointing at the hidden `#planner-block-keys`.
- **Tab order = time.**
  - The layer renders in day-then-start order, but the DOM order only catches up 700ms after the last order change, and only while nothing in the layer is focused, dragging, resizing, settling, held, new, entering or shaking (`useCalmTimeOrder`).
  - The reason: React re-inserts a moved node, which would drop focus and kill the spring.
  - Live in both browsers: ArrowDown past a neighbour keeps focus, the next ArrowDown still moves the block, and the order fixes itself after blur.
  - A replan that reorders blocks glides first (550ms) and reorders afterwards. This was not separately forced live.
- **Locked tiles** (`LockedBlock`): a press or an arrow key runs `useShake` (450ms, restartable, skipped under reduced motion) and shows the toast "Locked — synced from Google Calendar". The toast is anchored in the calendar panel through `setAnchor` (`planner-toast-anchor`). A click still selects.
- **Bug found live and fixed:** a press-drag across a (selectable) locked tile selected text over the grid. A later drag of a movable tile inside that selection became a native drag of the text, and Chromium cancelled the pointer. Tiles are now `select-none`, cancel `dragstart`, and a press clears any stale selection.
- **Filters.**
  - `usePlannerFilters` persists `nr.plannerFilters`. The toggle pills replace the first two legend chips, which is why the legend clip is now `max-h-[36px]`.
  - Hidden tiles stay mounted with `data-hidden`/`aria-hidden`, are faded and scaled, are `pointer-events-none`, and have `tabIndex=-1` on the body and the action buttons.
  - **Deviation:** the toggles are md+ only, so the compact layout ignores saved filters. Otherwise a desktop filter would strand hidden tiles on a phone with no way to bring them back.
- **Re-plan.**
  - The block ids are snapshotted at the click. On success, the drop-in waits for the in-flight schedule refetch, or diffs at once if it has already landed (`queryClient.getQueryState` fetchStatus). It is cancelled if the user pages away.
  - The spinner shows for at least 600ms.
  - Live: a deliberately deleted block came back with a new id and dropped in (`land`) in both browsers.
- **Entrance.**
  - Panels `animate-rise` with a 60ms stagger, on route mount only; the classes come off afterwards.
  - Blocks `animate-ev-in` with a 45ms × day stagger. WeekGrid's `entranceKey` drives it: the Planner passes the loaded range, from the ranged schedule and calendar queries only.
  - Side-panel ticks pop the check and draw the strike while the save runs, then un-tick after 4s if the task is still listed.
  - Reduced motion skips all of it in JS as well.
- **Follow-up fixes after the review pass:**
  - Filtered-out tiles skip the entrance and the drop-in. Both keyframes end at opacity 1, which overrode `opacity-0`; live-sampled max opacity is now 0 in both browsers.
  - On touch, a Google tile refuses only after a long press, so a scroll that starts on it no longer shakes. A live swipe scrolls with no toast, and a long press shakes and toasts.
  - A press still under the threshold (`data-pressed`) counts as busy for the calm reorder.
  - The grid receives blocks and events only once both ranged queries have loaded, so the entrance never restarts tiles that already painted.
  - Backspace deletes a focused block like Delete. The spec mentions only Delete.
- **Also verified live (Chromium + Firefox):** 3-day cross-day drag (Chromium), edge auto-scroll whose commit equals the ghost label, panel-card → grid drop (`POST /schedule`), and drag/resize/keyboard/app-event persistence after reload. The live pass moved, pinned and deleted demo blocks in the dev DB. The seeded Google meeting and app event were removed afterwards.
- **For P5:** "Task created" toasts on the planner render inside the calendar panel (the anchor is global while the Planner is mounted). `PlannerTaskPanel` now has local tick state, so P5's `data-fresh` should go on the same card root.
- **For P8:**
  - Headless Firefox samples sparse frames (34/101/217ms) during the release spring. Positions follow the curve, but it is worth a look on a real Firefox.
  - Real-device Android long-press and the smaller coarse resize handle are not yet verified on hardware (CDP touch emulation passes).
  - Ghost pills follow the browser locale (headless Firefox showed 24h "Thu · 16:15").

### Survey notes for risky assumptions (checked 2026-11-24)
- **Block id stability (D13).** `packages/core/src/apply.ts` applies the desired schedule as a keyed (`engineKey`) in-place diff: a block whose engine key survives a replan is **updated in place and keeps its id**, so moved blocks glide and only genuinely new chunks drop in. Caveat: when a task's chunk count changes, keys are reissued and some blocks are deleted/created — those will drop in. That is acceptable ("newly placed" is a fair reading).
- **CSP vs the inline theme script (D3).** No `Content-Security-Policy` header is set in `packages/server` or the `docs/deploy` runbooks (Tailscale Serve, Docker Compose), so the inline pre-paint script is allowed. If a CSP is added later it needs a hash for that script.

### P7 implementation notes (2026-11-25): Stats, Habits, Buffers, Hours, Settings, auth
- **Branch.** Built on `feat/redesign-p7` from 5633409, so none of P4's planner work is in it. No planner, shell, config or `index.css` file was touched.
- **Shared P7 modules (new files, P7-owned):**
  - `app/forms/Segmented.tsx` is one glass pill switch with two roles. As `tablist` it is the Stats Chart | Table switch; as `radiogroup` it is the Settings Appearance choice. Both rove (←/→/↑/↓/Home/End move the selection and focus).
  - `app/forms/controls.ts` holds class strings: `CAPS_LABEL`, `INPUT` (recessed surface, `outline-none` + `focus:border-focus` per §6), `CHECKBOX` (the prototype `.cb` built from Tailwind arbitrary variants: 20px, accent fill, `::before` clip-path tick, 24px on a coarse pointer), and `DANGER_TEXT_BTN`.
  - `auth/AuthCard.tsx` provides `AuthCard` and `AuthField`.
- **Stats:**
  - **KPI number size.** 56px at md+ and 40px below. The plan said 64px and the prototype `.kpi-v` says 48px; the screenshot measures about 56px.
  - **Task series kept.** It uses `chart-task`, so the legend, stack, table and donut show three series in one fixed order: meetings, habits, tasks. `donutSegments` was reordered to match.
  - **Y axis.** `chartScaleMs` (an 8h floor) is replaced by `axisScale`: the smallest step from {1,2,3,4,6,8,12}h that needs at most 4 intervals.
  - **One source for numbers.** The bar value labels and the Table view (day rows plus a totals row, `th scope=row` day cells) both read `dayTable`.
  - **Donut.** `donutArcs` follows the P1 `donut-draw` contract. A 10-unit gap is taken off each arc, a lone segment is the full ring, and no arc length goes negative.
  - **Not done here.** Light-theme chart colours are not validated; that is P8.
- **Buffers:**
  - **Stepper.** `stepBuffer` moves to the next multiple of 5 in the pressed direction (7 → 10 / 5). It floors at 0 and has no upper clamp. A negative or NaN field restarts from 0.
  - **Preview widths.** Each segment's width is its share of the strip's total minutes, not px per minute, so unclamped buffers never overflow.
  - **Preview task colour.** Preview tasks are dashed accent (lime, olive in light) as in screenshot 10, not the planner's neutral `.block-task`.
  - **Status line.** "Unsaved changes" (`unsaved`) compares against the last value the server confirmed (seeded from the load, then updated by the mutation's `onSuccess`). It therefore clears on success without waiting for the settings refetch. "Saved" shows only when nothing is unsaved.
  - **Heading removed.** The card heading that duplicated the headline is gone (P2 note).
- **Hours:**
  - **Colour swatches** are a `radiogroup` of named radios (Indigo … Brown, No color; testids keep the hex). **Deviation from the ARIA radio pattern:** each pick PATCHes, so arrows only move focus (roving tabindex) and Space/Enter/click selects.
  - **Weekly chip.** It reads "Follows Settings" for an inheriting default, otherwise `weeklyHoursTotal`. It follows unsaved editor rows.
  - **`WeeklyHoursEditor` changes:**
    - Each row is a grid; the checkbox sits inside a `<label>` with the day name, so the name toggles too. This closes the old "make the whole row hittable" follow-up. `coarse:py-2` is now on that label.
    - Time inputs are named ("Monday start time").
    - `showCoverage` adds the 24h bar (`${idPrefix}-${wd}-bar`, category colour or accent, dimmed when the day is off) plus a ticks row. Both are hidden below `sm`.
    - Settings does not pass `showCoverage` (matches screenshot 12).
- **Settings:**
  - **Layout.** The grid switches at `lg`, not `md`: the 7-row hours editor does not fit a half-width card at 768px. Order: Working hours (live `weekly-total`) | Timezone + Planner, then Scheduling full width, then Save (kept), then Appearance | Account on their own `lg:grid-cols-2` row, then the mobile rows and the version footer.
  - **Appearance** sits outside `settings-form` because it applies instantly through `useTheme`; System clears `nr.theme`.
  - **Steppers.** Min/Max chunk still use P5's `DurationStepper`; check them live after P5 merges.
  - **Account.** The password field is named. "Password saved" is a `role=status` line and errors are a `role=alert` line. Reconnect is a glass pill with danger text, replacing the red fill (which has poor light contrast).
- **Habits:**
  - **Delete button** is now named "Delete <title>" (was "delete"). The tests were updated to match.
  - **At-risk chip** reads "N missed" with a warning icon (title and testid kept). It uses `text-danger` because there is no warning-surface token.
  - **Day pills** run Sunday first and are `aria-hidden`, with an sr-only "Days: Mon, Wed, Fri" / "Days: any day". The meta line also says "any day" when all 7 days are eligible.
  - **Summary strip** (`habitSummary`) shows only once habits have loaded.
  - **Edit overlay** uses `bg-overlay` + blur. HabitDrawer's day toggles get day names and `aria-pressed`.
  - **QuickAdd** takes an optional `label` prop for its accessible name.
- **Auth.** SignIn and Register use AuthCard. `ProtectedRoute` has no loading state (it redirects synchronously), so it is unchanged.
- **Palette sweep: hits outside P7 files, left to their owners (P8 should check they are gone):**
  - `NewTaskModal` (`indigo`/`ink*`/`crit`/`#c7cad6`), `PriorityPicker` and `DurationStepper` (`text-indigo`): P5.
  - `priorities/*` (`TaskRow`, `Column`, `Dropdown`, `TasksCard`, `Toolbar`, `Board`, `priorityBucket` `#aeb2c0`) and `pages/Priorities.tsx`: P6.
  - `AccountMenu`, `ThemeSwitch` and `NavItem` light-theme literals (deliberate, no token): P2/P8.
  - The `CalendarBlock` delete button (`bg-black/30 text-white`): P3/P4.
- **For P8's light pass: `rgb()` literals in P7 files the sweep regex cannot see.** The inset white highlight on the Segmented selected state, the inset black shadow on the QuickAdd input, and the inset white highlight on the colour swatches.
- **Layout, tablet widths (768–1023px).** The KPI row wraps (`md:flex-wrap`, cards `md:basis-[220px]`, the prototype's `minmax(220px)`). The Settings Scheduling fields become 3 columns only at `lg`.
- **Contrast.** Small text (under 12px) uses `fg-2`, not `fg-3` (§6): the y-axis ticks, the coverage ticks and the off-day habit pills.
- **Still needs live verification:**
  - Every P7 screen in both themes at 1440 and 390 against 08–12.
  - The custom checkbox tick rendering in Firefox and Chromium.
  - Native time/number/select pickers following `color-scheme`.
  - Stats bar grow-in and donut draw-in, including under reduced motion.
  - The Buffers preview width transition.
  - The `lg` breakpoint wraps in Settings.
  - Light-theme contrast of `accent-fg` day pills and of the dashed preview tasks.
  - The Hours time inputs at 390px, where each is only about 83px wide.
  - A week whose busiest day lands exactly on the top axis tick, where the bar's value label sits above the plot top.
  - The KPI row and Settings at 768–1023px.
- **Suite:** 1155 tests / 97 files → 1230 tests / 104 files.

### P5 implementation notes (2026-11-25): New task dialog, plus the P7 live pass
- **PriorityPicker** is `role=radiogroup aria-label="Priority"` with `role=radio aria-checked` pills (still `type=button`). Roving tabindex (only the checked pill is a tab stop). ←/→/↑/↓ move **and select**, wrapping, and Home/End jump to the ends. Selection-follows-focus is safe because picking has no side effect, unlike the Hours swatches. Dots use `pri-*` tokens locally; `BUCKET_META` stays P6's. A coarse pointer gets `coarse:h-11`.
- **DurationStepper.** Default: 22px tabular value with 34px round `.btn-glass` −/+ buttons. Callers passing `size < 26` get a **compact** variant (`data-compact`: 17px value, 30px buttons), because the drawers' half columns and the CreatePopover cannot hold "2 hr 15 min" at 22px. `size` also scales the icon. Both variants are `coarse:h-11 coarse:w-11`. The value never shrinks below its text (`flex-[1_0_auto]`), and the −/+ pair wraps under it as a unit (`flex-wrap`, `ml-auto`) where a column is too narrow. Found live: TaskDrawer at 1024px with touch, where "1 hr 30 min" ran under two 44px buttons. Fine pointers at 1440 and 390 stay on one row. Labels are unchanged ("1 hr 30 min"; the design's "1 hr 15 mins" was not adopted). New `minus` icon appended.
- **Dialog close path.**
  - One idempotent `requestClose`: Escape (through `useFocusTrap`), ✕, Cancel, a backdrop press, and a successful create.
  - It sets `data-closing` on the backdrop and dialog (`animate-bd-out`/`animate-modal-out`, backdrop `pointer-events-none`), then calls `onClose` after `MODAL_EXIT_MS` (220). Under reduced motion it calls `onClose` at once.
  - Backdrop close requires the press to **start** on the backdrop, so a text selection dragged out of a field does not close.
- **Focus.**
  - `initialFocus` = the name field (StrictMode note from P2).
  - AppShell records the **clicked** opener (`e.currentTarget` of the header New task / mobile `+`) and passes it as `opener` → `restoreTo`. A click does not focus a button in Safari (or jsdom), so the trap's render-time capture would have been `<body>`.
  - Live in Chromium and Firefox: focus returns to the button that opened the dialog.
- **Enter** is handled on the name field only (IME composition ignored), not via a `<form>`. That keeps Enter in the datetime inputs and the inline category field from creating the task. Enter in the inline category field adds the category, and Escape there backs out of the field without closing the dialog. A ref guards against a double Enter during the request.
- **Layout.**
  - Three pairs are `grid-cols-1 sm:grid-cols-2`: Duration|Priority, Min|Max and the two date fields. The prototype stacks them at ≤560px. Before, Min|Max was `flex-col md:flex-row`.
  - Max width is 600px (prototype `.modal`; was 500). The mobile near-full-screen classes (`min-h-[calc(100dvh_-_88px)] md:min-h-0`, `pt-14 md:pt-[70px]`) are kept.
  - **Split off ⇒ Min/Max are not rendered** (were disabled). The reseed test that waited for "45 mins" with Split off now peeks by toggling Split on and off.
  - The Hours, Schedule after and Due date fields use real `<label for>`.
- **After create.**
  - `useToast().show('Task created', { icon: 'check' })`. On the planner it renders in the calendar panel (P4 anchor).
  - `RecentlyCreatedProvider` (shell) holds the created id for `FRESH_HOLD_MS` = 4s, because the card mounts only after the tasks refetch. `PlannerTaskPanel`'s card root gets `data-fresh` + `animate-fresh`. Outside the provider nothing is fresh.
  - Live: the glow appeared ~300ms after the toast in both browsers.
- **Live P7 fixes (each with a test):**
  - `WeeklyHoursEditor` at 390px (Hours **and** Settings): Chromium clipped "09:00 AM" to "09:0". Below `sm` the day column, gaps and padding are tighter (inputs 83 → 100px) and Chromium's picker icon is hidden; a tap opens the native picker on touch.
  - Settings Min/Max chunk now use the full-size stepper (it passed `size={22}`, which became the compact variant).
  - The Habits summary strip at 390px wrapped "paused" and left a divider dangling. Below `sm` the numbers are 34px with 16px gaps.
- **Verified live, no change needed:**
  - The custom checkbox tick (`::before` scale 1, `clip-path`) in Chromium and Firefox.
  - `color-scheme` follows the theme on the root, the select and the time inputs (both engines, both themes).
  - Stats `grow` ×3 and `donut-draw` ×2 run on mount; reduced motion runs nothing.
  - The Buffers preview animates widths (5 width transitions with intermediate values), and nothing runs under reduced motion.
  - Light contrast (approximated by compositing): eligible habit day pills 7.3:1, off pills 5.5:1, preview task text 7.3:1.
  - Sign-in and Register pages in both themes at 1440 and 390, no overflow.
  - No horizontal page overflow on any P7 route at 1440/900/390 in either engine.
- **For P8:**
  - **Header at ~900px.** The right cluster wraps and leaves the avatar alone on a second row (Stats, Hours and Settings at 900). P2's header contract.
  - **Stats KPI row at 900:** 3 + 1 wrap, so "Tasks done" spans full width.
  - **Buffers preview at 390** is a horizontally scrolled `min-w-[480px]` strip (decorative, `aria-hidden`), so the second task is clipped until scrolled.
  - **QuickAdd input in light** has a heavy grey inset look (the P7 `rgb()` inset shadow note).
  - **Headless Firefox** renders the dialog backdrop dimmed but without visible blur, although the computed `backdrop-filter: blur(8px)` and `bg-overlay` match Chromium. The search palette's backdrop was screenshotted in the same run and looks the same, so this is a harness/compositor limit, not a P5 difference. Check both on a real Firefox.
  - **TaskDrawer date fields at 1024px** clip "06/10/2026, 12:0" (pre-existing drawer markup, not P5).
  - **Light Stats "Tasks done" bar:** the lime fill on the light track has very low contrast.
  - **Not verified:** Escape while a native select or date picker is open (headless cannot drive native popups); a Stats week whose busiest day sits exactly on the top tick.
  - **The created task can be hidden.** If it lands past the fifth card in its priority group (behind "Show N more"), the glow plays on a hidden card. Low priority is the default, and Low is often the long group. Consider auto-expanding the group for a fresh id.
- **Suite:** 1346 tests / 109 files → 1381 / 110.

### P6 implementation notes (2026-11-25): Priorities board deviations and contracts
- **Keyboard model.** Direct grip arrow keys, as in the prototype, replace dnd-kit's lift/move/drop.
  - With a card's grip focused, ↑/↓ swap it with its neighbour. ←/→ move it to the neighbouring *rendered* column at the same position, clamped to that column's length. Hidden columns are skipped, Backlog is included, and Completed is neither a source nor a target.
  - The logic is the pure `keyboardMove` in `boardDnd.ts`. Each key press is a move through the existing `onMove`/`taskMovePatch`.
  - **Why:** the plan assumed `boardKeyboardCoordinates` plus a jsdom-testable KeyboardSensor. That getter is rect-based (jsdom rects are 0), it could not reach an empty column, and ←/→ landed on whichever card was geometrically closest rather than on the neighbouring priority.
  - The board therefore has **no KeyboardSensor**: `usePointerSensors()` is new in `dnd/sensors.ts`, and `useDragToScheduleSensors` delegates to it. `boardKeyboardCoordinates` and its tests are deleted; `keyboardMove` tests cover the same guarantee (ArrowUp on the top card is a no-op).
  - dnd-kit's "press space" instructions are replaced with arrow-key wording.
  - Focus follows the moved card. A cross-column move remounts it, so Board refocuses `[data-task-id] [data-grip]`.
  - Keyboard moves announce through Board's own `role=status` (`board-announcer`). Pointer drops announce through a `makeAnnouncements` onDragEnd override. Both read "Moved X to High priority, position 2." (`moveAnnouncement` + `dropPosition`, which accounts for a same-column downward move).
- **Activation.**
  - Mouse: a drag starts from the card body or the grip, never from ✓, the kebab or the checklist. A click still opens the TaskDrawer; a click on the grip does not.
  - Touch: a drag starts **only from the grip** (`touch-none`, 250ms hold unchanged). The card is `touch-pan-y`, so a swipe on the body always scrolls.
  - The card is no longer a focusable dnd-kit node (the old `role=group` and `tabindex` are gone). The grip (`aria-label="Drag <title>"`) carries `aria-roledescription`/`aria-describedby`. Completed cards render no grip.
- **Pointer DnD stays single-container.** We did not adopt dnd-kit's multi-container pattern.
  - The source card becomes a dashed accent placeholder of its own height (`data-placeholder`/`data-dragging`, contents `invisible`), and dnd-kit's sorting opens the gap inside its own column.
  - In another column, the hovered column gets `data-drop-target` (accent border + ring). A 3px accent **drop line** (`drop-indicator`), which takes no layout space, marks the landing slot: before the hovered card, or at the end on the column's empty area.
  - **Deviation from the design:** the placeholder does not travel into the other column. A layout-shifting placeholder there would move the hovered card out from under the pointer and oscillate.
  - Droppables use `MeasuringStrategy.Always`.
  - The column droppable is the whole grid cell, which stretches to the row height. Its empty area therefore works as a "drop at end" target, including on a collapsed column, which then expands.
- **No snap-back.**
  - Board paints a move synchronously by rendering `applyBoardDrop(...)` (`Held`, keyed on the `columns` identity it came from; ignored once new columns arrive).
  - `Priorities.onMove` then makes the move optimistic: `await cancelQueries(['tasks'])`, snapshot, write the patch into every cached `['tasks', …]` list, then `mutate`. On error it restores the snapshots and invalidates.
  - The cancel is load-bearing. The previous move's post-success refetch may still be in flight, and its pre-move response would land on top of the write and step the card back. A test pins this.
  - Residual (follow-up): a refetch that *starts* after the write but is served before the server applies the PATCH depends on server ordering.
- **Motion.**
  - `DragOverlay`: a clone with grip, check, title, "Due m/d" and duration chip, `rotate(-1.5deg) scale(1.03)` (`data-tilt`), `ring-accent/65`, `shadow-lift`, opaque `bg-card`.
  - Drop animation: 520ms on the literal `cubic-bezier(.34,1.4,.5,1)`. The source slot stays hidden while the clone flies into it, and a WAAPI animation straightens the tilt on the way. It is `null` under reduced motion.
  - `useFlip`: 240ms, literal `cubic-bezier(.2,.8,.2,1)`. It now measures `offsetTop` against the column list (`relative`) on **every commit**, and animates only when the order key changed. The old viewport `top` recorded at the last re-sort made every card glide by the pane's scroll distance (or a card's growth) on the next re-sort.
  - `useFlip` is skipped for the commit of a same-column pointer drop (dnd-kit already slid those cards) and under reduced motion. Cross-column drops and keyboard moves animate.
- **Layout.**
  - The board is `grid grid-flow-col auto-cols-[min(372px,85vw)] md:auto-cols-[minmax(260px,1fr)] gap-4` (16px, the prototype gap). The planned "auto-fit when ≥ 6×260 fits, else snap pane" switch needs no measuring: the columns share the width when they fit and the pane scrolls sideways when they don't.
  - **At 1440 with all six columns visible the content (~1300px) is narrower than 6×260+gaps, so the desktop pane scrolls sideways.** Four or five visible columns fit.
  - Collapsed = a header-only card in its full-width cell, not a narrow card.
  - Pane padding is `px-4` + `scroll-pl-4` on phones and `md:px-1` at md+, so columns line up with the header and toolbar. Snap-off-while-dragging is unchanged.
- **Structure and labels.**
  - `TasksCard` is deleted. The count moved to the column header chip (`column-count-<key>`), which removes the unreadable dark `#eef0f4` chip.
  - Column = `<section aria-label>` (region) with an `<h2>` and the chevron `aria-label="Collapse|Expand <name>"` + `aria-expanded`. Collapse state lives in Board.
  - Empty copy: "Drop tasks here", "No completed tasks" (Completed), "No matching tasks" while searching.
  - META dots are on `pri-*` tokens plus a `glow` halo. Backlog is `bg-fg-3` with no halo. `leftBorder` is removed: the dot carries priority, and the card keeps `data-bucket`. `PriorityPicker`/`TaskSearchPalette` read only `.dot` (same colours).
- **Toolbar.**
  - The search field is `type=search` (role `searchbox`), placeholder "Search tasks…", 460px at md+.
  - `Dropdown` follows the AccountMenu menu-button pattern (first row focused on open, ↑/↓/Home/End, Escape `preventDefault` + refocus trigger, Tab closes). Rows are `menuitemcheckbox` + `aria-checked` in labelled `role=group`s, and toggling keeps the menu open.
  - `App.test.tsx` (outside P6's files) had its placeholder query updated; the change is test-only.
- **Test note.** dnd-kit keeps a capture-phase document click blocker for 50ms after a drag ends. jsdom drag tests must wait it out (`releaseDrag()` in `Priorities.test.tsx`), or the next test's first click is swallowed. This caused a flaky failure.
- **Follow-ups (not done):**
  - The ✓ button keeps `aria-label="complete"` (+ `aria-pressed`); naming it "Mark done: <title>" is left to the P8 a11y pass.
  - The card kebab is still plain buttons, not a `role=menu`.
  - Identical consecutive announcements are not re-spoken.
  - Opening the TaskDrawer from the keyboard is via kebab → Edit only (the card itself is not focusable).
- **Live verification after merge:**
  - Landing spring lands in the right slot (same-column and cross-column).
  - The tilt straightens on drop.
  - The drop line and hovered-column border.
  - Drop on an empty column and on a collapsed column (expands).
  - Rapid keyboard moves: ↓ ↓ ↓ and → → in quick succession, with focus kept on the grip throughout.
  - Drag cues use `accent-fg` (olive in light) for the drop line, placeholder, hovered-column border and overlay ring; the light lime fill is ~1.1:1. Check that they read in both themes.
  - Touch drag via the grip with body scroll intact (390px, snap pane).
  - Kebab menu stacking above the next card and next column in light theme (`.glass` has `backdrop-filter` there).
  - The overlay is not clipped by the pane.
  - Both themes vs `07`.
  - The 6-column horizontal scroll at 1440.
- **Suite:** 1155 → 1192 (97 files).

### P8 implementation notes (2026-11-25): light pass, legacy palette removal, QA
- **How it was checked.** Headless playwright-core (Chromium 1223, Firefox 1522) against Vite + the built API. The demo user got design-like calendar data for the pass: seven Google meetings, an app event and a blocked slot. They were removed afterwards, and the board order changed by the DnD checks was restored through the API. Captures are in `review/p8-redesign/` (untracked): side-by-side `pair-*.png` against 01–12, overlays, DnD, 390px grids and the running `NOTES.md`.
- **Carried-over backlog:**
  - **A. Priorities live DnD:** verified in all four 1440 cells (Chromium and Firefox, dark and light). Within-column, cross-column, empty-column and collapsed-column drops all work, and the collapsed column expands. Every drop landed where the drop line or placeholder showed. The overlay was tilted mid-drag and back to about 0° within 250ms of the drop. ↓↓↓ then →→ kept focus on the grip, and the announcer read "Moved X to Low priority, position N.". After reload, all six columns matched. The kebab stacks above the next card in light, and the overlay is not clipped by the pane. Touch (CDP, 390, both themes): a swipe on the card body scrolls with no PATCH; a long press on the grip drags and lands at the placeholder. Cross-column drops go *before* the hovered card even on its lower half (the P6 rule). This matches the drop line, so it is unchanged.
  - **B. Header at about 900px:** the action cluster is `flex-nowrap ml-auto min-w-0`. Below `xl`, and only when the Now/Next pill is shown, New task becomes a round icon (the name is kept as sr-only text); the pill also hides its time. When the cluster still does not fit beside the title, it wraps as one right-aligned row. `--drawer-top` follows through the existing ResizeObserver: measured 183px with two rows and 121px with one.
  - **C. Stats KPI row:** 2×2 grid below `lg`, 4-up from `lg`.
  - **D. Buffers preview:** a fluid strip instead of a 480px scroller. Segment padding is `px-2` below `sm`.
  - **E. QuickAdd input:** now uses the `--x-btn-bg` surface, which is white glass in light, with a soft inset. The Priorities search field had the same heavy look and got the same treatment.
  - **F. Progress fills (Stats, planner panel, TaskDrawer):** now `accent-fg`, lime in dark and olive in light.
  - **G. Hidden just-created task:** the panel unfolds the priority group whose fresh task sorts past the fold and scrolls the card into view (`nearest`). Live: a seventh Low task unfolded its group and glowed. The test task was deleted.
  - **H. Clipped panel shadows:** `shell-content` is `md:-mx-5 md:-mb-5 md:px-5 md:pb-5`, so shadows fade inside the scroller. Content does not move, and the top edge (the one `--drawer-top` measures) is unchanged. `AppShell.test` pins this.
  - **I. Blocked storage:** `tokenStore` guards both property access and the methods. It falls back to memory when storage is missing or the last write failed (quota). Live with a throwing `window.localStorage` getter in both engines, sign-in renders and the auth callback lands on the planner, with no page errors.
  - **J. Phone hour labels:** compact gutter labels use `fg-2`.
  - **K. Time format:** the real mismatch was `formatHm`/`weekdayLabel`/range/due labels (browser locale) against the en-US detail card and Next-up card. Everything now uses `TIME_LOCALE = 'en-US'`, 12-hour. Relative labels read "Today 4:15 PM" (was "4:15pm") and the gutter reads "1 PM" (was "1p"), as in the design. Live with browser locale `de-DE`, both engines show tiles "4:30 PM" and ghost "Sat · 3:45 PM".
  - **L. TaskDrawer dates:** Due by and Schedule after each take a full row. The drawer is 440px at every desktop width, so the clip was not specific to 1024.
  - **M. Firefox backdrop blur:** a bare HTML page with `backdrop-filter: blur(8px)` also renders unblurred in headless Firefox, although the computed value is present, while Chromium blurs it. This is a harness limit, not a CSS cause. Not changed; the owner should check in a real Firefox.
- **8.1 light pass:**
  - **Screens and overlays checked:** every route plus the overlays (palette, account menu, detail card for meeting and task, locked toast, create popover, planner TaskDrawer, board kebab, Filter menu, habit drawer, phone sheets).
  - **Token fixes in `tokens.css` (the light values were wrong):**
    - `fg-3` alpha is now a per-theme var, `--a-fg-3`: .55 dark, .62 light. It was about 4.1:1 on the light page and glass.
    - Light `danger` is now `#B3262E` (was `#C8323A`, 4.1:1).
    - The light meeting gradient is now `#5A66F2 → #4753E3`. The design's `#7381FF` top stop gave white tile text 3.3:1. **Deviation from 02:** slightly deeper violet.
    - `tokens.test` pins all three.
  - **Component fixes:**
    - The now-dot is on `bg-accent`, lime on the ink line as in 02.
    - The drag ghost and the lifted tile's ring moved to `accent-fg` (light lime was about 1.1:1).
    - The create sheet on phones now portals to `<body>`. In light, the calendar panel's `.glass` backdrop-filter was the containing block for the sheet's `fixed` backdrop, which shrank to the panel.
    - A scan found no other `fixed` element trapped in a filtered ancestor, apart from dnd-kit's 1×1 live regions.
  - **Chart colours:** checked with the dataviz validator (`--pairs all`).
    - **Passes, both themes:** CVD separation (worst ΔE 26.8 light / 26.4 dark), the normal-vision floor (27.7 / 28.5) and contrast ≥ 3:1 against the chart surface.
    - **Fails, by design:** the neutral task slot (`#3A3D45` light, `#E6E7EA` dark) fails the lightness band and chroma floor. The tasks series is deliberately gray (P7). Owner call.
- **8.2 legacy palette:** removed `indigo`, `indigo600`, `indigoSoft`, `event`, `bg`, `ink`, `inkSoft`, `crit`, `high`, `med`, `low`, `sidebar*`, `kind.*` and the unused `.dark-scroll`. `card`/`line` stay as real tokens, and so do `shadow-card/pop/modal`. Evidence: the scanner, checked against a positive control, finds 0 utility usages in `src` (tests included), and the built CSS is byte-identical before and after (72545 bytes, no rule added or removed).
- **8.3 accessibility:**
  - **axe 4.10:** `wcag2a/aa/21aa` on every route plus the dialog and palette, both themes, 1440. The fixes:
    - Meeting tile time labels, and the Buffers preview meeting minutes, are at full strength (white @ .8 on violet was 3.9:1).
    - Re-run after the fixes: 0 violations at 1440 (routes, dialog, palette) and at 390 (routes), both themes.
    - The card checklist checkboxes are named after their subtask.
    - The ✓ button is "Complete <title>" (the P6 follow-up).
  - **Contrast on glass and gradients:** axe reports these as "incomplete", so contrast was measured on 2× screenshots instead, with glyph-versus-background pixels per text node. After the fixes, the only flags are tiles clipped in narrow overlap lanes, which are false positives.
  - **Tab walk:** every route in Chromium light and Firefox dark. Every stop shows an outline or the focus-token border.
    - **Chromium:** the cycle closes back to the first stop.
    - **Headless Firefox:** focus ends on each page's last control (Firefox moves on to the browser chrome), so there is no trap.
  - **Board card kebab:** now a WAI-ARIA menu button (`role=menu`/`menuitem`, first item focused, arrows, Escape returns focus), closing the P6 follow-up.
  - **Raw-literal sweep (Task 7.6 regex):** the only survivors are the AccountMenu avatar gradient (P2, deliberate) and the category palette (user data).
- **8.4 reduced motion and 390px:**
  - **Reduced motion:** with `reducedMotion: 'reduce'` (Chromium dark, Firefox light), `document.getAnimations()` holds nothing over 1ms. This covers routes, dialog open/close, palette, locked shake + toast (the text is still announced), Re-plan, theme switch, the board pointer drop (WAAPI) and keyboard moves. A no-preference control run detects `pulse-dot`, modal, shake, toast, `th-in` and the 520ms WAAPI drop.
  - **390px:** checked every route, the Tasks sheet, the New task dialog and the create sheet (Chromium light, Firefox dark). `shell-content` never scrolls sideways, and the screenshots were viewed.
- **8.5 screenshot comparison (1440, Chromium):** dark 01, 03 (drag: ghost "Sun · 4:15 PM"), 04 (resize: "1h 45m · ends 4:45 PM"), 05, 07–12; light 02 and 06; derived light 07–12. Light drag and resize states and the desktop create popover were checked too. Fixes made from it:
  - The now-dot.
  - **Board column width:** columns are `minmax(300px,1fr)` from 1380px, so the four priority columns fill a 1440 view as in 07. At 260px, six columns left titles about 60px wide.
  - The card meta wraps as one unit.
  - The detail card Time tile no longer wraps.
  - **Tablet planner toolbar:** at 900–1023px the panel toggle was pushed out of the card. Below `lg` the range label may now truncate, to no less than 6rem.
  - **Follow-up, not done:** the Unscheduled card is cramped at 900px.
- **Intentional deviations against 01–12:**
  - The header sidebar toggle and Now/Next pill (D20, D7), and the Next-up Start button (D7).
  - 24h scrolling columns instead of the fixed 1 PM–2 AM window (D11). No meeting location (D14).
  - Six board columns, with Backlog and Completed one scroll away (D8).
  - Stats task series (P7) and the Mon–Sun Stats eyebrow (P2).
  - The Settings Save button plus the Appearance and Account cards (§4.8).
  - The deeper light meeting violet (above).
  - Demo data differs (real dev DB).
- **Still for the owner (real devices and browsers):**
  - Firefox backdrop blur (M).
  - Real-device Android long-press and the coarse resize handle (P4).
  - The release spring in a real Firefox (P4).
  - Native pickers following `color-scheme`.
  - The light chart palette validation.
  - The rail below about 620px viewport height (P2).
  - Phone search is still keyboard-only (P2 question, not changed).
- **Suite:** 1418 tests / 110 files → **1436 / 110**. All workspaces: core 120, db 81 (Postgres up), google 70, scheduler 136, server 275, web 1436. Root build green.
- **Bisect note:** `c5e6403` (time format) and `5509ec8` (tokenStore) are red on their own; `b3ae63d` and `5fd9514` fix their test and type fallout.

#### README acceptance checklist
| Item | Result |
|---|---|
| Each screen matches its screenshot (dark, and light where designed) | Pass with listed deviations (D7/D8/D11/D14/D20, Stats task series, Settings Save/Appearance, deeper light meeting violet) |
| Theme switch on every screen, persists, respects system default | Pass (P1/P2 live; re-seen on every route in both themes here) |
| Locked meetings solid; movable habits/tasks dashed | Pass |
| Drag across time/days, 15-min snap, ghost + label, spring, saved | Pass (P4 live; ghost label re-checked under de-DE locale). Snap is delta-based (P4 deviation) |
| Resize from bottom edge, 15-min min, spring, saved | Pass (P4 live) |
| Keyboard move/resize; locked shake + toast | Pass (toast and shake re-checked; shake skipped under reduced motion, toast kept) |
| Priorities DnD with placeholder, re-flow, landing spring, saved, keyboard + announcements | Pass (live here, both engines and touch) |
| New task dialog animations, Esc/backdrop/focus return/disabled Create/Enter, real task | Pass (P5 live; reduced-motion re-checked here) |
| Re-plan loading state + drop-in | Pass (P4 live) |
| Reduced motion: nothing animates | Pass (getAnimations audit, both engines) |
| No contrast regressions; icon-only buttons labelled | Pass after the P8 fixes (axe 0 violations after fixes; composited contrast; button-name rule clean) |

### Final review fixes (2026-11-25)

Verified findings from the final review. Each item was checked in the code first and fixed with a regression test (TDD for the pure logic). Nothing was skipped.

- **Planner:**
  - **P1, blocks running past the column end** (`43ba7f8`). An overnight blocked event (23:00–07:00), or anything crossing a `dayStartMinute` column, used to jump or get cut down. Two new pure helpers in `weekModel.ts` now drive both the keyboard (`blockKeyboard.ts`) and the pointer (`dragModel.ts`):
    - `moveStartMin` clamps only the **start**, to `[0, 1440−15]`. The block keeps its length, so its end may run past the column.
    - `resizeEndMin` treats a zero snapped delta as a no-op before any clamping. It never grows a block past the column end, and never cuts it back to the column end either.
    - Neither helper moves against the key or drag direction. An off-grid start in the last slot stays put on ↓.
    - **Deliberate behaviour change:** an ordinary 23:00–24:00 block pressed ↓ (or dragged to the bottom) now becomes 23:15–00:15 instead of being clamped inside the column. The old clamp tests were rewritten for this.
    - The move and resize ghosts clip their height at the column end, as the tile does. `clampToWindow` is unchanged, because `scheduleDrop` still uses it.
  - **P2, focus origin** (`543783e`):
    - `InteractiveBlock` records whether the body was focused by a pointer: a ref set on press (body or resize handle) and cleared on blur.
    - A pointer-focused block ignores arrows and Delete. The arrows keep their default action and scroll the hours.
    - Tabbing back in (or programmatic focus) re-enables the keys.
    - Backspace is no longer a delete key. `main` had no keyboard delete, so Delete now works only on keyboard-focused blocks.
    - `:focus-visible` was rejected: browsers may start matching it on the very keypress being read.
  - **P3, hold re-baselining** (`669eea3`):
    - A WeekGrid `Pending` remembers its last `committed` target.
    - When the optimistic write of that commit lands while a newer keyboard preview is pending, the hold re-baselines onto it. Previously it dropped the hold, which flicked the tile back and made the next press build on the stale time.
  - **P4, filtered tiles and lanes** (`c662f1d`): visible and filtered-out items get separate `layoutWeek` passes. Hidden tiles keep their own geometry, so they stay mounted and can fade back in.
  - **P5, lost pointer capture** (`dbbec91`):
    - `useBlockDrag` handles `lostpointercapture` like `pointercancel`: it reverts and commits nothing.
    - It acts only when the event's target is our capturing element and its `pointerId` matches. `reset()` clears `captureRef` before it releases capture, so our own release never lands here. A child losing the browser's implicit touch capture to the tile is ignored too.
    - `CalendarBlock` forwards the new prop.
- **Board, dialog and shell:**
  - **B1 + B2, board moves** (`51535e3`):
    - The grip ignores `e.repeat`, but still prevents the default so the page does not scroll.
    - The new `useMoveTaskMutation` (`queries.ts`) writes optimistically in `onMutate`, which TanStack runs immediately even for a queued mutation, after cancelling any tasks refetch in flight.
    - `scope: { id: 'task-move' }` serializes the PATCHes in press order.
    - Rollback and invalidation are mutation-level. A run of queued moves settles as one: when the last one settles, any failure restores the cache from before the run's first move, and the tasks and schedule are refetched once.
    - `useUpdateTaskMutation` is unchanged (drawers use it).
  - **B3, Escape in a native picker** (`a3f51de`). In `useFocusTrap`:
    - The first Escape on a `select` or a date/time-type input only "closes the picker". It is still `preventDefault`ed, so document-level Escape listeners underneath stand down.
    - A second Escape in a row (no other key in between) closes the surface, so a keyboard user is never stuck.
    - **Scope trade-off:** this lives in the hook rather than the modal, so every sheet, drawer-in-sheet and the palette behave the same way.
  - **B4, New task over drawers** (`f79bef4`):
    - Opening New task clears the searched-task drawer. NewTaskModal moves to `z-[58]`: above the shell drawer (`z-[55]`), below the palette (`z-[60]`).
    - TaskDrawers register their task in a shell-level map (`shell/OpenTaskDrawers.tsx`). Picking a task in the palette that a drawer already holds now just closes the palette, so focus returns to that drawer, instead of opening a second drawer with a diverging seeded form.
  - **B5, focus** (`fc090dc`):
    - AccountMenu → Settings focuses the page heading (TopBar `h1#page-heading`, `tabIndex=-1`) after the route renders.
    - AppShell captures the palette's opener. The compact Sheet around ShellTaskDrawer restores focus to that opener (new `restoreTo` on `Sheet` and `DrawerHost`) instead of the palette input, which is detached by then.
    - The palette's Enter ignores IME composition (`nativeEvent.isComposing`, and `keyCode 229` for Safari).
- **Pages and styling:**
  - **S1, reduced motion** (`483182a`): the kill switch adds `animation-iteration-count: 1 !important`. The now-dot pulse and the Re-plan spinner end on their last frame; the spinner stays a static icon next to "Re-planning…".
  - **S2, paused habits** (`2446897`): the row-wide `opacity-[.55]` is gone.
    - A paused row now tints its title `fg-2`, its meta `fg-3` (per-theme alpha tuned for 4.5:1) and its day pills neutral.
    - The buttons stay at full strength.
  - **S3, chart headroom** (`b505727`): the chart tabpanel gets `pt-6`, on the box the y-ticks and the plot share, so they stay aligned.
  - **S4, Settings save status** (`97d548b`): SettingsForm keeps a baseline, compared through `toSettingsInput`. `onSave(input, onSaved)` sets it on success, and the status reads "Unsaved changes" or "Saved" as on Buffers.
  - **S5, tabs and swatches** (`556437b`):
    - Segmented sets `aria-controls` only on the selected tab.
    - Category swatch checks use white where it reaches 3:1, and otherwise the dark ink (`lib/contrast.ts`). Only Amber and Cyan flip.
  - **S6, empty times** (`35e3d08`):
    - An enabled day with an empty start or end reads "Enter a start and end time", in both Settings and the Hours/category editors.
    - A cleared planner day start is stored as `NaN`, which the existing day-start check flags, rather than `0`.
    - Habit preferred times may legitimately be empty and were left alone.
- **Live check** (headless Chromium and Firefox via playwright-core, 1440×900, demo user in America/New_York; all 14 checks passed in both engines):
  - **P1 (overnight blocked time, 23:00–07:00):**
    - ↓ gives 23:15–07:15.
    - Shift+↓ is a no-op.
    - Shift+↑ gives 23:15–07:00.
    - A click on the clipped tile's resize handle leaves 07:00.
  - **P2:**
    - After a mouse click on a block, ↓ scrolls the hours (scrollTop 400→440/466) and leaves the block alone.
    - Backspace and Delete delete nothing.
  - **B3:** the first Escape on the New task category `select` keeps the dialog and the typed name, and the second closes it.
  - **B1:** holding ↓ on a grip (12 repeats) moves the card one position with exactly one PATCH, and the order survives a reload.
  - **S1:** under reduced motion the now-dot's computed `animation-iteration-count` is `1`.
  - **S2:** a paused habit in light: row opacity 1, buttons opacity 1, meta `rgba(17,18,20,.62)`. The screenshot was viewed.
  - The demo data was restored afterwards (events deleted, task order and habit status reset).
- **P2 follow-up, focus a script moves** (`287fc27`):
  - Planner's `closeDetail` hands focus back to the block. That restore counted as keyboard focus, so after a mouse click on the card's ✕ a later ↓ moved and pinned the block again.
  - The new `lib/inputModality.ts` tracks the last input modality with document capture listeners on `pointerdown` and `keydown`. The block body's `onFocus` takes it: after a click the block is pointer-focused, after Escape keyboard-focused.
  - `test/setup.ts` resets the tracker after each test.
- **Second live pass, real gestures** (Chromium and Firefox, 5/5 each):
  - A mouse drag moves an ordinary block +1h, and a drag-resize adds 30 min.
  - A drag of the overnight block −1h keeps its 8 hours.
  - After clicking a block and closing its card with ✕ by mouse, focus is back on the block and ↓ does not move it.
  - **B3:** Escape after clicking the category `select` open keeps the dialog and the typed name. Headless browsers do not expose whether the native popup really opened, so the open-dropdown case is still for the owner on a real browser.
  - The P1 keyboard checks focused the tile programmatically, not with Tab.
- **Suite:** web 1436 / 110 → **1481 / 111**. Root build green.
- **Follow-ups (ledger, not fixed):**
  - **B4 covers one direction only:** the palette will not open a second drawer on a task a page drawer already holds. A page can still open its own drawer on a task the shell's searched-task drawer holds (e.g. clicking that card on Priorities).
    - **Fix direction:** have pages consult `OpenTaskDrawers`, or close the shell drawer on a page open.
  - **DST 25-hour days:**
    - `blockLayout.ts` `layoutWeek` assigns items to `[d, d + MS_PER_DAY)` and `placeInDay` maps a flat 24h. On the fall-back day (25 wall-clock hours) an item in the extra hour falls outside every column and does not render. (The 23h spring-forward day was not analysed.)
    - Separately, a cross-day move that crosses a DST day from a midnight-anchored column shifts wall-clock time by 1h. The minutes-from-anchor model treats the column as a flat 1440 minutes, while `shiftDays` is wall-clock.
    - **Fix direction:** derive each column's real span from the next column's anchor, and map minutes through the zone rather than through a flat `MS_PER_MIN` offset.
