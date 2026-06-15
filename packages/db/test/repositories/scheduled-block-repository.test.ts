import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { createScheduledBlockRepository } from '../../src/repositories/scheduled-block-repository.js';
import { NotFoundError, ConflictError } from '../../src/errors.js';

const users = createUserRepository(prisma);
const tasks = createTaskRepository(prisma);
const repo = createScheduledBlockRepository(prisma);

const taskInput = () => ({
  title: 'Task',
  priority: 1,
  durationMs: 3600000,
  dueBy: new Date('2026-01-02T17:00:00.000Z'),
  minChunkMs: 900000,
  maxChunkMs: 1800000,
});

const blockInput = (taskId: string, over: Record<string, unknown> = {}) => ({
  taskId,
  habitId: null,
  title: 'Focus',
  startsAt: new Date('2026-01-01T10:00:00.000Z'),
  endsAt: new Date('2026-01-01T10:30:00.000Z'),
  ...over,
});

describe('ScheduledBlockRepository', () => {
  it('creates a block, lists by range, and toggles pinned', async () => {
    const user = await users.create({ email: 'sb@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const block = await repo.create(user.id, blockInput(task.id));
    expect(block.pinned).toBe(false);
    const inRange = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(inRange).toHaveLength(1);
    const pinned = await repo.setPinned(user.id, block.id, true);
    expect(pinned.pinned).toBe(true);
  });

  it('rejects a block with neither taskId nor habitId (check constraint)', async () => {
    const user = await users.create({ email: 'sb2@example.com' });
    await expect(
      repo.create(user.id, { taskId: null, habitId: null, title: 'Bad', startsAt: new Date(), endsAt: new Date() }),
    ).rejects.toThrow();
  });

  it('cascades: deleting the parent task removes its blocks', async () => {
    const user = await users.create({ email: 'sb3@example.com' });
    const task = await tasks.create(user.id, taskInput());
    await repo.create(user.id, blockInput(task.id));
    await tasks.delete(user.id, task.id);
    const remaining = await repo.listByUserInRange(
      user.id,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(remaining).toHaveLength(0);
  });

  it('setPinned/delete throw NotFoundError across users', async () => {
    const a = await users.create({ email: 'sba@example.com' });
    const b = await users.create({ email: 'sbb@example.com' });
    const task = await tasks.create(a.id, taskInput());
    const block = await repo.create(a.id, blockInput(task.id));
    await expect(repo.setPinned(b.id, block.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.delete(b.id, block.id)).rejects.toBeInstanceOf(NotFoundError);
    await repo.delete(a.id, block.id);
  });

  it('update mutates fields and is user-scoped', async () => {
    const user = await users.create({ email: 'upd@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const block = await repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' }));
    const updated = await repo.update(user.id, block.id, {
      startsAt: new Date('2026-02-01T08:00:00.000Z'),
      endsAt: new Date('2026-02-01T08:30:00.000Z'),
      pinned: true,
      googleEventId: 'gev-1',
    });
    expect(updated.pinned).toBe(true);
    expect(updated.googleEventId).toBe('gev-1');
    expect(updated.startsAt.toISOString()).toBe('2026-02-01T08:00:00.000Z');

    const other = await users.create({ email: 'upd2@example.com' });
    await expect(repo.update(other.id, block.id, { pinned: false })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('findById returns an owned block and null across users', async () => {
    const a = await users.create({ email: 'fbid-a@example.com' });
    const b = await users.create({ email: 'fbid-b@example.com' });
    const task = await tasks.create(a.id, taskInput());
    const block = await repo.create(a.id, blockInput(task.id));
    expect((await repo.findById(a.id, block.id))?.id).toBe(block.id);
    expect(await repo.findById(b.id, block.id)).toBeNull();
    expect(await repo.findById(a.id, 'missing')).toBeNull();
  });

  it('update can set startedAt', async () => {
    const user = await users.create({ email: 'started@example.com' });
    const task = await tasks.create(user.id, taskInput());
    const block = await repo.create(user.id, blockInput(task.id));
    expect(block.startedAt).toBeNull();
    const updated = await repo.update(user.id, block.id, { startedAt: new Date('2026-01-01T10:07:00.000Z'), pinned: true });
    expect(updated.startedAt?.toISOString()).toBe('2026-01-01T10:07:00.000Z');
  });

  it('enforces unique (userId, engineKey) but allows multiple nulls', async () => {
    const user = await users.create({ email: 'key@example.com' });
    const task = await tasks.create(user.id, taskInput());
    await repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' }));
    await expect(
      repo.create(user.id, blockInput(task.id, { engineKey: 'task:k:0' })),
    ).rejects.toBeInstanceOf(ConflictError);
    await repo.create(user.id, blockInput(task.id));
    await repo.create(user.id, blockInput(task.id));
  });
});
