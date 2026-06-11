import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { NotFoundError } from '../../src/errors.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { createSubtaskRepository } from '../../src/repositories/subtask-repository.js';

const users = createUserRepository(prisma);
const tasks = createTaskRepository(prisma);
const repo = createSubtaskRepository(prisma);

const taskInput = () => ({ title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1 });

describe('SubtaskRepository', () => {
  it('creates subtasks under a task and lists them with the task in creation order', async () => {
    const user = await users.create({ email: 'st1@example.com' });
    const task = await tasks.create(user.id, taskInput());
    await repo.create(user.id, task.id, { title: 'first' });
    await repo.create(user.id, task.id, { title: 'second' });
    const fetched = await tasks.findById(user.id, task.id);
    expect(fetched!.subtasks.map((s) => s.title)).toEqual(['first', 'second']);
    expect(fetched!.subtasks.every((s) => s.done === false)).toBe(true);
  });

  it('toggles done and renames; rejects unknown id', async () => {
    const user = await users.create({ email: 'st2@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const s = await repo.create(user.id, task.id, { title: 'a' });
    const done = await repo.update(user.id, s.id, { done: true, title: 'a2' });
    expect(done).toMatchObject({ done: true, title: 'a2' });
    await expect(repo.update(user.id, 'missing', { done: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('enforces ownership and cascades on task delete', async () => {
    const owner = await users.create({ email: 'st3@example.com' });
    const other = await users.create({ email: 'st4@example.com' });
    const task = await tasks.create(owner.id, taskInput());
    const s = await repo.create(owner.id, task.id, { title: 'x' });
    await expect(repo.create(other.id, task.id, { title: 'y' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.update(other.id, s.id, { done: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.delete(other.id, s.id)).rejects.toBeInstanceOf(NotFoundError);
    await tasks.delete(owner.id, task.id);
    expect(await prisma.subtask.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('defaults sortOrder to max+1 within the task', async () => {
    const user = await users.create({ email: 'sto1@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const s1 = await repo.create(user.id, task.id, { title: 'first' });
    expect(s1.sortOrder).toBe(1); // empty → 0+1
    const s2 = await repo.create(user.id, task.id, { title: 'second' });
    expect(s2.sortOrder).toBe(2);
  });

  it('updates sortOrder via update() and ordering follows via task.findById', async () => {
    const user = await users.create({ email: 'sto2@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const s1 = await repo.create(user.id, task.id, { title: 'alpha' });
    const s2 = await repo.create(user.id, task.id, { title: 'beta' });
    // Move s2 before s1
    await repo.update(user.id, s2.id, { sortOrder: s1.sortOrder - 0.5 });
    const fetched = await tasks.findById(user.id, task.id);
    expect(fetched!.subtasks.map((s) => s.title)).toEqual(['beta', 'alpha']);
  });
});
