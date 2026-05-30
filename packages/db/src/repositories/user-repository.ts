import type { PrismaClient, User } from '@prisma/client';
import { NotFoundError, translatePrismaError } from '../errors.js';

export interface CreateUserInput {
  email: string;
  googleId?: string | null;
}

export interface UpdateUserInput {
  email?: string;
  googleId?: string | null;
  googleRefreshToken?: string | null;
  autoScheduledCalendarId?: string | null;
}

export function createUserRepository(prisma: PrismaClient) {
  return {
    async create(data: CreateUserInput): Promise<User> {
      try {
        return await prisma.user.create({ data });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    findById(id: string): Promise<User | null> {
      return prisma.user.findUnique({ where: { id } });
    },

    findByEmail(email: string): Promise<User | null> {
      return prisma.user.findUnique({ where: { email } });
    },

    findByGoogleId(googleId: string): Promise<User | null> {
      return prisma.user.findUnique({ where: { googleId } });
    },

    async listConnectedIds(): Promise<string[]> {
      const rows = await prisma.user.findMany({
        where: { googleRefreshToken: { not: null } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async update(id: string, data: UpdateUserInput): Promise<User> {
      try {
        const result = await prisma.user.updateMany({ where: { id }, data });
        if (result.count === 0) {
          throw new NotFoundError(`User ${id} not found`);
        }
        return await prisma.user.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
