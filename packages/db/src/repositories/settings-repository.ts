import type { PrismaClient, Settings, Prisma } from '@prisma/client';
import { translatePrismaError } from '../errors.js';

export interface UpsertSettingsInput {
  timezone: string;
  workingHours: Prisma.InputJsonValue;
  horizonDays?: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  meetingBufferMs?: number;
  taskBufferMs?: number;
  requireStartToTrack?: boolean;
}

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
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
