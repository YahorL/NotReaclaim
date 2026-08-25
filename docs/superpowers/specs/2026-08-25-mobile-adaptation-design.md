# Mobile Adaptation — Design

**Date:** 2026-08-25
**Status:** Approved (sectioned design reviewed in conversation)
**Goal:** Full-parity responsive web app on phones (~375–430px, touch-only). Same codebase, same routes; desktop at `md+` stays behavior-identical.

## Decisions (user-confirmed)

- **Target:** responsive web app in the mobile browser. No PWA manifest/service worker, no native wrapper (can be layered on later).
- **Scope:** full parity — every interaction works on touch, including planner block drag/resize, drag-to-schedule, and all reorders.
- **Navigation:** bottom tab bar on mobile; planner task panel becomes a bottom sheet.
- **Target browsers:** Android Chrome and Android Firefox. (iOS Safari not a verification target, but `dvh`/pointer-events choices don't preclude it.)
- **Approach:** adaptive single codebase + `dnd-kit` for list/cross-container DnD; planner blocks keep their raw pointer-event model.

## Baseline (survey findings, 2026-08-25)

The app is desktop-only today: zero responsive utilities in 92 `.tsx` files, no `touch-action`/`pointer: coarse` awareness anywhere. Key blockers:

- Planner grid gets **0px width** at 390px with default panels (sidebar `w-[280px]` at `Sidebar.tsx:10` + panel `w-[330px]` at `PlannerTaskPanel.tsx:127`).
- All four HTML5-DnD interactions are dead on touch: drag-to-schedule (`PlannerTaskPanel.tsx:35-42` → `WeekGrid.tsx:192-211`), priority-board reorder (`TaskRow.tsx:48-50` + `Column.tsx` + `Board.tsx`), card subtask reorder (`TaskRow.tsx:76-103`), drawer subtask reorder (`TaskDrawer.tsx:121-134`).
- `InteractiveBlock` is already on Pointer Events (`InteractiveBlock.tsx:245-248`, `setPointerCapture` at `:132`) but no `touch-action` anywhere → the browser claims every touch drag for scrolling (`pointercancel` → reset). Resize handle is a 6px target (`:286-290`).
- Hover-only deletes are invisible on touch: `InteractiveBlock.tsx:252-263`, `EventBlock.tsx:51-61`, `PlannerTaskPanel.tsx:74-77`.
- All drawers `w-[440px]` overflow the screen; TaskDrawer's fixed right-anchored slot puts its left edge at −62px. `NewTaskModal` is `w-[500px]` and its wrapper lacks `overflow-y-auto` (unscrollable even on desktop — latent bug).
- `CreatePopover` is `w-[340px]` inside a ~147px column and clipped by the `overflow-y-auto` hours-scroll; its left/right flip hardcodes a 7-day week (`WeekGrid.tsx:293`).
- TopBar (~360px of fixed-cost children + Now/Next widget) and Priorities Toolbar search (`w-[430px]`, `Toolbar.tsx:19`) overflow; Stats cards/charts don't wrap; planner legend needs ~700px.
- `100vh`/`h-screen` at 6 sites (AppShell, Sidebar, hours-scroll maxHeight, three drawers) — wants `dvh`.
- ~93 sub-44px tap targets; `mousedown`-based outside-dismiss in 6 components; 13 load-bearing `title` tooltips.

Assets that help: `useElementWidth` + `daysThatFit` is a real container-query primitive and all block geometry is percentage-based; content pages already use `mx-auto w-full max-w-[720px]`; panels have persisted hide toggles; single layout route (`App.tsx`); layout logic lives in pure tested modules (`weekModel.ts`, `overlapLayout.ts`); `useFlip` is input-agnostic.

## 1. Breakpoints, mobile chrome, navigation

**Two orthogonal switches:**
- **Width:** below Tailwind `md` (768px) → mobile chrome; at `md+` → current layout, unchanged.
- **Input:** `usePointerCoarse()` hook (`matchMedia('(pointer: coarse)')`, reactive) drives interaction affordances (long-press arming, always-visible action buttons) independent of width. A landscape tablet gets desktop layout with touch affordances.

**Bottom tab bar** (`< md` only): Planner, Priorities, Habits, Stats, Settings — fixed bottom, 5 equal icon+label tabs, `env(safe-area-inset-bottom)` padding. Sidebar is not rendered below `md`. Buffers and Hours become two link rows at the top of the Settings page on mobile (routes unchanged; the pages themselves are already fluid).

**Mobile top bar** (~56px): page title left; Now/Next widget compressed to a truncated one-line pill with its Start/Stop button; a `+` icon button opening NewTaskModal. Search and avatar are dropped from the mobile bar; account/logout becomes a row inside Settings on mobile. Desktop TopBar untouched.

**Planner task panel → bottom sheet** on mobile: a "Tasks" toggle in the planner toolbar slides the existing `PlannerTaskPanel` content up as a sheet (~70% height, drag-handle header, backdrop tap dismisses). Same component internals, responsive container.

**Viewport units:** all 6 `100vh`/`h-screen` sites migrate to `dvh` equivalents.

## 2. Planner on a phone

**Day window.** `daysThatFit` stays the sizing brain; on mobile the minimum column width rises so 390px yields a **1-day today view** (larger phones/small tablets: 2). Time gutter shrinks to ~44px with smaller hour labels. Paging by `dayCount` already works; prev/next get 44px targets; horizontal swipe on the day header pages by `dayCount`. The popover-side rule (`i <= 3` at `WeekGrid.tsx:293`) becomes dayCount-aware.

**Block move/resize (`InteractiveBlock`).** Keeps the pointer-event model. On coarse pointers: `touch-action: pan-y` on the block; **long-press (~350ms) arms the drag** — before arming, touches scroll; once armed (visual lift: shadow + slight scale), pointer capture + move with the finger, same 15-min snap and cross-day logic as desktop. Resize handle: 24px-tall invisible hit area (visual bar unchanged), drag-immediate (no long-press — unambiguous target). Explicit **edge auto-scroll** of the hours-scroll container while dragging near top/bottom (touch doesn't get it for free).

**Tap affordances.** Hover-only deletes (blocks, events, panel cards) become always-visible on coarse pointers. Tap-to-open drawer stays the primary action. `title` tooltips are dropped-on-mobile acceptable — drawers carry the full info.

**CreatePopover → bottom sheet on mobile** (same form, fixed to viewport, no clipping). Grid tap still sets the snapped time; the sheet shows it editable. Desktop keeps the anchored popover.

## 3. DnD migration to dnd-kit

**Dependency:** `@dnd-kit/core` + `@dnd-kit/sortable`. Shared sensor config: pointer sensor with small distance threshold on fine pointers (clicks stay clicks); touch sensor with ~250ms delay + tolerance on coarse pointers (scroll stays scroll — same idiom as planner blocks). Keyboard sensor included → reorders become keyboard-accessible.

**Four migrations:**
1. **Priorities board** — `SortableContext` per column; dnd-kit animates the moving card and the gap, so the hand-rolled FLIP *drag* path retires; `useFlip` remains for non-drag movements (server-driven re-sorts). Same optimistic commit + `sortOrder` PATCH on drop.
2. **Card subtask reorder** — vertical `SortableContext`, same persistence.
3. **Drawer subtask reorder** — same.
4. **Drag-to-schedule** — `DndContext` at Planner level, day columns as droppables, reusing the drop indicator and `onScheduleTaskAt` clamp; `DragOverlay` card follows the pointer. **Mobile:** when a drag starts inside the task sheet, the sheet collapses to a slim bottom strip for the drag's duration (grid visible), then restores.

**Convention change (CLAUDE.md):** replace "frontend DnD uses native HTML5 DnD; `dragstart` must `setData`" with: *list/cross-container DnD uses dnd-kit; continuous geometric drag (planner blocks) uses raw pointer events.* The Firefox `setData` quirk doesn't apply to dnd-kit.

## 4. Drawers, modals, remaining pages

- **Drawers → full-screen sheets on mobile.** TaskDrawer, EventDrawer, HabitDrawer keep internals; a shared responsive wrapper renders `inset-0`, full-width, `100dvh`, sticky header with close, scrollable body below `md`. Desktop pixel-identical. NewTaskModal goes near-full-screen on mobile and its wrapper gains `overflow-y-auto` (fixes the desktop latent bug too).
- **Outside-dismiss:** `useClickOutside` + the inline copies (CreatePopover, TaskRow kebab, Dropdown, AccountMenu) switch `mousedown` → `pointerdown`.
- **Priorities:** columns `min(372px, 85vw)` + `scroll-snap-x` for column-to-column flicks; Toolbar search gets `max-w-full`.
- **Stats:** stat cards wrap 2×2 on mobile; charts stack vertically.
- **Planner toolbar:** legend hidden below `md`.
- **Tap targets via a `coarse:` Tailwind variant** (tiny plugin in `tailwind.config.js` for `@media (pointer: coarse)` — literal class strings, JIT-safe). Bump the notable offenders (subtask checkboxes 14px, kebab 26px, priority chips 22px, weekday circles 28px, complete-circles 20px, drawer `×`, stepper icons) to ≥40px hit areas, mostly via padding.
- **Base CSS:** `-webkit-tap-highlight-color: transparent`; `overscroll-behavior: contain` on scroll containers (hours-scroll, board, sheets).

## 5. Testing, verification, phasing

**Unit tests** (vitest/jsdom, `TZ=UTC`): geometry changes in pure modules (`weekModel` mobile column min, narrower gutter, dayCount-aware popover side); dnd-kit `onDragEnd` logic extracted into pure functions and tested directly (jsdom can't simulate real gestures); `usePointerCoarse` with a `matchMedia` mock. **Existing suite (1027) stays green untouched** — desktop at `md+` is behavior-identical and jsdom's `-1` width sentinel keeps current tests on the desktop path.

**Live verification:** browser-drive at 390×844 with touch emulation for tap flows/sheets/tab bar/layout per page (restart Vite first — known staleness trap). Emulated long-press/drag is imperfect: the final gate for block drag, resize, and drag-to-schedule is the user on a real Android phone over Tailscale, at the end of each interaction phase.

**Phases** (each independently mergeable and valuable):
1. **Mobile chrome** — tab bar, mobile top bar, `dvh`, fluid fixes (Stats, Toolbar, TopBar), Settings links/account row. App becomes *navigable*.
2. **Planner touch** — 1-day view, long-press drag/resize, edge auto-scroll, CreatePopover sheet, task-panel bottom sheet, visible deletes. Planner becomes *usable*.
3. **dnd-kit migration** — all four surfaces, desktop + touch, CLAUDE.md convention update. *Full parity.*
4. **Polish** — drawer sheets, `coarse:` tap targets, snap-scroll board, `pointerdown` dismiss, base CSS.

**Risks:** long-press-vs-scroll tuning needs real-device iteration (constants tunable); the Priorities FLIP→dnd-kit refactor is the riskiest piece (deliberately sequenced in phase 3, after the patterns are proven on simpler surfaces).

## Out of scope

PWA installability/offline, push notifications, iOS Safari verification, native wrapper, Google Fonts loading optimization.
