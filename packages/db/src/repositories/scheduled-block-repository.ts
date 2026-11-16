import type { PrismaClient, ScheduledBlock } from '@prisma/client';
import { translatePrismaError } from '../errors.js';
import { deleteOwned, updateOwned } from './owned.js';

export interface CreateScheduledBlockInput {
  taskId?: string | null;
  habitId?: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  pinned?: boolean;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  engineKey?: string | null;
}

/** A block's owner (task/habit) is fixed at creation. */
export type UpdateScheduledBlockInput = Partial<Omit<CreateScheduledBlockInput, 'taskId' | 'habitId'>> & {
  startedAt?: Date | null;
};

export function createScheduledBlockRepository(prisma: PrismaClient) {
  return {
    async create(userId: string, data: CreateScheduledBlockInput): Promise<ScheduledBlock> {
      try {
        return await prisma.scheduledBlock.create({ data: { userId, ...data } });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    findById(userId: string, id: string): Promise<ScheduledBlock | null> {
      return prisma.scheduledBlock.findFirst({ where: { id, userId } });
    },

    /** Blocks whose [startsAt, endsAt) overlaps [start, end). */
    listByUserInRange(userId: string, start: Date, end: Date): Promise<ScheduledBlock[]> {
      return prisma.scheduledBlock.findMany({
        where: { userId, startsAt: { lt: end }, endsAt: { gt: start } },
        orderBy: { startsAt: 'asc' },
      });
    },

    update(userId: string, id: string, data: UpdateScheduledBlockInput): Promise<ScheduledBlock> {
      return updateOwned(
        `ScheduledBlock ${id} not found for user`,
        () => prisma.scheduledBlock.updateMany({ where: { id, userId }, data }),
        () => prisma.scheduledBlock.findFirstOrThrow({ where: { id, userId } }),
      );
    },

    delete(userId: string, id: string): Promise<void> {
      return deleteOwned(`ScheduledBlock ${id} not found for user`, () =>
        prisma.scheduledBlock.deleteMany({ where: { id, userId } }),
      );
    },
  };
}

export type ScheduledBlockRepository = ReturnType<typeof createScheduledBlockRepository>;
