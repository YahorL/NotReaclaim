import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { ConflictError, NotFoundError } from '../../src/errors.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createTaskRepository } from '../../src/repositories/task-repository.js';
import { createCategoryRepository } from '../../src/repositories/category-repository.js';

const users = createUserRepository(prisma);
const tasks = createTaskRepository(prisma);
const repo = createCategoryRepository(prisma);

const windows = [{ weekday: 1, startMinute: 1080, endMinute: 1320 }]; // Mon 18:00–22:00

describe('CategoryRepository', () => {
  it('ensureDefault is idempotent and creates a windows-null default', async () => {
    const user = await users.create({ email: 'c1@example.com' });
    const a = await repo.ensureDefault(user.id);
    const b = await repo.ensureDefault(user.id);
    expect(a.id).toBe(b.id);
    expect(a.isDefault).toBe(true);
    expect(a.name).toBe('Working Hours');
    expect(a.windows).toBeNull();
  });

  it('creates non-default categories and lists default first then by name', async () => {
    const user = await users.create({ email: 'c2@example.com' });
    await repo.ensureDefault(user.id);
    await repo.create(user.id, { name: 'Zeta', windows });
    await repo.create(user.id, { name: 'Alpha', windows });
    const list = await repo.listByUser(user.id);
    expect(list.map((c) => c.name)).toEqual(['Working Hours', 'Alpha', 'Zeta']);
    expect(list[1]!.windows).toEqual(windows);
  });

  it('rejects a duplicate name and an unknown id', async () => {
    const user = await users.create({ email: 'c3@example.com' });
    await repo.create(user.id, { name: 'Focus', windows });
    await expect(repo.create(user.id, { name: 'Focus', windows })).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.update(user.id, 'missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to delete the default category', async () => {
    const user = await users.create({ email: 'c4@example.com' });
    const def = await repo.ensureDefault(user.id);
    await expect(repo.delete(user.id, def.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('nulls a task\'s categoryId when its category is deleted', async () => {
    const user = await users.create({ email: 'c5@example.com' });
    const cat = await repo.create(user.id, { name: 'Errands', windows });
    const task = await tasks.create(user.id, {
      title: 'T', priority: 1, durationMs: 1, dueBy: new Date(0), minChunkMs: 1, maxChunkMs: 1, categoryId: cat.id,
    });
    await repo.delete(user.id, cat.id);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.categoryId).toBeNull();
  });

  it('creates a category with a color and patches it to null', async () => {
    const user = await users.create({ email: 'c6@example.com' });
    const cat = await repo.create(user.id, { name: 'Colorful', windows, color: '#5b62e3' });
    expect(cat.color).toBe('#5b62e3');
    const patched = await repo.update(user.id, cat.id, { color: null });
    expect(patched.color).toBeNull();
  });

  it('patches default category windows to null (inherit)', async () => {
    const user = await users.create({ email: 'c7@example.com' });
    const def = await repo.ensureDefault(user.id);
    // Give the default category custom windows first
    await repo.update(user.id, def.id, { windows });
    let updated = await prisma.category.findUniqueOrThrow({ where: { id: def.id } });
    expect(updated.windows).toEqual(windows);
    // Now clear to null (inherit global)
    await repo.update(user.id, def.id, { windows: null });
    updated = await prisma.category.findUniqueOrThrow({ where: { id: def.id } });
    expect(updated.windows).toBeNull();
  });
});
