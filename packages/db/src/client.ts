import { PrismaClient } from '@prisma/client';

/** Shared Prisma client instance. Reads DATABASE_URL from the environment. */
export const prisma = new PrismaClient();

export type { PrismaClient };
