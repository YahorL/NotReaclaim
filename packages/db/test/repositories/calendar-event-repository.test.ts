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

  it('deletes events by googleEventId scoped to user and calendar', async () => {
    const user = await users.create({ email: 'c3@example.com' });
    await repo.upsertMany(user.id, [
      event({ googleCalendarId: 'primary', googleEventId: 'g1' }),
      event({ googleCalendarId: 'primary', googleEventId: 'g2' }),
      event({ googleCalendarId: 'other', googleEventId: 'g1' }),
    ]);
    await repo.deleteByGoogleEventIds(user.id, 'primary', ['g1']);
    const all = await repo.listByUserInRange(
      user.id, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(all.map((e) => `${e.googleCalendarId}:${e.googleEventId}`).sort())
      .toEqual(['other:g1', 'primary:g2']);
  });

  it('deleteMirroredByCalendar removes mirrored events for one calendar, scoped by calendar id', async () => {
    const user = await users.create({ email: 'cbycal@example.com' });
    await repo.upsertMany(user.id, [
      event({ googleCalendarId: 'primary', googleEventId: 'p1' }),
      event({ googleCalendarId: 'other', googleEventId: 'o1' }),
    ]);
    await repo.deleteMirroredByCalendar(user.id, 'primary');
    const remaining = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(remaining.map((e) => e.googleCalendarId)).toEqual(['other']);
  });

  it('deleteMirroredByCalendar spares app-created events that were written back to Google', async () => {
    const user = await users.create({ email: 'cbycal2@example.com' });
    const ours = await repo.create(user.id, {
      title: 'Standup',
      startsAt: new Date('2026-01-01T09:00:00.000Z'),
      endsAt: new Date('2026-01-01T09:30:00.000Z'),
    });
    await repo.setGoogleIds(user.id, ours.id, 'primary', 'g-app');
    await repo.upsertMany(user.id, [event({ googleCalendarId: 'primary', googleEventId: 'g-mirror' })]);

    await repo.deleteMirroredByCalendar(user.id, 'primary');

    const remaining = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(remaining.map((e) => e.googleEventId)).toEqual(['g-app']);
    expect(remaining[0]?.source).toBe('app');
  });

  it('creates a local event with null google ids', async () => {
    const user = await users.create({ email: 'c5@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    expect(created.googleCalendarId).toBeNull();
    expect(created.googleEventId).toBeNull();
    const listed = await repo.listByUserInRange(user.id, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-04T00:00:00.000Z'));
    expect(listed.map((e) => e.id)).toContain(created.id);
  });

  it('setGoogleIds attaches write-back ids scoped to the user', async () => {
    const user = await users.create({ email: 'c6@example.com' });
    const other = await users.create({ email: 'c7@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    await expect(repo.setGoogleIds(other.id, created.id, 'primary', 'g-x')).rejects.toThrow();
    const updated = await repo.setGoogleIds(user.id, created.id, 'primary', 'g-x');
    expect(updated.googleCalendarId).toBe('primary');
    expect(updated.googleEventId).toBe('g-x');
  });

  it("create marks the event as app-created (source 'app')", async () => {
    const user = await users.create({ email: 'csrc1@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    expect(created.source).toBe('app');
  });

  it("create defaults kind to 'event'", async () => {
    const user = await users.create({ email: 'ckind1@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    expect(created.kind).toBe('event');
  });

  it("create persists kind 'blocked' for locally blocked time", async () => {
    const user = await users.create({ email: 'ckind2@example.com' });
    const created = await repo.create(user.id, {
      title: 'Gym', startsAt: new Date('2026-01-03T18:00:00.000Z'), endsAt: new Date('2026-01-03T19:00:00.000Z'),
      kind: 'blocked',
    });
    expect(created.kind).toBe('blocked');
    expect(created.source).toBe('app');
    const [listed] = await repo.listByUserInRange(
      user.id, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-04T00:00:00.000Z'),
    );
    expect(listed?.kind).toBe('blocked');
  });

  it("upsertMany marks mirrored events as google-sourced (source 'google')", async () => {
    const user = await users.create({ email: 'csrc2@example.com' });
    await repo.upsertMany(user.id, [event()]);
    const [mirrored] = await repo.listByUserInRange(
      user.id, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(mirrored?.source).toBe('google');
  });

  it('upsertMany never downgrades an app-created event that was written back', async () => {
    const user = await users.create({ email: 'csrc3@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-01T09:00:00.000Z'), endsAt: new Date('2026-01-01T09:30:00.000Z'),
    });
    await repo.setGoogleIds(user.id, created.id, 'primary', 'g1');
    await repo.upsertMany(user.id, [event({ title: 'Standup (mirrored)' })]);
    const after = await repo.findById(user.id, created.id);
    expect(after?.title).toBe('Standup (mirrored)');
    expect(after?.source).toBe('app');
  });

  it('update changes fields, scoped to the user, leaving source and google ids alone', async () => {
    const user = await users.create({ email: 'cupd1@example.com' });
    const other = await users.create({ email: 'cupd2@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    await repo.setGoogleIds(user.id, created.id, 'primary', 'g-upd');

    await expect(repo.update(other.id, created.id, { title: 'Hijacked' })).rejects.toThrow();

    const updated = await repo.update(user.id, created.id, {
      title: 'Standup (moved)',
      startsAt: new Date('2026-01-03T10:00:00.000Z'),
      endsAt: new Date('2026-01-03T10:45:00.000Z'),
    });
    expect(updated.title).toBe('Standup (moved)');
    expect(updated.startsAt.toISOString()).toBe('2026-01-03T10:00:00.000Z');
    expect(updated.endsAt.toISOString()).toBe('2026-01-03T10:45:00.000Z');
    expect(updated.source).toBe('app');
    expect(updated.googleCalendarId).toBe('primary');
    expect(updated.googleEventId).toBe('g-upd');

    const partial = await repo.update(user.id, created.id, { title: 'Renamed only' });
    expect(partial.title).toBe('Renamed only');
    expect(partial.startsAt.toISOString()).toBe('2026-01-03T10:00:00.000Z');
  });

  it('findById returns an owned event and null for another user', async () => {
    const user = await users.create({ email: 'c8@example.com' });
    const other = await users.create({ email: 'c9@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    expect((await repo.findById(user.id, created.id))?.id).toBe(created.id);
    expect(await repo.findById(other.id, created.id)).toBeNull();
  });

  it('delete removes an owned event and throws NotFound otherwise', async () => {
    const user = await users.create({ email: 'c10@example.com' });
    const other = await users.create({ email: 'c11@example.com' });
    const created = await repo.create(user.id, {
      title: 'Standup', startsAt: new Date('2026-01-03T09:00:00.000Z'), endsAt: new Date('2026-01-03T09:30:00.000Z'),
    });
    await expect(repo.delete(other.id, created.id)).rejects.toThrow();
    await repo.delete(user.id, created.id);
    expect(await repo.findById(user.id, created.id)).toBeNull();
  });
});
