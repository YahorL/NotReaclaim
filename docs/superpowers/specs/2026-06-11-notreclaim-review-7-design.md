# NotReclaim Review 7 — design (board fixes, settings dedupe, card subtask reorder, two-column drawer)

**Date:** 2026-06-11. Branch `feat/review7-board-fixes`.

| # | Item | Root cause / decision |
|---|------|----------------------|
| 1 | Remove buffers + categories from Settings | They moved to `/buffers` and `/hours` (R6). Settings drops the "Scheduling buffers" sub-section (SettingsForm) and the `<CategoriesSection/>` (Settings page). Buffer values still ride along in the full settings payload state — only the UI section goes. Tests updated. |
| 2 | Task ⋮ menu pops up BEHIND/clipped in the column | R4's per-row wrapper has `overflow-hidden`, which clips the dropdown (z-index was never the issue — verified live). Fix: drop `overflow-hidden` from the wrappers; restore last-row corner rounding via the wrapper class `last:[&>[data-testid=task-row]]:rounded-b-xl` (no clipping anywhere). |
| 3 | Moving tasks doesn't work (real browser) | `dragstart` never calls `dataTransfer.setData` — **Firefox aborts HTML5 drags without it**; jsdom tests can't catch this. Fix: `e.dataTransfer.setData('text/plain', task.id)` in TaskRow's dragstart and the drawer's subtask dragstart (same gap). |
| 4 | Reorder subtasks on the board card too | The card checklist rows become draggable with the same insertion pattern (midpoint sortOrder via `useUpdateSubtaskMutation`); stopPropagation so card drag (task move) isn't hijacked — subtask drag takes precedence within the checklist area. |
| 5 | Organize the task menu (drawer) into two columns | Drawer widens (`w-[440px]`) and lays fields out in a 2-col grid: Title spans both; Duration/Priority?—priority is gone—Duration+Due, Schedule-after+Min, Max+Hours, Status+(spare); Subtasks + error + buttons span both. All testids/behavior unchanged. |

Out of scope: menu flip-up near viewport bottom; per-card subtask add.
