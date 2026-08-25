import type { ScheduledBlock } from '../../api/types';
import { useScheduleQuery } from '../../api/queries';

export interface CurrentOrNext {
  /** A task block you Started that hasn't ended yet, or null. */
  running: ScheduledBlock | null;
  /** The soonest un-started future task block. Always null while something is running. */
  nextBlock: ScheduledBlock | null;
}

/**
 * Pure selection shared by the desktop TopBar and the mobile top bar.
 *
 * "Running" = a task you've Started that hasn't ended. We don't also require start <= now:
 * Start snaps the start to round15(now), which can land a few minutes in the future, and a
 * started block is still the one you're working on. A block resized to end before now drops out.
 */
export function pickCurrentOrNext(blocks: readonly ScheduledBlock[], nowMs: number): CurrentOrNext {
  const taskBlocks = blocks.filter((b) => b.taskId != null);
  const running = taskBlocks
    .filter((b) => b.startedAt != null && Date.parse(b.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
  const nextBlock = running
    ? null
    : taskBlocks
        .filter((b) => b.startedAt == null && Date.parse(b.startsAt) > nowMs)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
  return { running, nextBlock };
}

/** Same selection, reading the shared schedule query. */
export function useCurrentOrNext(nowMs: number): CurrentOrNext {
  const scheduleQ = useScheduleQuery();
  return pickCurrentOrNext(scheduleQ.data ?? [], nowMs);
}
