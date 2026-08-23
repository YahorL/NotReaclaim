import type { CalendarEvent, Task, ScheduledBlock } from '@prisma/client';
import type {
  FixedEvent,
  FlexibleTask,
  ScheduledBlock as EngineScheduledBlock,
} from '@notreclaim/scheduler';

/** Map a cached calendar event to the engine's immovable FixedEvent. */
export function toFixedEvent(row: CalendarEvent): FixedEvent {
  return {
    id: row.id,
    start: row.startsAt.getTime(),
    end: row.endsAt.getTime(),
  };
}

/**
 * Map a task row to the engine's FlexibleTask (epoch-ms dueBy).
 *
 * A task with no due date is mapped to `fallbackDueBy` (core passes the horizon end).
 * That is exact, not a fudge: `placeItem` uses the deadline only as
 * `start + size <= deadline`, and the free timeline is already clipped to the horizon,
 * so "no deadline" and "due at the horizon edge" are indistinguishable to the engine.
 */
export function toFlexibleTask(row: Task, fallbackDueBy: number): FlexibleTask {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    sortOrder: row.sortOrder,
    durationMs: row.durationMs,
    dueBy: row.dueBy?.getTime() ?? fallbackDueBy,
    minChunkMs: row.minChunkMs,
    maxChunkMs: row.maxChunkMs,
  };
}

/** Map a scheduled-block row to the engine's ScheduledBlock. */
export function toScheduledBlock(row: ScheduledBlock): EngineScheduledBlock {
  const sourceId = row.taskId ?? row.habitId;
  if (!sourceId) {
    throw new Error(`ScheduledBlock ${row.id} has neither taskId nor habitId`);
  }
  return {
    id: row.id,
    sourceType: row.taskId ? 'task' : 'habit',
    sourceId,
    title: row.title,
    start: row.startsAt.getTime(),
    end: row.endsAt.getTime(),
  };
}
