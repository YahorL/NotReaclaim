import { describe, it, expect } from 'vitest';
import { syncPrimaryCalendar } from '../src/sync.js';
import {
  FakeGoogleClient,
  fakeSyncStateRepo,
  fakeEventsRepo,
  fakeTokenProvider,
  makeSyncState,
} from './fakes.js';

const timed = (id: string, start: string, end: string) => ({
  id, status: 'confirmed', summary: id, start: { dateTime: start }, end: { dateTime: end },
});
const allDay = (id: string, date: string) => ({
  id, status: 'confirmed', summary: id, start: { date }, end: { date },
});
const cancelled = (id: string) => ({ id, status: 'cancelled', summary: null, start: null, end: null });

function deps(client: FakeGoogleClient, state: ReturnType<typeof makeSyncState> | null = null) {
  return {
    client,
    tokens: fakeTokenProvider(),
    syncState: fakeSyncStateRepo(state),
    events: fakeEventsRepo(),
  };
}

describe('syncPrimaryCalendar', () => {
  it('full sync: upserts timed events, skips all-day, stores the sync token', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{
      events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'), allDay('e2', '2026-01-06')],
      nextSyncToken: 'tok-next',
    }];
    const d = deps(client);
    const result = await syncPrimaryCalendar(d, 'u1', 1000);

    expect(result).toMatchObject({ upserted: 1, deleted: 0, fullResync: true });
    expect(d.events.upserted[0]).toEqual([{
      googleCalendarId: 'primary', googleEventId: 'e1', title: 'e1',
      startsAt: new Date('2026-01-05T09:00:00Z'), endsAt: new Date('2026-01-05T10:00:00Z'),
    }]);
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-next', lastSyncedAt: new Date(1000) });
    expect(client.listCalls[0]!.syncToken).toBeUndefined();
    expect(client.listCalls[0]!.timeMin).toBeTruthy();
  });

  it('incremental sync: applies upserts and deletes cancelled events', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{
      events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'), cancelled('e9')],
      nextSyncToken: 'tok-2',
    }];
    const d = deps(client, makeSyncState({ syncToken: 'tok-1' }));
    const result = await syncPrimaryCalendar(d, 'u1', 2000);

    expect(result).toMatchObject({ upserted: 1, deleted: 1, fullResync: false });
    expect(d.events.deleted[0]).toEqual(['e9']);
    expect(client.listCalls[0]!.syncToken).toBe('tok-1');
  });

  it('paginates across pages and keeps the final sync token', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [
      { events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextPageToken: 'p2' },
      { events: [timed('e2', '2026-01-06T09:00:00Z', '2026-01-06T10:00:00Z')], nextSyncToken: 'tok-final' },
    ];
    const d = deps(client);
    const result = await syncPrimaryCalendar(d, 'u1', 3000);

    expect(result.upserted).toBe(2);
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-final' });
    expect(client.listCalls).toHaveLength(2);
    expect(client.listCalls[1]!.pageToken).toBe('p2');
  });

  it('recovers from a 410 by doing a full resync', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [
      'GONE',
      { events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextSyncToken: 'tok-fresh' },
    ];
    const d = deps(client, makeSyncState({ syncToken: 'stale' }));
    const result = await syncPrimaryCalendar(d, 'u1', 4000);

    expect(result).toMatchObject({ upserted: 1, fullResync: true });
    expect(client.listCalls[0]!.syncToken).toBe('stale');
    expect(client.listCalls[1]!.syncToken).toBeUndefined();
    expect(client.listCalls[1]!.timeMin).toBeTruthy();
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-fresh' });
  });

  it('full resync clears the calendar wholesale before upserting', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextSyncToken: 'tok' }];
    const d = deps(client); // no prior syncToken -> full sync
    await syncPrimaryCalendar(d, 'u1', 1000);
    expect(d.events.clearedCalendars).toEqual(['primary']);
  });

  it('incremental sync does NOT clear the calendar', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextSyncToken: 'tok2' }];
    const d = deps(client, makeSyncState({ syncToken: 'tok1' }));
    await syncPrimaryCalendar(d, 'u1', 2000);
    expect(d.events.clearedCalendars).toEqual([]);
  });
});
