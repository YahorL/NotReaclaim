import type { Prisma, PrismaClient, Task, TaskStatus } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export type TaskWithSubtasks = Prisma.TaskGetPayload<{ include: { subtasks: true } }>;

export interface CreateTaskInput {
  title: string;
  priority: number;
  durationMs: number;
  dueBy: Date;
  minChunkMs: number;
  maxChunkMs: number;
  notBefore?: Date | null;
  categoryId?: string | null;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  title?: string;
  priority?: number;
  durationMs?: number;
  dueBy?: Date;
  minChunkMs?: number;
  maxChunkMs?: number;
  notBefore?: Date | null;
  categoryId?: string | null;
  status?: TaskStatus;
  timeLoggedMs?: number;
  sortOrder?: number;
}

export function createTaskRepository(prisma: PrismaClient) {
  return {
    async create(userId: string, data: CreateTaskInput): Promise<Task> {
      let sortOrder = data.sortOrder;
      if (sortOrder === undefined) {
        const agg = await prisma.task.aggregate({ where: { userId }, _max: { sortOrder: true } });
        sortOrder = (agg._max.sortOrder ?? 0) + 1;
      }
      return prisma.task.create({ data: { userId, ...data, sortOrder } });
    },

    findById(userId: string, id: string): Promise<TaskWithSubtasks | null> {
      return prisma.task.findFirst({
        where: { id, userId },
        include: { subtasks: { orderBy: { createdAt: 'asc' } } },
      });
    },

    listByUser(userId: string, opts: { status?: TaskStatus } = {}): Promise<TaskWithSubtasks[]> {
      return prisma.task.findMany({
        where: { userId, ...(opts.status ? { status: opts.status } : {}) },
        orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }, { dueBy: 'asc' }],
        include: { subtasks: { orderBy: { createdAt: 'asc' } } },
      });
    },

    async update(userId: string, id: string, data: UpdateTaskInput): Promise<Task> {
      try {
        const result = await prisma.task.updateMany({ where: { id, userId }, data });
        if (result.count === 0) {
          throw new NotFoundError(`Task ${id} not found for user`);
        }
        return await prisma.task.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const result = await prisma.task.deleteMany({ where: { id, userId } });
      if (result.count === 0) {
        throw new NotFoundError(`Task ${id} not found for user`);
      }
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
