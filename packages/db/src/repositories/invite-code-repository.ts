import type { PrismaClient, InviteCode } from '@prisma/client';
import { translatePrismaError } from '../errors.js';

export interface CreateInviteCodeInput {
  code: string;
  createdByUserId: string;
  email?: string | null;
  maxUses?: number;
  usedCount?: number;
  expiresAt?: Date | null;
}

export function createInviteCodeRepository(prisma: PrismaClient) {
  return {
    async create(data: CreateInviteCodeInput): Promise<InviteCode> {
      try {
        return await prisma.inviteCode.create({ data });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    findByCode(code: string): Promise<InviteCode | null> {
      return prisma.inviteCode.findUnique({ where: { code } });
    },

    /**
     * Atomically consume one use IFF the code is valid (exists, unexpired, not exhausted,
     * and email matches when bound). Returns false otherwise. Single UPDATE so concurrent
     * callers can't double-spend a single-use code (the check-then-increment race).
     */
    async tryConsume(code: string, email: string, now: Date): Promise<boolean> {
      const affected = await prisma.$executeRaw`
        UPDATE "InviteCode"
        SET "usedCount" = "usedCount" + 1
        WHERE "code" = ${code}
          AND "usedCount" < "maxUses"
          AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
          AND ("email" IS NULL OR lower("email") = lower(${email}))`;
      return affected > 0;
    },
  };
}

export type InviteCodeRepository = ReturnType<typeof createInviteCodeRepository>;
