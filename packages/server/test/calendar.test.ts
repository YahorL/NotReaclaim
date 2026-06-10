import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Settings } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', userId: 'u1', googleCalendarId: 'primary', googleEventId: 'g1',
    title: 'Standup',
    startsAt: new Date('2026-01-05T10:00:00.000Z'),
    endsAt: new Date('2026-01-05T10:30:00.000Z'),
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}
function settings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1', userId: 'u1', timezone: 'utc', workingHours: [] as unknown as Settings['workingHours'],
    horizonDays: 14, defaultMinChunkMs: 0, defaultMaxChunkMs: 0,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}

describe('calendar routes', () => {
  it('requires authentication', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/calendar/events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns events in the default now->horizon range', async () => {
    const { app } = buildTestApp({
      settings: settings(),
      calendarEvents: [
        event(),
        event({ id: 'e2', googleEventId: 'g2', title: 'Later',
          startsAt: new Date('2026-02-01T10:00:00.000Z'), endsAt: new Date('2026-02-01T11:00:00.000Z') }),
      ],
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/calendar/events', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CalendarEvent[];
    expect(body).toHaveLength(1);
    expect(body[0]!.title).toBe('Standup');
  });

  it('uses the 14-day default horizon when the user has no settings', async () => {
    const { app } = buildTestApp({ settings: null, calendarEvents: [event()] });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'GET', url: '/calendar/events', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as CalendarEvent[])).toHaveLength(1);
  });

  it('honors explicit from/to', async () => {
    const { app } = buildTestApp({
      settings: settings(),
      calendarEvents: [event({ startsAt: new Date('2026-01-09T10:00:00.000Z'), endsAt: new Date('2026-01-09T10:30:00.000Z') })],
    });
    const token = await tokenFor(app);
    const inRange = await app.inject({ method: 'GET',
      url: '/calendar/events?from=2026-01-08T00:00:00.000Z&to=2026-01-10T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` } });
    expect((inRange.json() as CalendarEvent[])).toHaveLength(1);

    const outOfRange = await app.inject({ method: 'GET',
      url: '/calendar/events?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z',
      headers: { authorization: `Bearer ${token}` } });
    expect((outOfRange.json() as CalendarEvent[])).toHaveLength(0);
  });
});

describe('POST /calendar/events', () => {
  const body = { title: 'Standup', startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T09:30:00.000Z' };

  it('creates a local event (null google ids), reflows, returns 201', async () => {
    const { app, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Standup');
    expect(res.json().googleEventId).toBeNull();
    expect(reconcileCalls.length).toBeGreaterThan(0); // afterMutation reflow fired
  });

  it('writes back to the primary Google calendar when connected', async () => {
    const inserted: Array<{ calendarId: string; summary: string }> = [];
    const { app } = buildTestApp({
      accessToken: 'at-1',
      insertEvent: async (_t, calendarId, ev) => { inserted.push({ calendarId, summary: ev.summary }); return { googleEventId: 'g-new' }; },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(inserted).toEqual([{ calendarId: 'primary', summary: 'Standup' }]);
    expect(res.json().googleEventId).toBe('g-new');
    expect(res.json().googleCalendarId).toBe('primary');
  });

  it('stays local when the write-back fails', async () => {
    const { app } = buildTestApp({
      accessToken: 'at-1',
      insertEvent: async () => { throw new Error('google down'); },
    });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().googleEventId).toBeNull();
  });

  it('rejects an inverted range with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/calendar/events', headers: { authorization: `Bearer ${token}` }, payload: { ...body, endsAt: '2026-01-06T08:00:00.000Z' } });
    expect(res.statusCode).toBe(400);
  });
});
