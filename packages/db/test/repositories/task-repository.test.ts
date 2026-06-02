import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { NotFoundError } from '../../src/errors.js';

const users = createUserRepository(prisma);
const repo = createTaskRepository(prisma);

const taskInput = (over: Record<string, unknown> = {}) => ({
  title: 'Task',
  priority: 1,
  durationMs: 3600000,
  dueBy: new Date('2026-01-02T17:00:00.000Z'),
  minChunkMs: 900000,
  maxChunkMs: 1800000,
  ...over,
});

describe('TaskRepository', () => {
  it('creates, finds, and lists tasks for a user', async () => {
    const user = await users.create({ email: 't@example.com' });
    const task = await repo.create(user.id, taskInput());
    expect(await repo.findById(user.id, task.id)).toMatchObject({ title: 'Task', status: 'pending' });
    expect(await repo.listByUser(user.id)).toHaveLength(1);
  });

  it('scopes reads by user (A cannot see B\'s task)', async () => {
    const a = await users.create({ email: 'a2@example.com' });
    const b = await users.create({ email: 'b2@example.com' });
    const task = await repo.create(a.id, taskInput());
    expect(await repo.findById(b.id, task.id)).toBeNull();
    expect(await repo.listByUser(b.id)).toHaveLength(0);
  });

  it('filters listByUser by status', async () => {
    const user = await users.create({ email: 't3@example.com' });
    await repo.create(user.id, taskInput());
    const done = await repo.create(user.id, taskInput({ title: 'Done' }));
    await repo.update(user.id, done.id, { status: 'completed' });
    const completed = await repo.listByUser(user.id, { status: 'completed' });
    expect(completed.map((t) => t.title)).toEqual(['Done']);
  });

  it('update/delete throw NotFoundError across users and update mutates', async () => {
    const a = await users.create({ email: 'a3@example.com' });
    const b = await users.create({ email: 'b3@example.com' });
    const task = await repo.create(a.id, taskInput());
    const updated = await repo.update(a.id, task.id, { priority: 5 });
    expect(updated.priority).toBe(5);
    await expect(repo.update(b.id, task.id, { priority: 9 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.delete(b.id, task.id)).rejects.toBeInstanceOf(NotFoundError);
    await repo.delete(a.id, task.id);
    expect(await repo.findById(a.id, task.id)).toBeNull();
  });

  it('round-trips notBefore (set and clear)', async () => {
    const user = await users.create({ email: 'nb@example.com' });
    const created = await repo.create(user.id, {
      title: 'T', priority: 1, durationMs: 1, dueBy: new Date('2026-01-09T00:00:00.000Z'),
      minChunkMs: 1, maxChunkMs: 1, notBefore: new Date('2026-01-06T13:00:00.000Z'),
    });
    expect(created.notBefore?.toISOString()).toBe('2026-01-06T13:00:00.000Z');
    const cleared = await repo.update(user.id, created.id, { notBefore: null });
    expect(cleared.notBefore).toBeNull();
  });
});
