import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createHabitRepository } from '../../src/repositories/habit-repository.js';
import { NotFoundError } from '../../src/errors.js';

const users = createUserRepository(prisma);
const repo = createHabitRepository(prisma);

const habitInput = (over: Record<string, unknown> = {}) => ({
  title: 'Exercise',
  priority: 2,
  chunkMs: 1800000,
  perPeriod: 3,
  eligibleDays: [1, 3, 5],
  ...over,
});

describe('HabitRepository', () => {
  it('creates, finds, and lists habits with defaults applied', async () => {
    const user = await users.create({ email: 'h@example.com' });
    const habit = await repo.create(user.id, habitInput());
    expect(habit).toMatchObject({ title: 'Exercise', periodType: 'week', status: 'active' });
    expect(habit.eligibleDays).toEqual([1, 3, 5]);
    expect(await repo.findById(user.id, habit.id)).not.toBeNull();
    expect(await repo.listByUser(user.id)).toHaveLength(1);
  });

  it('scopes by user and updates/deletes with NotFoundError across users', async () => {
    const a = await users.create({ email: 'ha@example.com' });
    const b = await users.create({ email: 'hb@example.com' });
    const habit = await repo.create(a.id, habitInput());
    expect(await repo.findById(b.id, habit.id)).toBeNull();
    const updated = await repo.update(a.id, habit.id, { status: 'paused' });
    expect(updated.status).toBe('paused');
    await expect(repo.update(b.id, habit.id, { perPeriod: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.delete(b.id, habit.id)).rejects.toBeInstanceOf(NotFoundError);
    await repo.delete(a.id, habit.id);
    expect(await repo.findById(a.id, habit.id)).toBeNull();
  });
});
