import type { ScheduledBlock, ScheduledBlockRepository } from '@notreclaim/db';
import type { MirrorEventState, MirrorSnapshot } from '@notreclaim/core';
import type { GoogleClient, GoogleEvent } from './client.js';
import { collectPages } from './pagination.js';

export interface DriftDeps {
  client: Pick<GoogleClient, 'listEvents'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'delete'>;
}

export interface DriftResult {
  pinned: number;
  removed: number;
  /** What Google currently holds on the Auto-scheduled calendar, keyed by event id. */
  observed: MirrorSnapshot;
}

/**
 * Decide who wins when a block and its Google event disagree.
 *
 * For an engine-owned (unpinned) row Google always wins: `applyDesiredSchedule` pushes
 * every engine move to Google in the same pass that writes the DB, so a divergence can
 * only have come from the user's calendar.
 *
 * A PINNED row is different — the app is its author (drag, resize, create, start/stop),
 * and the app-side move is exactly what we still have to push outbound. So the two
 * modification stamps arbitrate: Google wins only if its event was edited more recently
 * than the row. When Google reports no stamp at all we keep the app copy, which is the
 * conservative choice for the case this exists to fix (a block the app just moved).
 */
function googleWins(event: GoogleEvent, block: ScheduledBlock): boolean {
  if (!block.pinned) return true;
  const googleUpdated = event.updated ? Date.parse(event.updated) : NaN;
  return Number.isFinite(googleUpdated) && googleUpdated > block.updatedAt.getTime();
}

/** Reconcile user edits to our Auto-scheduled events: moves -> pin, deletes -> remove. */
export async function detectDrift(
  deps: DriftDeps,
  userId: string,
  calendarId: string,
  accessToken: string,
  now: number,
  horizonEnd: number,
): Promise<DriftResult> {
  // ALL pages, not just the first: the delete branch below hard-deletes any row whose
  // event is absent from this listing, and Google caps a page at 250 events.
  const { events } = await collectPages(deps.client, {
    accessToken,
    calendarId,
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(horizonEnd).toISOString(),
  });
  const byId = new Map(events.map((e) => [e.id, e]));

  // Snapshot Google's side before anything is written, so the caller can push the blocks
  // that still differ (see applyDesiredSchedule's pinned pass) without a second read.
  const observed = new Map<string, MirrorEventState>();
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    // The edit stamp travels with the entry: the pinned pass needs it to tell an app-side
    // rename (push it) from a Google-side one (keep it) — times alone cannot say.
    const updatedAt = event.updated ? Date.parse(event.updated) : NaN;
    observed.set(event.id, {
      start: new Date(event.start.dateTime).getTime(),
      end: new Date(event.end.dateTime).getTime(),
      title: event.summary,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    });
  }

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
    if (eventStart === block.startsAt.getTime() && eventEnd === block.endsAt.getTime()) continue;
    if (!googleWins(event, block)) continue; // app-authoritative: the pinned pass pushes it outbound

    await deps.scheduledBlocks.update(userId, block.id, {
      startsAt: new Date(eventStart),
      endsAt: new Date(eventEnd),
      pinned: true,
      engineKey: null,
    });
    pinned += 1;
  }

  return { pinned, removed, observed };
}
