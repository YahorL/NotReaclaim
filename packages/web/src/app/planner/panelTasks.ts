/** Tiles per priority group before "Show N more" (spec §4.2). */
export const PANEL_GROUP_LIMIT = 5;

/**
 * All-tasks order: due date ascending with undated last, then priority (1 = critical first), then
 * title. Pure, never mutates.
 */
export function sortByDue<T extends { dueBy: string | null; priority: number; title: string }>(tasks: readonly T[]): T[] {
  const due = (x: T) => (x.dueBy ? Date.parse(x.dueBy) : Infinity);
  return [...tasks].sort((a, b) => {
    const da = due(a);
    const db = due(b);
    if (da !== db) return da < db ? -1 : 1;
    return a.priority - b.priority || a.title.localeCompare(b.title);
  });
}

/** The first `limit` items unless expanded, plus how many stay folded. */
export function splitShown<T>(items: readonly T[], expanded: boolean, limit = PANEL_GROUP_LIMIT): { shown: T[]; hidden: number } {
  if (expanded || items.length <= limit) return { shown: [...items], hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}
