import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Settings } from '@notreclaim/db';
import { GoogleTimeoutError } from '@notreclaim/google';
import { buildTestApp, tokenFor } from './fakes.js';

// A Google request cut off by the client timeout is handled like any other failed Google call.
const settings: Settings = {
  id: 's1', userId: 'u1', timezone: 'utc', workingHours: [] as unknown as Settings['workingHours'],
  horizonDays: 14, defaultMinChunkMs: 0, defaultMaxChunkMs: 0,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, requireStartSince: null, dayStartMinute: 0,
  createdAt: new Date(0), updatedAt: new Date(0),
};
const event: CalendarEvent = {
  id: 'e1', userId: 'u1', googleCalendarId: 'primary', googleEventId: 'g1',
  title: 'Standup', source: 'app', kind: 'event',
  startsAt: new Date('2026-01-05T10:00:00.000Z'), endsAt: new Date('2026-01-05T10:30:00.000Z'),
  createdAt: new Date(0), updatedAt: new Date(0),
};

describe('a timed-out Google request', () => {
  it('fails an explicit replan with 502 and announces nothing', async () => {
    const { app, emitted } = buildTestApp({ reconcileError: new GoogleTimeoutError(15_000) });
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'POST', url: '/schedule/replan', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('google_api_error');
    expect(emitted).toEqual([]);
  });

  it('does not fail a best-effort write-back: the local delete still succeeds', async () => {
    const { app } = buildTestApp({
      settings, calendarEvents: [event], accessToken: 'at-1',
      deleteEvent: async () => { throw new GoogleTimeoutError(15_000); },
    });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'DELETE', url: '/calendar/events/e1', headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/calendar/events', headers: auth })).json()).toHaveLength(0);
  });
});
