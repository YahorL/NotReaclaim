import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useApi } from './ApiProvider';
import type { ApiClient } from './client';
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput, UpdateScheduledBlockInput, CreateCategoryInput, UpdateCategoryInput, CreateSubtaskInput, UpdateSubtaskInput, CreateCalendarEventInput, UpdateCalendarEventInput, CreateScheduledBlockInput } from './types';

export const queryKeys = {
  scheduleRoot: ['schedule'] as const,
  schedule: (from?: string, to?: string) => ['schedule', { from, to }] as const,
  schedulePreview: () => ['schedule', 'preview'] as const,
  calendarEventsRoot: ['calendarEvents'] as const,
  calendarEvents: (from?: string, to?: string) => ['calendarEvents', { from, to }] as const,
  tasksRoot: ['tasks'] as const,
  tasks: (status?: string) => ['tasks', { status }] as const,
  habitsRoot: ['habits'] as const,
  habits: () => ['habits'] as const,
  settingsRoot: ['settings'] as const,
  settings: () => ['settings'] as const,
  categoriesRoot: ['categories'] as const,
  categories: () => ['categories'] as const,
  googleStatusRoot: ['googleStatus'] as const,
  googleStatus: () => ['googleStatus'] as const,
};

/** A mutation that calls the API, then invalidates each of `roots` (in order) on success. */
function useApiMutation<TVars = void, TResult = unknown>(
  call: (api: ApiClient, vars: TVars) => Promise<TResult>,
  roots: readonly QueryKey[],
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => call(api, vars),
    onSuccess: () => {
      for (const queryKey of roots) void qc.invalidateQueries({ queryKey });
    },
  });
}

/**
 * A mutation that optimistically rewrites every cached LIST under `root` with `apply`, rolls the
 * snapshots back on error, and invalidates `root` then each of `alsoInvalidate` once settled.
 */
function useOptimisticListMutation<TVars, TResult>(
  call: (api: ApiClient, vars: TVars) => Promise<TResult>,
  root: QueryKey,
  apply: (list: Array<{ id: string }>, vars: TVars) => unknown[],
  alsoInvalidate: readonly QueryKey[] = [],
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => call(api, vars),
    onMutate: async (vars: TVars) => {
      await qc.cancelQueries({ queryKey: root });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: root });
      // The schedule preview entry (['schedule','preview']) shares the schedule root but holds
      // a non-array SchedulePreview — the Array.isArray guard passes it through untouched.
      qc.setQueriesData<unknown>({ queryKey: root }, (old: unknown) => (Array.isArray(old) ? apply(old, vars) : old));
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: root });
      for (const queryKey of alsoInvalidate) void qc.invalidateQueries({ queryKey });
    },
  });
}

/** Health of the Google Calendar link; refreshed by the `google.status` WS event. */
export function useGoogleStatusQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.googleStatus(), queryFn: () => api.getGoogleStatus() });
}

export function useScheduleQuery(from?: string, to?: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.schedule(from, to), queryFn: () => api.getSchedule(from, to) });
}

export function useCalendarEventsQuery(from?: string, to?: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.calendarEvents(from, to), queryFn: () => api.getCalendarEvents(from, to) });
}

export function useSchedulePreviewQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.schedulePreview(), queryFn: () => api.getSchedulePreview() });
}

export function useReplanMutation() {
  return useApiMutation((api) => api.replan(), [queryKeys.scheduleRoot]);
}

// Optimistic: patch every cached schedule LIST so the released block renders in place
// immediately.
export function useUpdateScheduledBlockMutation() {
  return useOptimisticListMutation(
    (api, { id, patch }: { id: string; patch: UpdateScheduledBlockInput }) => api.updateScheduledBlock(id, patch),
    queryKeys.scheduleRoot,
    (list, { id, patch }) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  );
}

// Optimistic: drop the block from every cached schedule LIST so it vanishes immediately.
export function useDeleteScheduledBlockMutation() {
  return useOptimisticListMutation(
    (api, id: string) => api.deleteScheduledBlock(id),
    queryKeys.scheduleRoot,
    (list, id) => list.filter((b) => b.id !== id),
  );
}

// Optimistic: patch every cached calendar-event LIST so a dragged event stays where it
// was dropped while the PATCH is in flight (same shape as the block-move mutation).
// Moving an event changes the busy map, so the server re-plans around it.
export function useUpdateCalendarEventMutation() {
  return useOptimisticListMutation(
    (api, { id, ...patch }: { id: string } & UpdateCalendarEventInput) => api.updateCalendarEvent(id, patch),
    queryKeys.calendarEventsRoot,
    (list, { id, ...patch }) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    [queryKeys.scheduleRoot],
  );
}

export function useDeleteCalendarEventMutation() {
  return useOptimisticListMutation(
    (api, id: string) => api.deleteCalendarEvent(id),
    queryKeys.calendarEventsRoot,
    (list, id) => list.filter((e) => e.id !== id),
    [queryKeys.scheduleRoot],
  );
}

export function useTasksQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tasks(), queryFn: () => api.listTasks() });
}

export function useHabitsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.habits(), queryFn: () => api.listHabits() });
}

const TASK_ROOTS = [queryKeys.tasksRoot, queryKeys.scheduleRoot] as const;
const HABIT_ROOTS = [queryKeys.habitsRoot, queryKeys.scheduleRoot] as const;

export function useCreateTaskMutation() {
  return useApiMutation((api, body: CreateTaskInput) => api.createTask(body), TASK_ROOTS);
}
export function useUpdateTaskMutation() {
  return useApiMutation((api, { id, patch }: { id: string; patch: UpdateTaskInput }) => api.updateTask(id, patch), TASK_ROOTS);
}
export function useDeleteTaskMutation() {
  return useApiMutation((api, id: string) => api.deleteTask(id), TASK_ROOTS);
}

const TASK_MOVE_KEY = ['tasks', 'move'] as const;

/**
 * A board move (Priorities drag or arrow keys): `patch` is the task's new priority / status /
 * sortOrder, computed by the board from the arrangement it already shows.
 *
 * - Optimistic at once (`onMutate` runs immediately even while queued), after cancelling any tasks
 *   refetch in flight — its pre-move response would otherwise land on top and step the card back.
 * - Serialized: `scope` sends one PATCH at a time, in press order, so a run of moves can never
 *   commit out of order and leave a stale sortOrder / priority behind.
 * - Rollback and invalidation are MUTATION-level: TanStack runs per-`mutate` callbacks only for the
 *   latest call, so a failed earlier move used to stay applied. A run of queued moves settles as
 *   one: when the last settles, any failure rolls the cache back to before the run's first move,
 *   and the tasks + schedule refetch once (not between moves, which would flash pre-move state).
 */
export function useMoveTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRef<{ snapshots: Array<[QueryKey, unknown]>; failed: boolean } | null>(null);
  return useMutation({
    mutationKey: TASK_MOVE_KEY,
    scope: { id: 'task-move' },
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) => api.updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasksRoot });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.tasksRoot });
      if (run.current === null) run.current = { snapshots, failed: false };
      qc.setQueriesData<unknown>({ queryKey: queryKeys.tasksRoot }, (old: unknown) => (Array.isArray(old)
        ? (old as Array<{ id: string }>).map((x) => (x.id === id ? { ...x, ...patch } : x))
        : old));
    },
    onError: () => { if (run.current) run.current.failed = true; },
    onSettled: () => {
      // This mutation still counts as pending inside its own onSettled.
      if (qc.isMutating({ mutationKey: TASK_MOVE_KEY }) > 1) return;
      const r = run.current;
      run.current = null;
      if (r?.failed) for (const [key, data] of r.snapshots) qc.setQueryData(key, data);
      for (const queryKey of TASK_ROOTS) void qc.invalidateQueries({ queryKey });
    },
  });
}

export function useCreateHabitMutation() {
  return useApiMutation((api, body: CreateHabitInput) => api.createHabit(body), HABIT_ROOTS);
}
export function useUpdateHabitMutation() {
  return useApiMutation((api, { id, patch }: { id: string; patch: UpdateHabitInput }) => api.updateHabit(id, patch), HABIT_ROOTS);
}
export function useDeleteHabitMutation() {
  return useApiMutation((api, id: string) => api.deleteHabit(id), HABIT_ROOTS);
}

export function useSettingsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings(), queryFn: () => api.getSettings() });
}

export function useUpdateSettingsMutation() {
  return useApiMutation((api, body: SettingsInput) => api.putSettings(body), [queryKeys.settingsRoot, queryKeys.scheduleRoot]);
}

export function useCategoriesQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.categories(), queryFn: () => api.listCategories() });
}

const CATEGORY_ROOTS = [queryKeys.categoriesRoot, queryKeys.scheduleRoot] as const;

export function useCreateCategoryMutation() {
  return useApiMutation((api, body: CreateCategoryInput) => api.createCategory(body), CATEGORY_ROOTS);
}
export function useUpdateCategoryMutation() {
  return useApiMutation((api, { id, patch }: { id: string; patch: UpdateCategoryInput }) => api.updateCategory(id, patch), CATEGORY_ROOTS);
}
export function useDeleteCategoryMutation() {
  return useApiMutation((api, id: string) => api.deleteCategory(id), CATEGORY_ROOTS);
}

const SUBTASK_ROOTS = [queryKeys.tasksRoot] as const;

export function useCreateSubtaskMutation() {
  return useApiMutation((api, body: CreateSubtaskInput) => api.createSubtask(body), SUBTASK_ROOTS);
}
export function useUpdateSubtaskMutation() {
  return useApiMutation((api, { id, patch }: { id: string; patch: UpdateSubtaskInput }) => api.updateSubtask(id, patch), SUBTASK_ROOTS);
}
export function useDeleteSubtaskMutation() {
  return useApiMutation((api, id: string) => api.deleteSubtask(id), SUBTASK_ROOTS);
}

export function useCreateCalendarEventMutation() {
  return useApiMutation(
    (api, body: CreateCalendarEventInput) => api.createCalendarEvent(body),
    [queryKeys.calendarEventsRoot, queryKeys.scheduleRoot],
  );
}

export function useCreateScheduledBlockMutation() {
  return useApiMutation((api, body: CreateScheduledBlockInput) => api.createScheduledBlock(body), [queryKeys.scheduleRoot]);
}

export function useStartBlockMutation() {
  return useApiMutation((api, id: string) => api.startBlock(id), [queryKeys.scheduleRoot, queryKeys.tasksRoot]);
}

export function useStopBlockMutation() {
  return useApiMutation((api, id: string) => api.stopBlock(id), [queryKeys.scheduleRoot, queryKeys.tasksRoot]);
}
