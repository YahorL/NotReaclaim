import { describe, it, expect } from 'vitest';
import { ensureUserDefaults } from '../src/auth/user-defaults.js';
import { normalizeEmail } from '../src/auth/email.js';
import { fakeSettingsRepo } from './fakes.js';

describe('ensureUserDefaults', () => {
  it('creates a Settings row when none exists', async () => {
    const settings = fakeSettingsRepo(null);
    await ensureUserDefaults(settings, 'u1', 'America/New_York');
    const row = await settings.getByUserId('u1');
    expect(row?.timezone).toBe('America/New_York');
    expect(row?.horizonDays).toBe(14);
    expect((row?.workingHours as unknown as Array<{ weekday: number }>).length).toBe(5);
  });

  it('does not overwrite existing settings', async () => {
    const settings = fakeSettingsRepo({
      id: 's', userId: 'u1', timezone: 'Europe/Paris', workingHours: [],
      horizonDays: 7, defaultMinChunkMs: 1, defaultMaxChunkMs: 2,
      meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false,
      createdAt: new Date(0), updatedAt: new Date(0),
    } as never);
    await ensureUserDefaults(settings, 'u1');
    const row = await settings.getByUserId('u1');
    expect(row?.timezone).toBe('Europe/Paris');
    expect(row?.horizonDays).toBe(7);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});
