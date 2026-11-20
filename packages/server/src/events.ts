import type { ReconcileResult, SyncResult } from '@notreclaim/google';

/**
 * The client-cached data kinds a write can change. Closed on purpose: the web maps each name
 * 1:1 to the TanStack Query root key of the same name and ignores any name it doesn't know.
 */
export type DataResource = 'tasks' | 'habits' | 'categories' | 'settings' | 'calendarEvents' | 'schedule' | 'googleStatus';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: ReconcileResult }
  | { type: 'sync.completed'; userId: string; sync: SyncResult; counts: ReconcileResult }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' }
  // Emitted only when the Google connection's health flips, so the UI can surface/clear the warning.
  | { type: 'google.status'; userId: string; broken: boolean }
  // Emitted by a route straight after its own write succeeds (never on a 4xx, and independent
  // of the follow-up replan), so the user's other tabs refetch the lists that write touched.
  | { type: 'data.changed'; userId: string; resources: DataResource[] };

/** Build a `data.changed` event (keeps the call sites one short, typed line). */
export function dataChanged(userId: string, ...resources: DataResource[]): ServerEvent {
  return { type: 'data.changed', userId, resources };
}

export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A faulty listener must not break delivery to the others.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
