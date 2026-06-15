import type { ScheduledBlock } from '@notreclaim/db';

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** Round an epoch-ms instant to the nearest 15 minutes. */
export function round15(ms: number): number {
  return Math.round(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

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
