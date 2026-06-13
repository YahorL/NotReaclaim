# NotReclaim Review 10 — design (planner release-jump + block delete, sidebar slide-push, time-management consistency)

**Date:** 2026-06-13. Branch `feat/review10-planner-shell`.

## A. Planner
1. **Release "jump from initial to final" fix** (`InteractiveBlock`). Root cause: on commit the held preview keeps the move in `transform` while the new position arrives in `top`; the post-drag class is `transition-[top,height] duration-300`, which animates `top` old→new while `transform` snaps to 0 instantly — so the block visibly jumps back to its **initial** spot and then glides to the final one. Fix: while the held preview is active (post-drag, before props update) use **`transition-none`** so the `transform→0` + `top→newTop` swap is atomic and cancels (no movement). Clear the held preview in a **`useLayoutEffect`** (pre-paint) on `[startMs,endMs]` change so the swap never paints an intermediate frame. The 300 ms `transition-[top,height]` replan glide stays only when **not dragging and not held** (other blocks reflowing after a replan still animate).
2. **Delete / reschedule planner blocks.** Each block gets a hover action affordance (top-right):
   - **Delete (×)** on every block. Task blocks → `DELETE /schedule/:id`; calendar events → `DELETE /calendar/events/:id` (best-effort Google `deleteEvent` write-back). Optimistic removal from the matching query caches.
   - **Reschedule** = the existing **Unpin (🔒)** on pinned blocks (hand back to the scheduler). Movable blocks reschedule by drag.
   - Backend: new `DELETE /schedule/:id` (repo `delete` exists) and `DELETE /calendar/events/:id` (+ calendar-event repo `delete(userId,id)` that returns google ids for write-back). Both `afterMutation`? — schedule delete does **not** reconcile (so the block actually disappears); event delete **does** (frees availability).
   - Client: `deleteScheduledBlock`, `deleteCalendarEvent`; queries: `useDeleteScheduledBlockMutation` (optimistic), `useDeleteCalendarEventMutation`.

## B. Shell / sidebar
3. **Collapse icon** is currently the pin glyph for both states ("not arrow nor pin"). Use a clear **panel-collapse chevron (`‹`)** for hide when pinned, and a **pin** glyph to re-pin from the opened state. New `Icons.panelLeft`.
4. **Slide-push, not overlay.** Remove the `fixed z-50` overlay + dark backdrop. The sidebar lives **in flow** inside a width-animated wrapper (`transition-[width] duration-200`, `w-[280px]`⇄`w-0`, `overflow-hidden`); showing/hiding slides it in and **pushes the main content**. `visible = pinned || opened`. Hamburger (TopBar, when not pinned) sets `opened`; collapse arrow hides; pin persists (`localStorage 'nr.sidebarPinned'`).
5. **Time-management sub-item icons.** `Hours` is the only sub-item with an icon — drop it so Habits / Buffers / Hours are visually uniform (indented, no icon).
6. **Settings icon** changes from the sync/refresh arrows to a **gear** (`Icons.settings`).
7. **Time-management pages uniform.** Habits, Buffers, Hours share one centered layout: `p-4` → inner `mx-auto w-full max-w-[720px]`, heading `text-[22px] font-extrabold`, same indigo pill buttons. Habits stops being full-width (`flex-1`); its editor becomes a fixed right-side drawer (Priorities precedent) so the list stays centered.
8. **Remove non-functional "Help".** Delete the sidebar **Help** `NavSection` (Documentation / Contact support / What's new) and the Priorities **Toolbar** Help dropdown (all "Soon" placeholders).

## C. Priorities
9. **Reorder animation too "agile."** Soften `useFlip` from 180 ms to **~300 ms** with a gentler ease (`cubic-bezier(.22,.61,.36,1)`); bump `InsertGap` 150 → 220 ms to match.

Out of scope: per-block edit drawer from the planner; mobile; sidebar hover-peek.
