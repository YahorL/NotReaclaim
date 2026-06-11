# NotReclaim Review 9 — design (planner feel, shell rework, drawer cleanup)

**Date:** 2026-06-11. Branch `feat/review9-shell-planner`. All web-side.

## A. Planner interactions
1. **Resize/move flicker fix:** on release the preview resets one frame before the optimistic cache lands (onMutate awaits cancelQueries → async gap). Fix in `InteractiveBlock`: do NOT reset the visual preview on pointer-up; keep the committed preview applied until the block's `startMs`/`endMs` props change (`useEffect` clears it) with a ~1.5 s safety timeout (covers error rollback to identical props).
2. **Fluid drag:** while dragging, the snapped ticks glide — `transition-transform duration-75` on the block during drag; ticks animate instead of jumping. (Snapping behavior unchanged.)
3. **Unpin:** the 🔒 on a pinned block becomes a button — click → `PATCH /schedule/:id {pinned:false}` (existing mutation; schedule reflows and the block becomes movable). Tooltip "Unpin — let the scheduler move this". Must not start a drag (stopPropagation on pointerdown/click).
4. **Replan animations:** blocks animate to new positions after a replan — `transition-[top,height] duration-300 ease-out` on EventBlock and on InteractiveBlock **when not dragging** (drag keeps its own transform transition; live resize must not lag the cursor).

## B. Shell rework
5. **Sidebar content:** remove the whole **Meetings** group (Smart Meetings, Scheduling Links); remove **Focus** and **Tasks** disabled items; rename "Time blocking" → **"Time management"** (keeps Habits, Buffers, Hours); "Calendar Sync" item relabels to **"Settings"** (route unchanged, pick the gear-ish icon if one exists else keep sync icon).
6. **Hide/pin sidebar:** the existing top-right pin icon becomes functional: **pinned** (default) = current fixed sidebar; **unpinned/hidden** = sidebar collapses off-canvas leaving a slim handle (hamburger button in the TopBar's left edge) that re-opens it as an overlay; clicking pin in the overlay pins it back. State persisted in `localStorage('nr.sidebarPinned')`. Content area widens when hidden.
7. **TopBar:** replace the disabled "Find a time (SOON)" with **"Next task"**: shows the next upcoming task block from the committed schedule (`useScheduleQuery`), e.g. `Next: Write docs · Today 2:00pm` (reuse `relativeDayTimeLabel`); hidden when none; clicking navigates to `/`. 
8. **Settings page centered:** constrain content (`max-w-[720px] mx-auto`).

## C. Drawers
9. **HabitDrawer restyle** to the design system (FieldBox, DurationStepper where durations, styled selects/checkboxes, pill buttons) — behavior/testids preserved, control-type test updates allowed (M-C precedent).
10. **Remove Status from TaskDrawer** (+ `taskForm` drops `status` from state/patch — status is owned by the board: ✓, Backlog, Completed columns).

Out of scope: sidebar hover-peek, mobile.
