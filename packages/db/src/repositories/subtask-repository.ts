import type { PrismaClient, Subtask } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export interface CreateSubtaskInput {
  title: string;
}
export interface UpdateSubtaskInput {
  title?: string;
  done?: boolean;
  sortOrder?: number;
}

export function createSubtaskRepository(prisma: PrismaClient) {
  return {
    async create(userId: string, taskId: string, data: CreateSubtaskInput): Promise<Subtask> {
      const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
      if (!task) throw new NotFoundError(`Task ${taskId} not found for user`);
      try {
        const agg = await prisma.subtask.aggregate({ where: { taskId }, _max: { sortOrder: true } });
        const sortOrder = (agg._max.sortOrder ?? 0) + 1;
        return await prisma.subtask.create({ data: { taskId, title: data.title, sortOrder } });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    async update(userId: string, id: string, data: UpdateSubtaskInput): Promise<Subtask> {
      try {
        const result = await prisma.subtask.updateMany({ where: { id, task: { userId } }, data });
        if (result.count === 0) throw new NotFoundError(`Subtask ${id} not found for user`);
        return await prisma.subtask.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const result = await prisma.subtask.deleteMany({ where: { id, task: { userId } } });
      if (result.count === 0) throw new NotFoundError(`Subtask ${id} not found for user`);
    },
  };
}

export type SubtaskRepository = ReturnType<typeof createSubtaskRepository>;
