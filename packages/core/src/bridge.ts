import type { ScheduledBlock as EngineScheduledBlock } from '@notreclaim/scheduler';
import type { CreateScheduledBlockInput } from '@notreclaim/db';

/** Map an engine ScheduledBlock back to a DB-writable create input. */
export function toScheduledBlockInput(block: EngineScheduledBlock): CreateScheduledBlockInput {
  return {
    taskId: block.sourceType === 'task' ? block.sourceId : null,
    habitId: block.sourceType === 'habit' ? block.sourceId : null,
    title: block.title,
    startsAt: new Date(block.start),
    endsAt: new Date(block.end),
  };
}
