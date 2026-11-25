import type { CSSProperties } from 'react';

/** What a planner tile is. Calendar events are `meeting` (or `blocked`) whatever their source. */
export type BlockKind = 'meeting' | 'task' | 'habit' | 'blocked';

export interface BlockVariantInput {
  kind: BlockKind;
  /** Calendar events only: Google-synced events are locked, app-created ones movable. */
  source?: 'app' | 'google' | null;
  pinned?: boolean;
  /** A task block the user pressed Start on. */
  started?: boolean;
  /** Category colour of the block's task (user data, inline style). */
  accent?: string;
}

export interface BlockVariant {
  /** Literal component/utility classes for the tile surface (JIT-safe). */
  className: string;
  /** Inline category tint. */
  style: CSSProperties;
  /** Locked = mirrors Google; it never moves from the planner. */
  locked: boolean;
  icon: 'lock' | 'pin' | null;
  /** Type chip on the detail card. */
  chip: string;
}

/**
 * The spec §3 block matrix in one place: kind × source × pinned → look, lock and chip.
 * Hybrid locking: only Google meetings lock; app events, blocked time and every task/habit block
 * are movable. Pinned task/habit blocks keep the dashed movable look (plus a pin and a slightly
 * stronger fill) — a pin is "the scheduler won't move it", not "you can't".
 */
export function blockVariant({ kind, source = null, pinned = false, started = false, accent }: BlockVariantInput): BlockVariant {
  if (kind === 'meeting') {
    const locked = source === 'google';
    return {
      className: 'block-meeting',
      style: {},
      locked,
      icon: locked ? 'lock' : null,
      chip: locked ? 'Meeting · Locked' : 'Event · Movable',
    };
  }
  if (kind === 'blocked') {
    // Blocked time is app-owned local busy time; a Google-sourced one would still be read-only.
    const locked = source === 'google';
    return { className: 'block-blocked', style: {}, locked, icon: locked ? 'lock' : null, chip: 'Blocked time' };
  }
  const style: CSSProperties = accent ? { borderColor: accent, color: accent } : {};
  if (kind === 'habit') {
    return {
      className: pinned ? 'block-habit bg-habit-fg/[.12]' : 'block-habit',
      style,
      locked: false,
      icon: pinned ? 'pin' : null,
      chip: pinned ? 'Habit · Pinned' : 'Habit · Movable',
    };
  }
  return {
    className: pinned ? 'block-task bg-fg/[.08]' : 'block-task',
    style,
    locked: false,
    icon: pinned ? 'pin' : null,
    chip: started ? 'Task · In progress' : pinned ? 'Task · Pinned' : 'Task · Auto-scheduled',
  };
}
