import type { SettingsRepository, Prisma } from '@notreclaim/db';

/** Mon–Fri 09:00–17:00 — matches the dev seed defaults. */
const DEFAULT_WORKING_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, startMinute: 540, endMinute: 1020,
}));

/** Create a Settings row for a brand-new account so the planner is usable immediately. */
export async function ensureUserDefaults(
  settings: Pick<SettingsRepository, 'getByUserId' | 'upsert'>,
  userId: string,
  timezone = 'UTC',
): Promise<void> {
  const existing = await settings.getByUserId(userId);
  if (existing) return;
  await settings.upsert(userId, {
    timezone,
    workingHours: DEFAULT_WORKING_HOURS as unknown as Prisma.InputJsonValue,
    horizonDays: 14,
    defaultMinChunkMs: 1_800_000,
    defaultMaxChunkMs: 7_200_000,
  });
}
