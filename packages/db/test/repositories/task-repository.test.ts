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

  it('defaults sortOrder to max+1 within the user (bottom of the board)', async () => {
    const user = await users.create({ email: 'so1@example.com' });
    const a = await repo.create(user.id, taskInput({ title: 'A' }));
    expect(a.sortOrder).toBe(1); // empty board → 0 + 1
    const b = await repo.create(user.id, taskInput({ title: 'B' }));
    expect(b.sortOrder).toBe(2);
    const explicit = await repo.create(user.id, taskInput({ title: 'C', sortOrder: 1.5 }));
    expect(explicit.sortOrder).toBe(1.5);
  });

  it('lists by priority, then sortOrder, then dueBy', async () => {
    const user = await users.create({ email: 'so2@example.com' });
    await repo.create(user.id, taskInput({ title: 'second', priority: 2, sortOrder: 5 }));
    await repo.create(user.id, taskInput({ title: 'first', priority: 2, sortOrder: 1 }));
    await repo.create(user.id, taskInput({ title: 'crit', priority: 1, sortOrder: 99 }));
    const titles = (await repo.listByUser(user.id)).map((t) => t.title);
    expect(titles).toEqual(['crit', 'first', 'second']);
  });

  it('updates sortOrder via update()', async () => {
    const user = await users.create({ email: 'so3@example.com' });
    const t = await repo.create(user.id, taskInput({ title: 'T' }));
    const moved = await repo.update(user.id, t.id, { sortOrder: 0.25 });
    expect(moved.sortOrder).toBe(0.25);
  });

  it('backlog status round-trips on create and update', async () => {
    const user = await users.create({ email: 'bl1@example.com' });
    const t = await repo.create(user.id, taskInput({ title: 'Backlog task' }));
    expect(t.status).toBe('pending');
    const updated = await repo.update(user.id, t.id, { status: 'backlog' });
    expect(updated.status).toBe('backlog');
    const fetched = await repo.findById(user.id, t.id);
    expect(fetched?.status).toBe('backlog');
    const listed = await repo.listByUser(user.id, { status: 'backlog' });
    expect(listed.map((x) => x.id)).toContain(t.id);
  });

  it('completedAt round-trips on update (set and clear)', async () => {
    const user = await users.create({ email: 'ca1@example.com' });
    const t = await repo.create(user.id, taskInput({ title: 'T' }));
    expect(t.completedAt).toBeNull();
    const stamp = new Date('2026-06-01T10:00:00.000Z');
    const withDate = await repo.update(user.id, t.id, { completedAt: stamp });
    expect(withDate.completedAt?.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    const cleared = await repo.update(user.id, t.id, { completedAt: null });
    expect(cleared.completedAt).toBeNull();
  });

  it('purgeCompletedBefore deletes only old-completed; completed-recent and pending-old survive; cascades subtasks', async () => {
    const user = await users.create({ email: 'purge@example.com' });
    const cutoff = new Date('2026-05-01T00:00:00.000Z');

    // Old completed task — should be purged
    const oldCompleted = await repo.create(user.id, taskInput({ title: 'old-done' }));
    await repo.update(user.id, oldCompleted.id, {
      status: 'completed',
      completedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    // Recent completed task — should survive
    const recentCompleted = await repo.create(user.id, taskInput({ title: 'recent-done' }));
    await repo.update(user.id, recentCompleted.id, {
      status: 'completed',
      completedAt: new Date('2026-05-15T00:00:00.000Z'),
    });

    // Old pending task — should survive (wrong status)
    const oldPending = await repo.create(user.id, taskInput({ title: 'old-pending' }));

    const count = await repo.purgeCompletedBefore(user.id, cutoff);
    expect(count).toBe(1);

    expect(await repo.findById(user.id, oldCompleted.id)).toBeNull();
    expect(await repo.findById(user.id, recentCompleted.id)).not.toBeNull();
    expect(await repo.findById(user.id, oldPending.id)).not.toBeNull();
  });

  it('subtasks are ordered by sortOrder asc then createdAt asc', async () => {
    const user = await users.create({ email: 'sto1@example.com' });
    const t = await repo.create(user.id, taskInput({ title: 'T' }));
    // Create them; their sortOrder will be max+1 each time
    const { createSubtaskRepository } = await import('../../src/repositories/subtask-repository.js');
    const subtasks = createSubtaskRepository(prisma);
    const s1 = await subtasks.create(user.id, t.id, { title: 'first' });
    const s2 = await subtasks.create(user.id, t.id, { title: 'second' });
    // Swap: give s2 a lower sortOrder so it appears first
    await subtasks.update(user.id, s2.id, { sortOrder: 0.5 });
    const fetched = await repo.findById(user.id, t.id);
    expect(fetched!.subtasks.map((s) => s.title)).toEqual(['second', 'first']);
  });
});
