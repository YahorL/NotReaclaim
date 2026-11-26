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

/** The two settings that decide which rows are tracked history (Settings.requireStartToTrack/Since). */
export interface TrackingMode {
  requireStartToTrack: boolean;
  /** When manual tracking was last switched on; null (or absent) = on since forever, or off. */
  requireStartSince?: Date | null;
}

/**
 * A "frozen" task row: tracked history (or work in progress) that replans leave where it is.
 * Apply never moves or sweeps it and takes its engine key away when the engine reissues that key
 * (like a pinned holder); its key index also offsets the task's remaining pieces (stable keys).
 * - Automatic tracking: an un-pinned TASK row whose start has passed (running or finished) — the
 *   user's record of work. While it runs, assemble hands it to the engine like a pinned block
 *   (busy time, its full length counts toward the task); once it ends it counts as spent.
 * - Manual tracking: only history KEPT from automatic tracking — an un-pinned task row that ended
 *   at or before `requireStartSince` (the moment manual tracking was switched on). It does not
 *   count as spent while manual tracking is on (only Started rows do) and is never busy (it has
 *   ended). Every other manual row behaves exactly as before: un-started pieces keep sliding and
 *   past ones are swept. With `requireStartSince` null nothing is frozen in manual mode.
 * Pinned rows and habit rows have their own rules and are never "frozen".
 */
export function isFrozenTaskRow(
  b: Pick<ScheduledBlock, 'taskId' | 'pinned' | 'startsAt' | 'endsAt'>,
  now: number,
  mode: TrackingMode,
): boolean {
  if (b.taskId == null || b.pinned) return false;
  if (!mode.requireStartToTrack) return b.startsAt.getTime() <= now;
  return mode.requireStartSince != null && b.endsAt.getTime() <= mode.requireStartSince.getTime();
}

/**
 * Manual mode: an un-started task block that has ended never counts as spent, so it is discarded
 * — unless it ended at or before `requireStartSince` (history kept from automatic tracking,
 * pinned or not). Null `requireStartSince`: everything un-started and ended goes, as before.
 */
export function isDiscardableUnstarted(
  b: Pick<ScheduledBlock, 'taskId' | 'startedAt' | 'endsAt'>,
  now: number,
  requireStartSince: Date | null | undefined,
): boolean {
  if (requireStartSince != null && b.endsAt.getTime() <= requireStartSince.getTime()) return false;
  return Boolean(b.taskId) && b.startedAt == null && b.endsAt.getTime() <= now;
}
