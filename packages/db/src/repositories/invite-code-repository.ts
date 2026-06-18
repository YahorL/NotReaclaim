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

    /** True when the code exists, is unexpired, not exhausted, and (if email-bound) matches. */
    async validate(code: string, email: string, now: Date): Promise<boolean> {
      const inv = await prisma.inviteCode.findUnique({ where: { code } });
      if (!inv) return false;
      if (inv.expiresAt && inv.expiresAt <= now) return false;
      if (inv.usedCount >= inv.maxUses) return false;
      if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) return false;
      return true;
    },

    async consume(code: string): Promise<void> {
      await prisma.inviteCode.update({ where: { code }, data: { usedCount: { increment: 1 } } });
    },
  };
}

export type InviteCodeRepository = ReturnType<typeof createInviteCodeRepository>;
