import { describe, it, expect } from 'vitest';
import { ensureAutoScheduledCalendar } from '../src/ensure-calendar.js';
import { FakeGoogleClient, fakeUserRepo, makeUser } from './fakes.js';

describe('ensureAutoScheduledCalendar', () => {
  it('creates and persists the calendar when the user has none', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: null })]);
    const id = await ensureAutoScheduledCalendar({ client, users }, 'u1', 'access');
    expect(id).toBe('cal-auto');
    expect(client.createdCalendars).toEqual(['NotReclaim']);
    expect((await users.findById('u1'))?.autoScheduledCalendarId).toBe('cal-auto');
  });

  it('reuses the stored calendar id and does not create one', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-existing' })]);
    const id = await ensureAutoScheduledCalendar({ client, users }, 'u1', 'access');
    expect(id).toBe('cal-existing');
    expect(client.createdCalendars).toEqual([]);
  });
});
