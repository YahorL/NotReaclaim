import { Prisma, type PrismaClient, type Category } from '@prisma/client';
import { NotFoundError, ConflictError, translatePrismaError } from '../errors.js';

export interface CreateCategoryInput {
  name: string;
  windows: Prisma.InputJsonValue; // WorkingHourEntry[]
  color?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  // Windows may be null to inherit the user's global working hours (default category).
  windows?: Prisma.InputJsonValue | null;
  color?: string | null;
}

export function createCategoryRepository(prisma: PrismaClient) {
  return {
    listByUser(userId: string): Promise<Category[]> {
      return prisma.category.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    },

    getDefault(userId: string): Promise<Category | null> {
      return prisma.category.findFirst({ where: { userId, isDefault: true } });
    },

    async ensureDefault(userId: string): Promise<Category> {
      const existing = await prisma.category.findFirst({ where: { userId, isDefault: true } });
      if (existing) return existing;
      try {
        return await prisma.category.create({
          data: { userId, name: 'Working Hours', windows: Prisma.DbNull, isDefault: true },
        });
      } catch (error) {
        const row = await prisma.category.findFirst({ where: { userId, isDefault: true } });
        if (row) return row; // lost a concurrent create race
        translatePrismaError(error);
      }
    },

    async create(userId: string, data: CreateCategoryInput): Promise<Category> {
      try {
        return await prisma.category.create({
          data: { userId, name: data.name, windows: data.windows, color: data.color ?? null, isDefault: false },
        });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    async update(userId: string, id: string, data: UpdateCategoryInput): Promise<Category> {
      try {
        // Build the update payload; windows: null must be sent as Prisma.DbNull to set SQL NULL.
        const updateData: Record<string, unknown> = {};
        if (data.name !== undefined) updateData.name = data.name;
        if ('color' in data) updateData.color = data.color ?? null;
        if ('windows' in data) updateData.windows = data.windows === null ? Prisma.DbNull : data.windows;
        const result = await prisma.category.updateMany({ where: { id, userId }, data: updateData });
        if (result.count === 0) throw new NotFoundError(`Category ${id} not found for user`);
        return await prisma.category.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },

    async delete(userId: string, id: string): Promise<void> {
      const row = await prisma.category.findFirst({ where: { id, userId } });
      if (!row) throw new NotFoundError(`Category ${id} not found for user`);
      if (row.isDefault) throw new ConflictError('The default category cannot be deleted');
      await prisma.category.deleteMany({ where: { id, userId } });
    },
  };
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;
