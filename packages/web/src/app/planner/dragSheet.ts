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
