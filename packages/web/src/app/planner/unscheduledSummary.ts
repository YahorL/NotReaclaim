import type { Habit, Task, UnscheduledItem } from '../../api/types';
import { formatDurationShort } from '../lib/duration';

export interface UnscheduledEntry {
  /** `task:<id>` / `habit:<id>` — stable React key and test handle. */
  key: string;
  label: string;
}

/**
 * Missed occurrences per habit id. The engine emits ONE unscheduled row per habit whose
 * `remainingMs` is `missedCount × chunkMs`, so the count is recovered by dividing the
 * habit's chunk back out. A habit the query cannot resolve (renamed chunk, deleted row)
 * still counts as at least one miss rather than disappearing from the warning.
 */
export function missedByHabit(
  items: UnscheduledItem[] | undefined,
  habits: Habit[] | undefined,
): Map<string, number> {
  const chunkById = new Map((habits ?? []).map((h) => [h.id, h.chunkMs]));
  const out = new Map<string, number>();
  for (const it of items ?? []) {
    if (it.sourceType !== 'habit') continue;
    const chunk = chunkById.get(it.sourceId) ?? 0;
    const n = chunk > 0 ? Math.max(1, Math.round(it.remainingMs / chunk)) : 1;
    out.set(it.sourceId, (out.get(it.sourceId) ?? 0) + n);
  }
  return out;
}

/**
 * One entry per unschedulable task/habit, in the order the engine reported them:
 * tasks as leftover work time, habits as a missed-occurrence count. Titles come from the
 * live tasks/habits queries (so a rename shows through), falling back to the title the
 * engine snapshotted and finally to "(deleted)" — an unknown id must never crash the banner.
 *
 * `habits === undefined` means the habits query has not resolved yet: habit rows are held back
 * until then, because without the chunk map every habit would briefly read "1 missed".
 */
export function summarizeUnscheduled(
  items: UnscheduledItem[] | undefined,
  tasks: Task[] | undefined,
  habits: Habit[] | undefined,
): UnscheduledEntry[] {
  const taskTitle = new Map((tasks ?? []).map((t) => [t.id, t.title]));
  const habitTitle = new Map((habits ?? []).map((h) => [h.id, h.title]));
  const missed = missedByHabit(items, habits);

  // Keyed by `kind:id`; a Map keeps first-seen order, which is the order the engine reported.
  const sources = new Map<string, { kind: UnscheduledItem['sourceType']; id: string; title: string }>();
  const remainingByTask = new Map<string, number>();

  for (const it of items ?? []) {
    if (it.sourceType === 'habit' && habits === undefined) continue;
    const key = `${it.sourceType}:${it.sourceId}`;
    if (!sources.has(key)) {
      const resolved = it.sourceType === 'task' ? taskTitle.get(it.sourceId) : habitTitle.get(it.sourceId);
      sources.set(key, { kind: it.sourceType, id: it.sourceId, title: resolved ?? (it.title || '(deleted)') });
    }
    if (it.sourceType === 'task') {
      remainingByTask.set(it.sourceId, (remainingByTask.get(it.sourceId) ?? 0) + it.remainingMs);
    }
  }

  return [...sources].map(([key, { kind, id, title }]) => {
    const label = kind === 'task'
      ? `${title} (${formatDurationShort(remainingByTask.get(id) ?? 0)} left)`
      : `${title} (${missed.get(id) ?? 1} missed)`;
    return { key, label };
  });
}
