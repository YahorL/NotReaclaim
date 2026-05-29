import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createCalendarEventRepository } from '../../src/repositories/calendar-event-repository.js';

const users = createUserRepository(prisma);
const repo = createCalendarEventRepository(prisma);

const event = (over: Record<string, unknown> = {}) => ({
  googleCalendarId: 'primary',
  googleEventId: 'g1',
  title: 'Meeting',
  startsAt: new Date('2026-01-01T09:00:00.000Z'),
  endsAt: new Date('2026-01-01T10:00:00.000Z'),
  ...over,
});

describe('CalendarEventRepository', () => {
  it('upserts events and lists those overlapping a range', async () => {
    const user = await users.create({ email: 'c@example.com' });
    await repo.upsertMany(user.id, [
      event(),
      event({ googleEventId: 'g2', startsAt: new Date('2026-02-01T09:00:00.000Z'), endsAt: new Date('2026-02-01T10:00:00.000Z') }),
    ]);
    const inJan = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-31T23:59:59.000Z'),
    );
    expect(inJan).toHaveLength(1);
    expect(inJan[0]?.googleEventId).toBe('g1');
  });

  it('upsert is idempotent on the unique triple (updates title)', async () => {
    const user = await users.create({ email: 'c2@example.com' });
    await repo.upsertMany(user.id, [event()]);
    await repo.upsertMany(user.id, [event({ title: 'Renamed' })]);
    const all = await repo.listByUserInRange(user.id, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'));
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Renamed');
  });

  it('deletes events by googleEventId and scopes to the user', async () => {
    const user = await users.create({ email: 'c3@example.com' });
    await repo.upsertMany(user.id, [event(), event({ googleEventId: 'g2' })]);
    await repo.deleteByGoogleEventIds(user.id, ['g1']);
    const remaining = await repo.listByUserInRange(user.id, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'));
    expect(remaining.map((e) => e.googleEventId)).toEqual(['g2']);
  });

  it('deleteByCalendar removes all events for one calendar, scoped by calendar id', async () => {
    const user = await users.create({ email: 'cbycal@example.com' });
    await repo.upsertMany(user.id, [
      event({ googleCalendarId: 'primary', googleEventId: 'p1' }),
      event({ googleCalendarId: 'other', googleEventId: 'o1' }),
    ]);
    await repo.deleteByCalendar(user.id, 'primary');
    const remaining = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(remaining.map((e) => e.googleCalendarId)).toEqual(['other']);
  });
});
