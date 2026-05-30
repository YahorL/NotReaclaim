import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: unknown }
  | { type: 'sync.completed'; userId: string; sync: unknown; counts: unknown }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

/** Invalidate the query keys affected by a server event. Invalidating a root key (e.g.
 *  ['schedule']) matches every ['schedule', ...] key (including ['schedule','preview']) by prefix. */
export function invalidateForEvent(qc: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case 'schedule.updated':
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      break;
    case 'sync.completed':
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.calendarEventsRoot });
      break;
    case 'task.changed':
      void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      break;
  }
}
