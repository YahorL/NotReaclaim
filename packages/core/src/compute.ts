import { schedule } from '@notreclaim/scheduler';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { assembleScheduleInput, type SchedulingRepositories } from './assemble.js';

/** Assemble inputs from the DB and run the engine to get the desired schedule. */
export async function computeDesiredSchedule(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
): Promise<ScheduleResult> {
  const input = await assembleScheduleInput(repos, userId, now);
  const result = schedule(input);
  if (input.undatedTaskIds.length === 0) return result;
  // A task with no due date is never "late": there is no date it missed. It simply waits
  // for room, so it must not raise the amber banner or the at-risk ⚠ (both read this list).
  const undated = new Set(input.undatedTaskIds);
  return {
    ...result,
    unscheduled: result.unscheduled.filter(
      (u) => !(u.sourceType === 'task' && undated.has(u.sourceId)),
    ),
  };
}
