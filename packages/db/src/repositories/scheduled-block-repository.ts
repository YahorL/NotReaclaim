import type { PrismaClient, ScheduledBlock } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export interface CreateScheduledBlockInput {
  taskId?: string | null;
  habitId?: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  pinned?: boolean;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
}

export function createScheduledBlockRepository(prisma: PrismaClient) {
  return {
    async create(userId: string, data: CreateScheduledBlockInput): Promise<ScheduledBlock> {
      try {
        return await prisma.scheduledBlock.create({ data: { userId, ...data } });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    /** Blocks whose [startsAt, endsAt) overlaps [start, end). */
    listByUserInRange(userId: string, start: Date, end: Date): Promise<ScheduledBlock[]> {
      return prisma.scheduledBlock.findMany({
        where: { userId, startsAt: { lt: end }, endsAt: { gt: start } },
        orderBy: { startsAt: 'asc' },
      });
    },

    async setPinned(userId: string, id: string, pinned: boolean): Promise<ScheduledBlock> {
      const result = await prisma.scheduledBlock.updateMany({ where: { id, userId }, data: { pinned } });
      if (result.count === 0) {
        throw new NotFoundError(`ScheduledBlock ${id} not found for user`);
      }
      return prisma.scheduledBlock.findUniqueOrThrow({ where: { id } });
    },

    async delete(userId: string, id: string): Promise<void> {
      const result = await prisma.scheduledBlock.deleteMany({ where: { id, userId } });
      if (result.count === 0) {
        throw new NotFoundError(`ScheduledBlock ${id} not found for user`);
      }
    },

    async deleteByUser(userId: string): Promise<void> {
      await prisma.scheduledBlock.deleteMany({ where: { userId } });
    },
  };
}

export type ScheduledBlockRepository = ReturnType<typeof createScheduledBlockRepository>;
