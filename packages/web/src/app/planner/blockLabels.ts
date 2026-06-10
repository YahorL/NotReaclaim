import type { ScheduledBlock, Task } from '../../api/types';

/** Display-only: relabel each task's blocks (in start order) with its open subtasks (in list order) as "Task: Subtask". */
export function labelBlocksWithSubtasks(blocks: ScheduledBlock[], tasks: Task[]): ScheduledBlock[] {
  const labels = new Map<string, string>();
  for (const t of tasks) {
    const open = (t.subtasks ?? []).filter((s) => !s.done);
    if (open.length === 0) continue;
    const own = blocks
      .filter((b) => b.taskId === t.id)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    own.forEach((b, i) => { if (i < open.length) labels.set(b.id, `${t.title}: ${open[i]!.title}`); });
  }
  if (labels.size === 0) return blocks;
  return blocks.map((b) => (labels.has(b.id) ? { ...b, title: labels.get(b.id)! } : b));
}
