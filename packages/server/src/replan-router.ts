import type { ReconcileResult } from '@notreclaim/google';
import { serialisePerUser } from './replan-queue.js';

export interface ReplanRouterDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  planLocally: (userId: string, now: number) => Promise<ReconcileResult>;
  isConnected: (userId: string) => Promise<boolean>;
  /** Clock read when a queued replan starts (see serialisePerUser). Defaults to Date.now. */
  clock?: () => number;
}

/**
 * Re-plan a user's schedule: Google reconcile when connected, else local persist.
 *
 * Serialised per user: every entry point (mutation routes, POST /schedule/replan, the poll)
 * shares this one function, so two replans for the same user never interleave their
 * read-diff-write cycles (duplicate rows / orphaned Google events). See replan-queue.ts.
 */
export function makeReplan(deps: ReplanRouterDeps): (userId: string, now: number) => Promise<ReconcileResult> {
  return serialisePerUser<ReconcileResult>(
    async (userId, now) => ((await deps.isConnected(userId)) ? deps.reconcile(userId, now) : deps.planLocally(userId, now)),
    { clock: deps.clock },
  );
}
