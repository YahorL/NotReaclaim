import type { PrismaClient, Habit, HabitStatus, HabitPeriod } from '@prisma/client';
import { deleteOwned, updateOwned } from './owned.js';

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

export type UpdateHabitInput = Partial<CreateHabitInput> & { status?: HabitStatus };

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

    update(userId: string, id: string, data: UpdateHabitInput): Promise<Habit> {
      return updateOwned(
        `Habit ${id} not found for user`,
        () => prisma.habit.updateMany({ where: { id, userId }, data }),
        () => prisma.habit.findFirstOrThrow({ where: { id, userId } }),
      );
    },

    delete(userId: string, id: string): Promise<void> {
      return deleteOwned(`Habit ${id} not found for user`, () => prisma.habit.deleteMany({ where: { id, userId } }));
    },
  };
}

export type HabitRepository = ReturnType<typeof createHabitRepository>;
