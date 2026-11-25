import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
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

/**
 * Shared `mutationKey` of the optimistic planner writes (block/event move + delete). While any is
 * pending, a refetch of a protected root could read the pre-write server state and overwrite the
 * optimistic value (tile jumps back, deleted tile reappears), so refresh signals for those roots
 * are deferred and the last write to settle refetches each deferred root once.
 */
const SCHEDULE_WRITE_KEY = ['scheduleWrite'] as const;

/** The query roots a pending planner write protects. */
const PROTECTED_ROOTS: readonly QueryKey[] = [queryKeys.scheduleRoot, queryKeys.calendarEventsRoot];

const sameRoot = (a: QueryKey, b: QueryKey) => a.length === 1 && b.length === 1 && a[0] === b[0];

const isProtectedRoot = (queryKey: QueryKey) => PROTECTED_ROOTS.some((r) => sameRoot(r, queryKey));

const scheduleWritesPending = (qc: QueryClient) => qc.isMutating({ mutationKey: SCHEDULE_WRITE_KEY });

/**
 * Protected roots whose refresh was deferred while a planner write was pending, per client; the
 * last write to settle drains it. An explicit record, not the queries' `isInvalidated` flag: a
 * fetch already in flight when the signal arrived clears that flag when it lands with pre-signal
 * data, and a failed fetch sets it without anything having been deferred.
 */
const deferredRoots = new WeakMap<QueryClient, QueryKey[]>();

function recordDeferred(qc: QueryClient, queryKey: QueryKey): void {
  const deferred = deferredRoots.get(qc) ?? [];
  if (!deferred.some((r) => sameRoot(r, queryKey))) deferredRoots.set(qc, [...deferred, queryKey]);
}

/** Record a protected root as deferred and mark its queries stale without refetching them. */
function deferRefresh(qc: QueryClient, queryKey: QueryKey): void {
  recordDeferred(qc, queryKey);
  void qc.invalidateQueries({ queryKey, refetchType: 'none' });
}

/**
 * `refetchOnWindowFocus` / `refetchOnReconnect` for the protected queries. With no planner write
 * pending it returns `true`, i.e. TanStack's default (refetch if stale). While one is pending it
 * skips the refetch and records the root, so the last write to settle refetches it. TanStack calls
 * it once per observer, hence record-only (no invalidation from inside it). It never governs a
 * newly mounted range's initial fetch.
 */
const refetchUnlessWriting = (qc: QueryClient, root: QueryKey) => (): boolean => {
  if (scheduleWritesPending(qc) === 0) return true;
  recordDeferred(qc, root);
  return false;
};

/**
 * Invalidate a query root for a refresh signal. While a planner write is pending, the schedule /
 * calendar-event roots are deferred (the last write's settle refetches them); everything else,
 * and everything when nothing is pending, is invalidated + refetched as usual.
 */
export function invalidateRoot(qc: QueryClient, queryKey: QueryKey): void {
  if (isProtectedRoot(queryKey) && scheduleWritesPending(qc) > 0) {
    deferRefresh(qc, queryKey);
  } else {
    void qc.invalidateQueries({ queryKey });
  }
}

/**
 * A mutation that calls the API, then invalidates each of `roots` (in order) on success — via
 * `invalidateRoot`, so it cannot refetch over a pending planner write's optimistic value. It does
 * not carry SCHEDULE_WRITE_KEY: it has no optimistic value to protect.
 */
function useApiMutation<TVars = void, TResult = unknown>(
  call: (api: ApiClient, vars: TVars) => Promise<TResult>,
  roots: readonly QueryKey[],
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => call(api, vars),
    onSuccess: () => {
      for (const queryKey of roots) invalidateRoot(qc, queryKey);
    },
  });
}

/**
 * A mutation that optimistically rewrites every cached LIST under `root` with `apply`, rolls the
 * snapshots back on error, and invalidates `root` then each of `alsoInvalidate` once settled.
 * It is a planner write (SCHEDULE_WRITE_KEY): if another planner write is still pending it only
 * defers its roots; the last one to settle refetches its roots plus every root deferred meanwhile.
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
    mutationKey: SCHEDULE_WRITE_KEY,
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
    // Synchronous on purpose: TanStack still counts this mutation as pending inside onSettled, so
    // `> 1` means another planner write is still in flight and this one is not the last. (`> 1`
    // rather than `=== 1` so that a count of 0, e.g. after the mutation cache was cleared on a
    // session swap, also counts as last.) Awaiting the refetch here would keep this write pending
    // during its own refetch, and a signal arriving then would be deferred to a settle already done.
    onSettled: () => {
      const roots = [root, ...alsoInvalidate];
      if (scheduleWritesPending(qc) > 1) {
        for (const queryKey of roots) deferRefresh(qc, queryKey);
        return;
      }
      const deferred = deferredRoots.get(qc) ?? [];
      deferredRoots.delete(qc);
      for (const queryKey of roots) void qc.invalidateQueries({ queryKey });
      // Plain invalidate: its default cancelRefetch also restarts a GET still in flight from
      // before the deferred signal, which would otherwise land with pre-signal data.
      for (const queryKey of deferred) {
        if (!roots.some((r) => sameRoot(r, queryKey))) void qc.invalidateQueries({ queryKey });
      }
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
  const refetch = refetchUnlessWriting(useQueryClient(), queryKeys.scheduleRoot);
  return useQuery({
    queryKey: queryKeys.schedule(from, to),
    queryFn: () => api.getSchedule(from, to),
    refetchOnWindowFocus: refetch,
    refetchOnReconnect: refetch,
  });
}

export function useCalendarEventsQuery(from?: string, to?: string) {
  const api = useApi();
  const refetch = refetchUnlessWriting(useQueryClient(), queryKeys.calendarEventsRoot);
  return useQuery({
    queryKey: queryKeys.calendarEvents(from, to),
    queryFn: () => api.getCalendarEvents(from, to),
    refetchOnWindowFocus: refetch,
    refetchOnReconnect: refetch,
  });
}

export function useSchedulePreviewQuery() {
  const api = useApi();
  const refetch = refetchUnlessWriting(useQueryClient(), queryKeys.scheduleRoot);
  return useQuery({
    queryKey: queryKeys.schedulePreview(),
    queryFn: () => api.getSchedulePreview(),
    refetchOnWindowFocus: refetch,
    refetchOnReconnect: refetch,
  });
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
