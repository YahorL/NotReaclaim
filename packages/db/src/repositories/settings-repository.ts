import type { PrismaClient, Settings, Prisma } from '@prisma/client';
import { translatePrismaError } from '../errors.js';
import { updateOwned } from './owned.js';

export interface UpsertSettingsInput {
  timezone: string;
  workingHours: Prisma.InputJsonValue;
  horizonDays?: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  meetingBufferMs?: number;
  taskBufferMs?: number;
  requireStartToTrack?: boolean;
  dayStartMinute?: number;
}

export type UpdateSettingsInput = Partial<UpsertSettingsInput>;

export function createSettingsRepository(prisma: PrismaClient) {
  return {
    getByUserId(userId: string): Promise<Settings | null> {
      return prisma.settings.findUnique({ where: { userId } });
    },

    async upsert(userId: string, data: UpsertSettingsInput): Promise<Settings> {
      try {
        return await prisma.settings.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    /**
     * Write only the given columns, so a caller editing a few settings cannot overwrite a
     * concurrent change to the others. No settings row yet → NotFoundError (nothing is created).
     */
    update(userId: string, data: UpdateSettingsInput): Promise<Settings> {
      return updateOwned(
        'Settings not configured',
        () => prisma.settings.updateMany({ where: { userId }, data }),
        () => prisma.settings.findUniqueOrThrow({ where: { userId } }),
      );
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
