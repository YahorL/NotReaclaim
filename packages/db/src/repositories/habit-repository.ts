import type { PrismaClient, Habit, HabitStatus, HabitPeriod } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export interface CreateHabitInput {
  title: string;
  priority: number;
  chunkMs: number;
  perPeriod: number;
  eligibleDays: number[];
  periodType?: HabitPeriod;
  preferredStartMinute?: number | null;
  preferredEndMinute?: number | null;
}

export interface UpdateHabitInput {
  title?: string;
  priority?: number;
  chunkMs?: number;
  perPeriod?: number;
  eligibleDays?: number[];
  periodType?: HabitPeriod;
  preferredStartMinute?: number | null;
  preferredEndMinute?: number | null;
  status?: HabitStatus;
}

export function createHabitRepository(prisma: PrismaClient) {
  return {
    create(userId: string, data: CreateHabitInput): Promise<Habit> {
      return prisma.habit.create({ data: { userId, ...data } });
    },

    findById(userId: string, id: string): Promise<Habit | null> {
      return prisma.habit.findFirst({ where: { id, userId } });
    },

    listByUser(userId: string): Promise<Habit[]> {
      return prisma.habit.findMany({ where: { userId }, orderBy: { priority: 'asc' } });
    },

    async update(userId: string, id: string, data: UpdateHabitInput): Promise<Habit> {
      try {
        const result = await prisma.habit.updateMany({ where: { id, userId }, data });
        if (result.count === 0) {
          throw new NotFoundError(`Habit ${id} not found for user`);
        }
        return await prisma.habit.findFirstOrThrow({ where: { id, userId } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const result = await prisma.habit.deleteMany({ where: { id, userId } });
      if (result.count === 0) {
        throw new NotFoundError(`Habit ${id} not found for user`);
      }
    },
  };
}

export type HabitRepository = ReturnType<typeof createHabitRepository>;
