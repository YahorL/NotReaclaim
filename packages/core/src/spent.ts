import type { ScheduledBlock } from '@notreclaim/db';

/**
 * Time spent on a task = sum of its FINISHED blocks' durations (end <= now).
 * Auto mode counts every finished block; manual mode counts only started ones.
 */
export function computeSpentMs(
  taskId: string,
  blocks: ScheduledBlock[],
  requireStartToTrack: boolean,
  now: number,
): number {
  let total = 0;
  for (const b of blocks) {
    if (b.taskId !== taskId) continue;
    if (b.endsAt.getTime() > now) continue; // not finished yet
    if (requireStartToTrack && b.startedAt == null) continue; // manual: only started blocks count
    total += b.endsAt.getTime() - b.startsAt.getTime();
  }
  return total;
}

/** Manual mode: an un-started task block that has ended never counts as spent, so it is discarded. */
export function isDiscardableUnstarted(
  b: Pick<ScheduledBlock, 'taskId' | 'startedAt' | 'endsAt'>,
  now: number,
): boolean {
  return Boolean(b.taskId) && b.startedAt == null && b.endsAt.getTime() <= now;
}
