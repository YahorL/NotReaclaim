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
  /** Total work time required, in ms. */
  durationMs: number;
  /** Deadline: every placed chunk must end at or before this epoch ms. */
  dueBy: number;
  /** Smallest acceptable single block, in ms. */
  minChunkMs: number;
  /** Largest acceptable single block, in ms. */
  maxChunkMs: number;
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
}

/** Engine output: a concrete placement bound to a task or habit. */
export interface ScheduledBlock {
  /** Deterministic id, e.g. "task:<id>:<index>" or "habit:<id>:<index>". */
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
  /** Immovable events that block time. */
  fixedEvents: FixedEvent[];
  /** Already-fixed engine blocks (user-pinned). Treated as busy AND echoed in output. */
  pinnedBlocks: ScheduledBlock[];
  tasks: FlexibleTask[];
  habits: Habit[];
}

/** Result of the scheduling engine. */
export interface ScheduleResult {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledItem[];
}
