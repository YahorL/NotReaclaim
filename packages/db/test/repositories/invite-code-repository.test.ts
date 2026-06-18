import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createInviteCodeRepository } from '../../src/repositories/invite-code-repository.js';

const users = createUserRepository(prisma);
const repo = createInviteCodeRepository(prisma);

async function admin() {
  return users.create({ email: `admin-${Math.random()}@x.com`, isAdmin: true });
}

describe('InviteCodeRepository', () => {
  it('creates a code and finds it', async () => {
    const a = await admin();
    const inv = await repo.create({ code: 'ABC123', createdByUserId: a.id });
    expect(inv.maxUses).toBe(1);
    expect(inv.usedCount).toBe(0);
    expect(await repo.findByCode('ABC123')).toMatchObject({ id: inv.id });
    expect(await repo.findByCode('nope')).toBeNull();
  });

  it('validates: rejects unknown, exhausted, expired, and email-mismatched codes', async () => {
    const a = await admin();
    await repo.create({ code: 'OPEN', createdByUserId: a.id, maxUses: 2 });
    await repo.create({ code: 'USED', createdByUserId: a.id, maxUses: 1, usedCount: 1 });
    await repo.create({ code: 'OLD', createdByUserId: a.id, expiresAt: new Date('2000-01-01T00:00:00Z') });
    await repo.create({ code: 'BOUND', createdByUserId: a.id, email: 'only@x.com' });
    const now = new Date('2026-06-18T00:00:00Z');
    expect(await repo.validate('OPEN', 'anyone@x.com', now)).toBe(true);
    expect(await repo.validate('MISSING', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('USED', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('OLD', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('BOUND', 'other@x.com', now)).toBe(false);
    expect(await repo.validate('BOUND', 'only@x.com', now)).toBe(true);
  });

  it('consume increments usedCount and is reflected in validate', async () => {
    const a = await admin();
    await repo.create({ code: 'ONE', createdByUserId: a.id, maxUses: 1 });
    const now = new Date('2026-06-18T00:00:00Z');
    expect(await repo.validate('ONE', 'a@x.com', now)).toBe(true);
    await repo.consume('ONE');
    expect(await repo.validate('ONE', 'a@x.com', now)).toBe(false);
  });

  it('tryConsume atomically consumes once and refuses thereafter (no double-spend)', async () => {
    const a = await admin();
    await repo.create({ code: 'ATOMIC', createdByUserId: a.id, maxUses: 1 });
    const now = new Date('2026-06-18T00:00:00Z');
    expect(await repo.tryConsume('ATOMIC', 'a@x.com', now)).toBe(true);
    expect(await repo.tryConsume('ATOMIC', 'a@x.com', now)).toBe(false); // exhausted
    expect((await repo.findByCode('ATOMIC'))?.usedCount).toBe(1); // not over-incremented
    expect(await repo.tryConsume('MISSING', 'a@x.com', now)).toBe(false);
    await repo.create({ code: 'EXP', createdByUserId: a.id, expiresAt: new Date('2000-01-01T00:00:00Z') });
    expect(await repo.tryConsume('EXP', 'a@x.com', now)).toBe(false);
    await repo.create({ code: 'BND', createdByUserId: a.id, email: 'only@x.com' });
    expect(await repo.tryConsume('BND', 'other@x.com', now)).toBe(false);
    expect(await repo.tryConsume('BND', 'only@x.com', now)).toBe(true);
  });
});
