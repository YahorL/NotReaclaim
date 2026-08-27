/**
 * How much of the Tasks sheet stays on screen while it is collapsed for a drag. Must match the
 * `translate-y-[calc(100%_-_56px)]` literal in `Sheet` — Tailwind needs the literal string, so the
 * constant is the documentation, not the source of the class.
 */
export const COLLAPSED_SHEET_STRIP_PX = 56;

/**
 * Whether the Tasks bottom sheet should drop to a strip for the duration of a drag. Only on the
 * compact layout (on desktop the panel is an inline column that never covers the grid) and only
 * for a task-card drag — the grid has to be visible and droppable underneath.
 */
export function shouldCollapseSheet({ compact, sheetOpen, isTaskDrag }: {
  compact: boolean;
  sheetOpen: boolean;
  isTaskDrag: boolean;
}): boolean {
  return compact && sheetOpen && isTaskDrag;
}
