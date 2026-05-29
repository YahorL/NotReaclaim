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
  return schedule(input);
}
