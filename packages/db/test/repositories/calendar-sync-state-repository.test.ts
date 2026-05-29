import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createCalendarSyncStateRepository } from '../../src/repositories/calendar-sync-state-repository.js';

const users = createUserRepository(prisma);
const repo = createCalendarSyncStateRepository(prisma);

describe('CalendarSyncStateRepository', () => {
  it('returns null before any state and creates on first upsert', async () => {
    const user = await users.create({ email: 'ss@example.com' });
    expect(await repo.getByCalendar(user.id, 'primary')).toBeNull();
    const created = await repo.upsert(user.id, 'primary', { syncToken: 'tok-1', lastSyncedAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(created).toMatchObject({ userId: user.id, googleCalendarId: 'primary', syncToken: 'tok-1' });
  });

  it('updates the sync token on a second upsert (idempotent on the calendar key)', async () => {
    const user = await users.create({ email: 'ss2@example.com' });
    await repo.upsert(user.id, 'primary', { syncToken: 'tok-1', lastSyncedAt: new Date('2026-01-01T00:00:00.000Z') });
    const updated = await repo.upsert(user.id, 'primary', { syncToken: 'tok-2', lastSyncedAt: new Date('2026-01-02T00:00:00.000Z') });
    expect(updated.syncToken).toBe('tok-2');
    const fetched = await repo.getByCalendar(user.id, 'primary');
    expect(fetched?.syncToken).toBe('tok-2');
  });

  it('scopes by user', async () => {
    const a = await users.create({ email: 'ssa@example.com' });
    const b = await users.create({ email: 'ssb@example.com' });
    await repo.upsert(a.id, 'primary', { syncToken: 'a-tok', lastSyncedAt: null });
    expect(await repo.getByCalendar(b.id, 'primary')).toBeNull();
  });

  it('cascade-deletes when the user is removed', async () => {
    const user = await users.create({ email: 'ssc@example.com' });
    await repo.upsert(user.id, 'primary', { syncToken: 'tok', lastSyncedAt: null });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.calendarSyncState.count({ where: { userId: user.id } })).toBe(0);
  });
});
