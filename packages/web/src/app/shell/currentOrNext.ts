import type { ScheduledBlock, Settings } from '../../api/types';
import { useScheduleQuery, useSettingsQuery } from '../../api/queries';
import { useRerenderAt } from '../lib/useRerenderAt';

/** `settings.requireStartToTrack`: true = manual (only Started time counts), false = automatic. */
export type TrackingMode = 'manual' | 'automatic';

/**
 * Automatic only when the settings say `requireStartToTrack: false` — the server's own test (its
 * Start route reads a missing settings row as "not automatic"). Settings still loading, failing or
 * absent keep today's manual rule.
 */
export function trackingModeOf(settings: Pick<Settings, 'requireStartToTrack'> | undefined): TrackingMode {
  return settings?.requireStartToTrack === false ? 'automatic' : 'manual';
}

/**
 * The one "running" rule for the top bar, the Next-up card, the detail card and the planner tile.
 *
 * - Both modes: a task block you Started that hasn't ended. Start is not required to have begun:
 *   it snaps the start to round15(now), which can land a few minutes ahead, and a started block is
 *   still the one you're working on. A block resized to end before now drops out.
 * - Automatic tracking also: any task block whose time has come (`startsAt <= now < endsAt`),
 *   whatever `pinned` / `startedAt` are — the server keeps such a piece in place and counts it.
 */
export function isRunningBlock(b: ScheduledBlock, nowMs: number, mode: TrackingMode): boolean {
  if (b.taskId == null) return false;
  const endMs = Date.parse(b.endsAt);
  if (b.startedAt != null && endMs > nowMs) return true;
  return mode === 'automatic' && Date.parse(b.startsAt) <= nowMs && nowMs < endMs;
}

export interface CurrentOrNext {
  /** The task block being worked on now (see isRunningBlock), or null. */
  running: ScheduledBlock | null;
  /** The soonest un-started future task block. Always null while something is running. */
  nextBlock: ScheduledBlock | null;
  /**
   * Automatic tracking only, while a piece runs: the block that would be `nextBlock` if nothing
   * ran, offered as a secondary "Start next" (the server ends the running piece at that moment).
   * Always null in manual tracking and while nothing runs.
   */
  startNext: ScheduledBlock | null;
}

/**
 * Pure selection shared by the desktop TopBar, the mobile top bar and the Next-up card. Several
 * running at once (overlaps): manual keeps the one ending soonest (unchanged); automatic shows
 * the one that started most recently.
 */
export function pickCurrentOrNext(blocks: readonly ScheduledBlock[], nowMs: number, mode: TrackingMode = 'manual'): CurrentOrNext {
  const taskBlocks = blocks.filter((b) => b.taskId != null);
  const running = taskBlocks
    .filter((b) => isRunningBlock(b, nowMs, mode))
    .sort(mode === 'automatic'
      ? (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)
      : (a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] ?? null;
  const upcoming = taskBlocks
    .filter((b) => b.startedAt == null && Date.parse(b.startsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
  return {
    running,
    nextBlock: running ? null : upcoming,
    startNext: running && mode === 'automatic' ? upcoming : null,
  };
}

/** The next moment after `nowMs` a task block starts or ends — when running / next can change. */
export function nextBoundaryMs(blocks: readonly ScheduledBlock[], nowMs: number): number | null {
  let next: number | null = null;
  for (const b of blocks) {
    if (b.taskId == null) continue;
    for (const t of [Date.parse(b.startsAt), Date.parse(b.endsAt)]) {
      if (t > nowMs && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/** The tracking mode from the settings query (manual until it says otherwise). */
export function useTrackingMode(): TrackingMode {
  return trackingModeOf(useSettingsQuery().data);
}

/**
 * Same selection, reading the shared schedule query and the tracking mode. Re-renders when a task
 * block starts or ends, so "Now" appears (and leaves) on time without any other trigger.
 */
export function useCurrentOrNext(nowMs: number): CurrentOrNext {
  const scheduleQ = useScheduleQuery();
  const mode = useTrackingMode();
  const blocks = scheduleQ.data ?? [];
  useRerenderAt(nextBoundaryMs(blocks, nowMs), nowMs);
  return pickCurrentOrNext(blocks, nowMs, mode);
}
