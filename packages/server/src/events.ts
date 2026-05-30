import type { ReconcileResult, SyncResult } from '@notreclaim/google';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: ReconcileResult }
  | { type: 'sync.completed'; userId: string; sync: SyncResult; counts: ReconcileResult }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

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
