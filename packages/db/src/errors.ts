import { Prisma } from '@prisma/client';

/** A requested record does not exist (or is not owned by the user). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** A uniqueness or integrity constraint was violated. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Translate a known Prisma error into a domain error. Rethrows anything else
 * unchanged. Always throws — never returns.
 */
export function translatePrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ConflictError('Unique constraint violation');
    }
    if (error.code === 'P2025') {
      throw new NotFoundError('Record not found');
    }
  }
  throw error;
}
