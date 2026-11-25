/** Run `fn` while holding `userId`'s lock; resolves or rejects exactly as `fn` does. */
export type WithUserLock = <T>(userId: string, fn: () => Promise<T>) => Promise<T>;

/**
 * A FIFO mutex per user, in process. Sections for the same user run one at a time in arrival
 * order; users never block each other. A section that throws (or rejects) releases the lock
 * and rejects only its own caller. A user's entry is dropped as soon as nothing holds or waits
 * for it.
 *
 * Not re-entrant: a section that takes the same user's lock again waits for itself forever.
 * Callers hold it only around short read-modify-write sections and never await a replan
 * inside one (see server.ts and schedule-routes.ts).
 */
export function createUserLock(): WithUserLock & { held: () => number } {
  const tails = new Map<string, Promise<void>>();
  const withUserLock = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    // Never rejects: `prev` is always a tail like this one, and `mine` only ever resolves.
    const tail = prev.then(() => mine);
    tails.set(userId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(userId) === tail) tails.delete(userId);
    }
  };
  /** Users holding or waiting for the lock (for tests: proves idle entries are dropped). */
  return Object.assign(withUserLock, { held: () => tails.size });
}
