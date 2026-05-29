import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createSettingsRepository } from '../../src/repositories/settings-repository.js';

const users = createUserRepository(prisma);
const repo = createSettingsRepository(prisma);

const settingsInput = () => ({
  timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  defaultMinChunkMs: 900000,
  defaultMaxChunkMs: 1800000,
});

describe('SettingsRepository', () => {
  it('creates settings on first upsert and returns null before that', async () => {
    const user = await users.create({ email: 's@example.com' });
    expect(await repo.getByUserId(user.id)).toBeNull();
    const created = await repo.upsert(user.id, settingsInput());
    expect(created).toMatchObject({ userId: user.id, timezone: 'America/New_York', horizonDays: 14 });
  });

  it('updates settings on a second upsert', async () => {
    const user = await users.create({ email: 's2@example.com' });
    await repo.upsert(user.id, settingsInput());
    const updated = await repo.upsert(user.id, { ...settingsInput(), timezone: 'Europe/Paris', horizonDays: 7 });
    expect(updated).toMatchObject({ timezone: 'Europe/Paris', horizonDays: 7 });
    const fetched = await repo.getByUserId(user.id);
    expect(fetched?.timezone).toBe('Europe/Paris');
  });
});
