import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { ConflictError, NotFoundError } from '../../src/errors.js';

const repo = createUserRepository(prisma);

describe('UserRepository', () => {
  it('creates and finds a user by id and email', async () => {
    const user = await repo.create({ email: 'a@example.com' });
    expect(user.id).toBeTypeOf('string');
    expect(await repo.findById(user.id)).toMatchObject({ email: 'a@example.com' });
    expect(await repo.findByEmail('a@example.com')).toMatchObject({ id: user.id });
  });

  it('returns null for a missing user', async () => {
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await repo.findByEmail('nobody@example.com')).toBeNull();
  });

  it('finds a user by googleId', async () => {
    const user = await repo.create({ email: 'g@example.com', googleId: 'google-123' });
    expect(await repo.findByGoogleId('google-123')).toMatchObject({ id: user.id });
  });

  it('throws ConflictError on duplicate email', async () => {
    await repo.create({ email: 'dup@example.com' });
    await expect(repo.create({ email: 'dup@example.com' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('updates a user and throws NotFoundError for a missing id', async () => {
    const user = await repo.create({ email: 'u@example.com' });
    const updated = await repo.update(user.id, { googleRefreshToken: 'tok' });
    expect(updated.googleRefreshToken).toBe('tok');
    await expect(
      repo.update('00000000-0000-0000-0000-000000000000', { googleRefreshToken: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when updating email to an existing one', async () => {
    await repo.create({ email: 'taken@example.com' });
    const other = await repo.create({ email: 'other@example.com' });
    await expect(
      repo.update(other.id, { email: 'taken@example.com' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('listConnectedIds returns only users with a googleRefreshToken', async () => {
    const connected = await repo.create({ email: 'conn@example.com' });
    await repo.update(connected.id, { googleRefreshToken: 'enc-token' });
    await repo.create({ email: 'unconnected@example.com' });

    const ids = await repo.listConnectedIds();

    expect(ids).toContain(connected.id);
    expect(ids).toHaveLength(1);
  });

  it('cascade-deletes child rows when the user is deleted', async () => {
    const user = await repo.create({ email: 'cascade@example.com' });
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title: 'T',
        priority: 1,
        durationMs: 3600000,
        dueBy: new Date('2026-01-02T17:00:00.000Z'),
        minChunkMs: 900000,
        maxChunkMs: 1800000,
      },
    });
    await prisma.scheduledBlock.create({
      data: {
        userId: user.id,
        taskId: task.id,
        title: 'Focus',
        startsAt: new Date('2026-01-01T10:00:00.000Z'),
        endsAt: new Date('2026-01-01T10:30:00.000Z'),
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.scheduledBlock.count({ where: { userId: user.id } })).toBe(0);
  });
});
