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

/**
 * Automatic tracking: an un-pinned TASK row whose start has passed (running or finished) is the
 * user's record of work, so replans leave it where it is. Apply never moves or sweeps it and
 * takes its engine key away when the engine reissues that key (like a pinned holder); assemble
 * hands it to the engine like a pinned block while it runs (busy time, and its full length counts
 * toward the task). Once it ends it counts as spent (computeSpentMs). Manual tracking freezes
 * nothing: only Started (pinned) rows count there, and un-started pieces keep sliding.
 * Pinned rows and habit rows have their own rules and are never "frozen".
 */
export function isFrozenTaskRow(
  b: Pick<ScheduledBlock, 'taskId' | 'pinned' | 'startsAt'>,
  now: number,
  requireStartToTrack: boolean,
): boolean {
  return !requireStartToTrack && b.taskId != null && !b.pinned && b.startsAt.getTime() <= now;
}

/** Manual mode: an un-started task block that has ended never counts as spent, so it is discarded. */
export function isDiscardableUnstarted(
  b: Pick<ScheduledBlock, 'taskId' | 'startedAt' | 'endsAt'>,
  now: number,
): boolean {
  return Boolean(b.taskId) && b.startedAt == null && b.endsAt.getTime() <= now;
}
