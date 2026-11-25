import type { Task } from '../../api/types';

export interface TaskMatch {
  task: Task;
  /** The subtask title that matched when the task's own title did not; else null. */
  subtask: string | null;
}

/** Active work first, then the backlog, then finished tasks. Archived never matches. */
function statusRank(status: Task['status']): number {
  if (status === 'backlog') return 1;
  if (status === 'completed') return 2;
  return 0;
}

/**
 * Client-side task filter for the search palette: case-insensitive substring on the title, or on
 * a subtask title (ranked below any title match). Order: status group → prefix match → inner match
 * → subtask match → priority (1 = critical first) → title.
 */
export function searchTasks(tasks: readonly Task[], query: string, limit = 8): TaskMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<TaskMatch & { kind: number }> = [];
  for (const task of tasks) {
    if (task.status === 'archived') continue;
    const at = task.title.toLowerCase().indexOf(q);
    if (at >= 0) { scored.push({ task, subtask: null, kind: at === 0 ? 0 : 1 }); continue; }
    const sub = task.subtasks?.find((s) => s.title.toLowerCase().includes(q));
    if (sub) scored.push({ task, subtask: sub.title, kind: 2 });
  }
  scored.sort((a, b) =>
    statusRank(a.task.status) - statusRank(b.task.status)
    || a.kind - b.kind
    || a.task.priority - b.task.priority
    || a.task.title.localeCompare(b.task.title));
  return scored.slice(0, limit).map(({ task, subtask }) => ({ task, subtask }));
}
