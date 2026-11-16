import { NotFoundError, translatePrismaError } from '../errors.js';

/**
 * Update one row the caller owns. `write` is an `updateMany` scoped to the owner, so a row that
 * is missing or belongs to someone else matches nothing and becomes a NotFoundError carrying
 * `notFoundMessage` (the server returns that text in 404 bodies). `reread` then fetches the
 * updated row. Prisma errors from either query are translated into domain errors.
 */
export async function updateOwned<T>(
  notFoundMessage: string,
  write: () => Promise<{ count: number }>,
  reread: () => Promise<T>,
): Promise<T> {
  try {
    const result = await write();
    if (result.count === 0) throw new NotFoundError(notFoundMessage);
    return await reread();
  } catch (error) {
    translatePrismaError(error);
  }
}

/** Delete one row the caller owns via an owner-scoped `deleteMany`; nothing deleted → NotFoundError. */
export async function deleteOwned(notFoundMessage: string, remove: () => Promise<{ count: number }>): Promise<void> {
  const result = await remove();
  if (result.count === 0) throw new NotFoundError(notFoundMessage);
}
