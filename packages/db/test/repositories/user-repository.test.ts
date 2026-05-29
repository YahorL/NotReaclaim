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
});
