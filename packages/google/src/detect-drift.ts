import type { ScheduledBlockRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';

export interface DriftDeps {
  client: Pick<GoogleClient, 'listEvents'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'delete'>;
}

/** Reconcile user edits to our Auto-scheduled events: moves -> pin, deletes -> remove. */
export async function detectDrift(
  deps: DriftDeps,
  userId: string,
  calendarId: string,
  accessToken: string,
  now: number,
  horizonEnd: number,
): Promise<{ pinned: number; removed: number }> {
  const res = await deps.client.listEvents({
    accessToken,
    calendarId,
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(horizonEnd).toISOString(),
  });
  const byId = new Map(res.events.map((e) => [e.id, e]));

  const blocks = await deps.scheduledBlocks.listByUserInRange(userId, new Date(now), new Date(horizonEnd));
  let pinned = 0;
  let removed = 0;

  for (const block of blocks) {
    if (!block.googleEventId) continue;
    const event = byId.get(block.googleEventId);

    if (!event || event.status === 'cancelled') {
      await deps.scheduledBlocks.delete(userId, block.id);
      removed += 1;
      continue;
    }
    if (!event.start?.dateTime || !event.end?.dateTime) continue;

    const eventStart = new Date(event.start.dateTime).getTime();
    const eventEnd = new Date(event.end.dateTime).getTime();
    if (eventStart !== block.startsAt.getTime() || eventEnd !== block.endsAt.getTime()) {
      await deps.scheduledBlocks.update(userId, block.id, {
        startsAt: new Date(eventStart),
        endsAt: new Date(eventEnd),
        pinned: true,
      });
      pinned += 1;
    }
  }

  return { pinned, removed };
}
