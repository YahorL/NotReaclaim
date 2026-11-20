import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';

/** The data kinds a server write can announce; mirrors the server's closed `DataResource` union. */
export type DataResource = 'tasks' | 'habits' | 'categories' | 'settings' | 'calendarEvents' | 'schedule' | 'googleStatus';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: unknown }
  | { type: 'sync.completed'; userId: string; sync: unknown; counts: unknown }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' }
  | { type: 'google.status'; userId: string; broken: boolean }
  | { type: 'data.changed'; userId: string; resources: DataResource[] };

/** Each announced resource → the one query root it refreshes (1:1, by name). */
const RESOURCE_ROOTS: Record<DataResource, QueryKey> = {
  tasks: queryKeys.tasksRoot,
  habits: queryKeys.habitsRoot,
  categories: queryKeys.categoriesRoot,
  settings: queryKeys.settingsRoot,
  calendarEvents: queryKeys.calendarEventsRoot,
  schedule: queryKeys.scheduleRoot,
  googleStatus: queryKeys.googleStatusRoot,
};

/** Invalidate the query keys affected by a server event. Invalidating a root key (e.g.
 *  ['schedule']) matches every ['schedule', ...] key (including ['schedule','preview']) by prefix.
 *  Anything unrecognised — an event type or a resource name from a newer server — is ignored,
 *  so old and new bundles/servers can talk to each other during a deploy. */
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
    case 'google.status':
      void qc.invalidateQueries({ queryKey: queryKeys.googleStatusRoot });
      break;
    case 'data.changed': {
      const resources: unknown = event.resources;
      if (!Array.isArray(resources)) break;
      for (const resource of new Set(resources)) {
        if (typeof resource !== 'string' || !Object.hasOwn(RESOURCE_ROOTS, resource)) continue;
        void qc.invalidateQueries({ queryKey: RESOURCE_ROOTS[resource as DataResource] });
      }
      break;
    }
  }
}
