/** A replan-shaped function: one user's re-plan, with the clock passed in (DI). */
export type PerUserRun<R> = (userId: string, now: number) => Promise<R>;

export interface PerUserQueueOptions {
  /** Read when a QUEUED run actually starts. Defaults to `Date.now`. */
  clock?: () => number;
}

interface Waiting<R> {
  /** Latest `now` among the requests this follow-up covers. */
  now: number;
  promise: Promise<R>;
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
}

interface UserEntry<R> {
  /** The ONE follow-up run every request arriving during the current run is folded into. */
  waiting: Waiting<R> | null;
}

/**
 * Serialise `run` per user: at most one run per userId at a time, users never block each other.
 *
 * - Idle user: the run starts synchronously with the caller's `now`, exactly like calling
 *   `run` directly.
 * - Busy user: the request waits. Every request that arrives while a run is in flight is
 *   coalesced into ONE follow-up run, started after the current one settles. It reads fresh
 *   state, so it reflects all of their mutations; each of those callers settles with ITS
 *   result. A caller is never handed the result of a run that started before it asked.
 * - A follow-up run is clocked when it STARTS: `max(clock(), latest requested now)`, so it
 *   never plans from a time earlier than one of its requests nor from its enqueue time.
 * - A failed run rejects only the callers it covered; the next request runs normally.
 * - A user's entry is dropped as soon as nothing is running or waiting for them.
 */
export function serialisePerUser<R>(
  run: PerUserRun<R>,
  opts: PerUserQueueOptions = {},
): PerUserRun<R> & { activeUsers: () => number } {
  const clock = opts.clock ?? (() => Date.now());
  const entries = new Map<string, UserEntry<R>>();

  const start = (entry: UserEntry<R>, userId: string, now: number): Promise<R> => {
    let current: Promise<R>;
    try {
      current = run(userId, now);
    } catch (err) {
      current = Promise.reject(err); // a synchronous throw must not wedge the entry
    }
    const advance = (): void => {
      const next = entry.waiting;
      entry.waiting = null;
      if (!next) {
        entries.delete(userId);
        return;
      }
      start(entry, userId, Math.max(clock(), next.now)).then(next.resolve, next.reject);
    };
    // Two-callback then (not finally): the derived promise always fulfils, so a failed run
    // never surfaces as an unhandled rejection here — it reaches only the callers it covered.
    current.then(advance, advance);
    return current;
  };

  const serialised = (userId: string, now: number): Promise<R> => {
    const entry = entries.get(userId);
    if (!entry) {
      const fresh: UserEntry<R> = { waiting: null };
      entries.set(userId, fresh);
      return start(fresh, userId, now);
    }
    if (entry.waiting) {
      entry.waiting.now = Math.max(entry.waiting.now, now);
      return entry.waiting.promise;
    }
    let resolve!: (value: R) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<R>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    entry.waiting = { now, promise, resolve, reject };
    return promise;
  };
  /** Users with a run in flight (for tests: proves idle entries are dropped). */
  return Object.assign(serialised, { activeUsers: () => entries.size });
}
