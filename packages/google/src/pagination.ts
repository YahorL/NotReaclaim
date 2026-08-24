import type { GoogleClient, GoogleEvent, ListEventsArgs } from './client.js';

/**
 * Read a whole event listing, following `nextPageToken` to the end.
 *
 * Google caps one page at 250 events, so every caller that reasons about the ABSENCE
 * of an event (sync's cancellations, detectDrift's delete branch) must see all pages —
 * a single-page read makes everything past page 1 look deleted.
 */
export async function collectPages(
  client: Pick<GoogleClient, 'listEvents'>,
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
