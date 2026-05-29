import type {
  CalendarEventRepository,
  CalendarSyncStateRepository,
  UpsertCalendarEventInput,
} from '@notreclaim/db';
import type { GoogleClient, GoogleEvent, ListEventsArgs } from './client.js';
import { SyncTokenExpiredError } from './errors.js';

const PRIMARY = 'primary';

/** The token surface the sync engine needs. */
export interface AccessTokenProvider {
  getAccessToken(userId: string, now: number): Promise<string>;
}

export interface SyncDeps {
  client: GoogleClient;
  tokens: AccessTokenProvider;
  syncState: Pick<CalendarSyncStateRepository, 'getByCalendar' | 'upsert'>;
  events: Pick<CalendarEventRepository, 'upsertMany' | 'deleteByGoogleEventIds' | 'deleteByCalendar'>;
}

export interface SyncResult {
  upserted: number;
  deleted: number;
  fullResync: boolean;
}

function startOfTodayUtcIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function collectPages(
  client: GoogleClient,
  baseArgs: ListEventsArgs,
): Promise<{ events: GoogleEvent[]; nextSyncToken?: string }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const res = await client.listEvents({ ...baseArgs, pageToken });
    events.push(...res.events);
    pageToken = res.nextPageToken;
    if (res.nextSyncToken) nextSyncToken = res.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken };
}

/** Sync the user's primary calendar into CalendarEvent rows. */
export async function syncPrimaryCalendar(deps: SyncDeps, userId: string, now: number): Promise<SyncResult> {
  const accessToken = await deps.tokens.getAccessToken(userId, now);
  const state = await deps.syncState.getByCalendar(userId, PRIMARY);

  const fullArgs: ListEventsArgs = { accessToken, calendarId: PRIMARY, timeMin: startOfTodayUtcIso(now) };
  let fullResync = false;
  let collected: { events: GoogleEvent[]; nextSyncToken?: string };

  try {
    if (state?.syncToken) {
      collected = await collectPages(deps.client, { accessToken, calendarId: PRIMARY, syncToken: state.syncToken });
    } else {
      fullResync = true;
      collected = await collectPages(deps.client, fullArgs);
    }
  } catch (error) {
    if (error instanceof SyncTokenExpiredError) {
      fullResync = true;
      collected = await collectPages(deps.client, fullArgs);
    } else {
      throw error;
    }
  }

  const toUpsert: UpsertCalendarEventInput[] = [];
  const toDelete: string[] = [];
  for (const ev of collected.events) {
    if (ev.status === 'cancelled') {
      toDelete.push(ev.id);
      continue;
    }
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue; // skip all-day / malformed
    toUpsert.push({
      googleCalendarId: PRIMARY,
      googleEventId: ev.id,
      title: ev.summary ?? '(no title)',
      startsAt: new Date(ev.start.dateTime),
      endsAt: new Date(ev.end.dateTime),
    });
  }

  if (fullResync) {
    await deps.events.deleteByCalendar(userId, PRIMARY);
  }
  if (toUpsert.length > 0) await deps.events.upsertMany(userId, toUpsert);
  if (toDelete.length > 0) await deps.events.deleteByGoogleEventIds(userId, toDelete);

  await deps.syncState.upsert(userId, PRIMARY, {
    syncToken: collected.nextSyncToken ?? null,
    lastSyncedAt: new Date(now),
  });

  return { upserted: toUpsert.length, deleted: toDelete.length, fullResync };
}
