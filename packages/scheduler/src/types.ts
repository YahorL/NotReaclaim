/** A half-open time interval [start, end) in epoch milliseconds. start < end. */
export interface Interval {
  start: number;
  end: number;
}

/** A fixed, immovable calendar event (e.g. a meeting synced from Google). */
export interface FixedEvent {
  id: string;
  start: number;
  end: number;
}

/** A flexible task to be auto-scheduled. Lower `priority` number = scheduled first. */
export interface FlexibleTask {
  id: string;
  title: string;
  priority: number;
  /** User-chosen order among same-priority tasks (board position); lower first. Defaults to 0. */
  sortOrder?: number;
  /** Total work time required, in ms. */
  durationMs: number;
  /** Deadline: every placed chunk must end at or before this epoch ms. */
  dueBy: number;
  /** Smallest acceptable single block, in ms. */
  minChunkMs: number;
  /** Largest acceptable single block, in ms. */
  maxChunkMs: number;
  /**
   * Optional HARD restriction: placement is confined to these windows
   * (intersected with free time before the due date). A chunk that cannot fit
   * is left unscheduled. Omit for unrestricted placement (previous behavior).
   */
  allowedWindows?: Interval[];
}

/** A recurring flexible block. `perPeriod` occurrences of `chunkMs` within each period. */
export interface Habit {
  id: string;
  title: string;
  priority: number;
  /** Duration of a single occurrence, in ms. */
  chunkMs: number;
  /** Target number of occurrences per period. */
  perPeriod: number;
  /** Concrete period boundaries over the horizon (caller-supplied, e.g. weeks). */
  periods: Interval[];
  /**
   * Optional concrete preferred placement windows (e.g. "mornings").
   * The engine prefers these; if an occurrence cannot fit, it falls back to
   * any free time within the period.
   */
  preferredWindows?: Interval[];
  /**
   * Optional HARD restriction: placement is confined to these windows
   * (intersected with each period). Unlike preferredWindows, the engine never
   * places outside allowedWindows — an occurrence that cannot fit there is left
   * unscheduled. Omit for unrestricted placement (previous behavior).
   */
  allowedWindows?: Interval[];
  /**
   * Optional prior placements of this habit, in any order. The engine keeps
   * each slot verbatim when it is still valid — `chunkMs` long, inside its period
   * and its allowed window, and still free — so a replan does not shuffle habits
   * the user has already seen. Kept slots count toward the period target, reserve their free
   * time (plus the buffer gap) and consume their day. Stale slots are re-placed.
   */
  existingSlots?: Interval[];
  /**
   * Optional start times of occurrences that are already SETTLED outside the engine —
   * user-pinned ones, and ones that have already begun (their start is in the past).
   * Their days are consumed (so no auto occurrence lands on the same day) but no block
   * is emitted for them here: pinned ones arrive via `ScheduleInput.pinnedBlocks`, and
   * begun ones simply stay in the caller's store, untouched.
   * Only meaningful together with `allowedWindows`: habits without them are exempt
   * from the one-per-day cap, so there is no day to consume and this is a no-op.
   */
  consumedSlotTimes?: number[];
  /**
   * Optional per-period occurrence targets, parallel to `periods`. When present,
   * periodTargets[i] is the number of occurrences to place in periods[i]
   * (0 places none). When absent, every period uses `perPeriod` (previous behavior).
   */
  periodTargets?: number[];
}

/** Engine output: a concrete placement bound to a task or habit. */
export interface ScheduledBlock {
  /**
   * Deterministic id, e.g. "task:<id>:<index>" or "habit:<id>:<index>". Habits with
   * `allowedWindows` key on the day instead — "habit:<id>:<allowedWindowStart>" —
   * so an occurrence keeps its id across replans even when others come and go.
   */
  id: string;
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  start: number;
  end: number;
}

/** An item (or portion of one) that could not be placed. */
export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
  /** Amount of work time that could not be placed, in ms. */
  remainingMs: number;
}

/** Input to the scheduling engine. All times are epoch ms. */
export interface ScheduleInput {
  /** Available working time over the horizon (already expanded by the caller). */
  workingWindows: Interval[];
  /**
   * Optional full planning envelope [now, horizonEnd). When present the free
   * timeline spans the whole horizon rather than only `workingWindows`, so
   * habits (whose `allowedWindows` are full eligible days) may be placed outside
   * working hours — preferring, in order, their `preferredWindows`, then
   * `workingWindows`, then the whole eligible day. TASKS stay confined: their
   * candidate windows are intersected with `workingWindows`.
   *
   * Omitting this restores the previous FREE-TIMELINE behavior (free = working
   * hours) only. It is not a blanket engine-wide back-compat switch: the habit
   * sticky-slot rule ("a kept slot must lie inside a preferred window") applies
   * unconditionally.
   */
  horizon?: Interval;
  /** Immovable events that block time. */
  fixedEvents: FixedEvent[];
  /** Already-fixed engine blocks (user-pinned). Treated as busy AND echoed in output. */
  pinnedBlocks: ScheduledBlock[];
  tasks: FlexibleTask[];
  habits: Habit[];
  /** Minimum free gap (ms) reserved after each placed task/habit block. Default 0. */
  blockBufferMs?: number;
}

/** Result of the scheduling engine. */
export interface ScheduleResult {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledItem[];
}
