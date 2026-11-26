import type { PendingPlannerWrite } from '../../api/queries';
import type { CreateScheduledBlockInput } from '../../api/types';
import type { DropPlaceholder } from './WeekGrid';

/** The tiles (`b:<id>` / `e:<id>`) a set of in-flight planner writes is addressed to. */
export function pendingTileKeys(writes: readonly PendingPlannerWrite[]): string[] {
  const keys: string[] = [];
  for (const w of writes) {
    if (w.target === null || w.op === 'blockCreate') continue;
    keys.push(w.op === 'eventUpdate' || w.op === 'eventDelete' ? `e:${w.target}` : `b:${w.target}`);
  }
  return keys;
}

/** One placeholder per task whose POST /schedule is still waiting, at the slot it was dropped on. */
export function dropPlaceholdersFrom(writes: readonly PendingPlannerWrite[], tasks: readonly { id: string; title: string }[]): DropPlaceholder[] {
  return writes.filter((w) => w.op === 'blockCreate').map((w) => {
    const v = w.variables as CreateScheduledBlockInput;
    return { key: `drop:${v.taskId}`, title: tasks.find((t) => t.id === v.taskId)?.title ?? '', startMs: Date.parse(v.startsAt), endMs: Date.parse(v.endsAt) };
  });
}
