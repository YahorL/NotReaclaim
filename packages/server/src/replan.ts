import type { ReconcileResult, SyncResult } from '@notreclaim/google';
import type { EventBus } from './events.js';

export interface ReplanDeps {
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  bus: EventBus;
  now: () => number;
  log?: (err: unknown) => void;
}

export interface PollDeps extends ReplanDeps {
  sync: (userId: string, now: number) => Promise<SyncResult>;
}

/** Local-mutation path: re-plan from local state and announce the new schedule. Errors are swallowed because the originating HTTP mutation has already succeeded. */
export async function replanAfterMutation(deps: ReplanDeps, userId: string): Promise<void> {
  try {
    const counts = await deps.reconcile(userId, deps.now());
    deps.bus.emit({ type: 'schedule.updated', userId, counts });
  } catch (err) {
    deps.log?.(err);
  }
}

/** Timer path: pull external calendar changes (inbound sync) then re-plan. Errors propagate to runPollCycle for per-user isolation. */
export async function pollAndReplan(deps: PollDeps, userId: string): Promise<void> {
  const sync = await deps.sync(userId, deps.now());
  const counts = await deps.reconcile(userId, deps.now());
  deps.bus.emit({ type: 'sync.completed', userId, sync, counts });
  deps.bus.emit({ type: 'schedule.updated', userId, counts });
}
