# NotReclaim Review 12 — design (drag a panel task onto the calendar to schedule it)

**Date:** 2026-06-13. Branch `feat/review12-drag-to-schedule`. All web-side.

Drag a task card from the right-side `PlannerTaskPanel` onto a planner day column → create a **pinned** scheduled block for that task at the dropped time slot (same server path as the click-to-create existing-task flow: `POST /schedule` → pinned block, engine reconciles around it).

- **PlannerTaskPanel** cards are now `draggable`; `dragstart` seeds `dataTransfer` with `text/plain` AND `application/x-nr-task` = task id (Firefox aborts drags without `setData`; the custom type lets the grid recognise a task-card drag during `dragover`). `cursor-grab`.
- **WeekGrid** day columns gain `onDragOver` (only when `types` includes `application/x-nr-task`; `preventDefault` + `dropEffect='copy'`), `onDragLeave` (ignores child-element leaves), and `onDrop` (reads the id, calls `onScheduleTaskAt(taskId, dayStartMs, startMin)`). A live `task-drop-indicator` line + a column tint show the snapped slot while hovering. A window-level `dragend` listener clears the indicator on ESC-cancel / off-grid drops. Slot math factored into `slotFromEvent` (shared with click-to-create).
- **Planner** `onScheduleTaskAt`: looks up the task, `durationMin = clamp(round(durationMs/60000), 15, windowSpan)`, `clampToWindow(startMin, durationMin)` keeps it inside 06:00–22:00 (`startsAt<endsAt` always), then `useCreateScheduledBlockMutation`.

Out of scope: dragging to *reschedule* an already-placed block from the panel; keyboard equivalent; trimming the pinned block to remaining (not full) task duration.
