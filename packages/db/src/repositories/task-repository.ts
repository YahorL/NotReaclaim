import type { Prisma, PrismaClient, Task, TaskStatus } from '@prisma/client';
import { deleteOwned, updateOwned } from './owned.js';

const SUBTASK_ORDER_BY: Prisma.SubtaskOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];

const subtaskInclude = {
  include: {
    subtasks: { orderBy: SUBTASK_ORDER_BY },
  },
} as const satisfies { include: Prisma.TaskInclude };

export type TaskWithSubtasks = Prisma.TaskGetPayload<typeof subtaskInclude>;

export interface CreateTaskInput {
  title: string;
  priority: number;
  durationMs: number;
  dueBy?: Date | null;
  minChunkMs: number;
  maxChunkMs: number;
  notBefore?: Date | null;
  categoryId?: string | null;
  sortOrder?: number;
}

export type UpdateTaskInput = Partial<CreateTaskInput> & {
  status?: TaskStatus;
  completedAt?: Date | null;
  timeLoggedMs?: number;
};

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
        ...subtaskInclude,
      });
    },

    listByUser(userId: string, opts: { status?: TaskStatus } = {}): Promise<TaskWithSubtasks[]> {
      return prisma.task.findMany({
        where: { userId, ...(opts.status ? { status: opts.status } : {}) },
        orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }, { dueBy: 'asc' }],
        ...subtaskInclude,
      });
    },

    update(userId: string, id: string, data: UpdateTaskInput): Promise<Task> {
      return updateOwned(
        `Task ${id} not found for user`,
        () => prisma.task.updateMany({ where: { id, userId }, data }),
        () => prisma.task.findFirstOrThrow({ where: { id, userId } }),
      );
    },

    delete(userId: string, id: string): Promise<void> {
      return deleteOwned(`Task ${id} not found for user`, () => prisma.task.deleteMany({ where: { id, userId } }));
    },

    async purgeCompletedBefore(userId: string, cutoff: Date): Promise<number> {
      const result = await prisma.task.deleteMany({
        where: {
          userId,
          status: 'completed',
          completedAt: { not: null, lt: cutoff },
        },
      });
      return result.count;
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
