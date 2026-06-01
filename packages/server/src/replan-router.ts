import type { ReconcileResult } from '@notreclaim/google';

export interface ReplanRouterDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  planLocally: (userId: string, now: number) => Promise<ReconcileResult>;
  isConnected: (userId: string) => Promise<boolean>;
}

/** Re-plan a user's schedule: Google reconcile when connected, else local persist. */
export function makeReplan(deps: ReplanRouterDeps): (userId: string, now: number) => Promise<ReconcileResult> {
  return async (userId, now) => ((await deps.isConnected(userId)) ? deps.reconcile(userId, now) : deps.planLocally(userId, now));
}
