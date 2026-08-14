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
 */
export function summarizeUnscheduled(
  items: UnscheduledItem[] | undefined,
  tasks: Task[] | undefined,
  habits: Habit[] | undefined,
): UnscheduledEntry[] {
  const taskTitle = new Map((tasks ?? []).map((t) => [t.id, t.title]));
  const habitTitle = new Map((habits ?? []).map((h) => [h.id, h.title]));
  const missed = missedByHabit(items, habits);

  const order: string[] = [];
  const remainingByTask = new Map<string, number>();
  const titleByKey = new Map<string, string>();

  for (const it of items ?? []) {
    const key = `${it.sourceType}:${it.sourceId}`;
    if (!titleByKey.has(key)) {
      order.push(key);
      const resolved = it.sourceType === 'task' ? taskTitle.get(it.sourceId) : habitTitle.get(it.sourceId);
      titleByKey.set(key, resolved ?? (it.title || '(deleted)'));
    }
    if (it.sourceType === 'task') {
      remainingByTask.set(it.sourceId, (remainingByTask.get(it.sourceId) ?? 0) + it.remainingMs);
    }
  }

  return order.map((key) => {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    const title = titleByKey.get(key)!;
    const label = kind === 'task'
      ? `${title} (${formatDurationShort(remainingByTask.get(id) ?? 0)} left)`
      : `${title} (${missed.get(id) ?? 1} missed)`;
    return { key, label };
  });
}
