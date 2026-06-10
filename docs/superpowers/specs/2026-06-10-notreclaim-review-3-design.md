# NotReclaim Review 3 — design (form polish + existing-task pinning)

**Date:** 2026-06-10. **Source:** user feedback after testing Review 2. Single mini-milestone, branch `feat/review3-polish`.

| # | Item | Root cause / decision |
|---|------|----------------------|
| 1 | New Task window: date/time selection goes beyond the window | The two `datetime-local` inputs have no width constraint; their intrinsic width overflows the FieldBox/modal. Fix: `w-full min-w-0` (+ drop to `text-[15px]`) on both modal datetime inputs. |
| 2 | Default start 8:00 AM / default end 11:59 PM | `defaultNewTaskForm`: `notBeforeLocal` = **today 08:00 local** (was empty "Now"); `dueByLocal` = **now+7d at 23:59 local** (was +7d at the current wall-clock time). Pure change in `newTaskForm.ts` + tests. |
| 3 | Click on the schedule → choose new task OR existing task | `CreatePopover` Task mode gets a task picker: a select (`data-testid="task-select"`) listing active (pending/scheduled) tasks from `useTasksQuery`, first option **"➕ New task"** (default, current behavior). Choosing an existing task hides the title input and Create only calls `POST /schedule {taskId, startsAt, endsAt}` — pins that task at the slot for the stepper duration; its remaining work reflows (pinned coverage). Event mode unchanged. |
| 4 | Add-subtask button doesn't work | TWO causes. (a) Operational: the long-running Vite dev process had not reloaded the proxy config from M-B, so `/subtasks` 404ed — fixed by restarting the dev server (no code). (b) Real bug: the M-C drawer (~886px tall) overflows shorter viewports (measured 814px) and the fixed wrapper has no scroll — the subtasks section and Save sit below the fold, unreachable. Fix: drawer aside gets `max-h-[calc(100vh-100px)] overflow-y-auto` (wrapper in Priorities.tsx stays `fixed right-3 top-[84px] z-40`). |

Out of scope: drawer redesign (two-column), task search/autocomplete in the picker (plain select is fine at current scale).
