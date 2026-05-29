import type { ScheduledBlock as EngineScheduledBlock } from '@notreclaim/scheduler';
import type { GoogleEventWrite } from './client.js';

/** Map an engine ScheduledBlock to a Google event write payload. */
export function toGoogleEventWrite(block: EngineScheduledBlock): GoogleEventWrite {
  return {
    summary: block.title,
    startDateTime: new Date(block.start).toISOString(),
    endDateTime: new Date(block.end).toISOString(),
  };
}
