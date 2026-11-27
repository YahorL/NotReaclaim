import { useRef } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient, type Mutation, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useApi } from './ApiProvider';
import { ApiError, type ApiClient } from './client';
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput, UpdateScheduledBlockInput, CreateCategoryInput, UpdateCategoryInput, CreateSubtaskInput, UpdateSubtaskInput, CreateCalendarEventInput, UpdateCalendarEventInput, CreateScheduledBlockInput, ScheduledBlock } from './types';

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
 * are deferred and each deferred root is refetched once when no planner write is pending any more.
 */
const SCHEDULE_WRITE_KEY = ['scheduleWrite'] as const;

/** The query roots a pending planner write protects. */
const PROTECTED_ROOTS: readonly QueryKey[] = [queryKeys.scheduleRoot, queryKeys.calendarEventsRoot];

const sameRoot = (a: QueryKey, b: QueryKey) => a.length === 1 && b.length === 1 && a[0] === b[0];

const isProtectedRoot = (queryKey: QueryKey) => PROTECTED_ROOTS.some((r) => sameRoot(r, queryKey));

const scheduleWritesPending = (qc: QueryClient) => qc.isMutating({ mutationKey: SCHEDULE_WRITE_KEY });

/**
 * Protected roots whose refresh was deferred while a planner write was pending, per client; it is
 * drained (each root refetched once) as soon as no planner write is pending. An explicit record,
 * not the queries' `isInvalidated` flag: a fetch already in flight when the signal arrived clears
 * that flag when it lands with pre-signal data, and a failed fetch sets it without anything having
 * been deferred.
 */
const deferredRoots = new WeakMap<QueryClient, QueryKey[]>();

/** Clients whose mutation cache is watched by `drainWhenIdle`. */
const drainWatched = new WeakSet<QueryClient>();

/**
 * Invariant: whenever no planner write is pending and the record is non-empty, the record is
 * drained. A write leaves the pending count either through its `success`/`error` update (TanStack
 * dispatches it AFTER the write's own onSettled, so `isMutating` read inside onSettled cannot tell
 * which of two writes settling in the same tick is last) or by being removed from the cache
 * (session swap; a removed write may never settle, e.g. a paused offline one). Both notify the
 * mutation cache, so its listener re-checks after each event. The check runs in a microtask
 * because `clear()` notifies `removed` while the writes are still counted. Installed with the
 * first record, so a non-empty record always has a watcher.
 */
function drainWhenIdle(qc: QueryClient): void {
  if (drainWatched.has(qc)) return;
  drainWatched.add(qc);
  qc.getMutationCache().subscribe(() => {
    if (!deferredRoots.has(qc)) return;
    queueMicrotask(() => {
      const deferred = deferredRoots.get(qc);
      if (!deferred || scheduleWritesPending(qc) > 0) return;
      deferredRoots.delete(qc);
      // Plain invalidate: its default cancelRefetch also restarts a GET still in flight from
      // before the deferred signal, which would otherwise land with pre-signal data.
      for (const queryKey of deferred) void qc.invalidateQueries({ queryKey });
    });
  });
}

function recordDeferred(qc: QueryClient, queryKey: QueryKey): void {
  drainWhenIdle(qc);
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
 * skips the refetch and records the root, so the drain refetches it once no write is pending.
 * TanStack calls it once per observer, hence record-only (no invalidation from inside it). It never
 * governs a newly mounted range's initial fetch.
 */
const refetchUnlessWriting = (qc: QueryClient, root: QueryKey) => (): boolean => {
  if (scheduleWritesPending(qc) === 0) return true;
  recordDeferred(qc, root);
  return false;
};

/**
 * Invalidate a query root for a refresh signal. While a planner write is pending, the schedule /
 * calendar-event roots are deferred (drained once no write is pending); everything else, and
 * everything when nothing is pending, is invalidated + refetched as usual.
 */
export function invalidateRoot(qc: QueryClient, queryKey: QueryKey): void {
  if (isProtectedRoot(queryKey) && scheduleWritesPending(qc) > 0) {
    deferRefresh(qc, queryKey);
  } else {
    void qc.invalidateQueries({ queryKey });
  }
}

// ---- Planner writes: one registry for the pending UI, duplicate guards and failure feedback ----

/**
 * Which planner write a mutation is, tagged on its `meta.plannerWrite` (NOT its mutationKey: keys
 * match by prefix, and only the optimistic writes may carry SCHEDULE_WRITE_KEY — see above).
 * Every hook instance (top bar, mobile bar, Next-up card, detail card, grid) is its own observer,
 * so "is this pending?" is read from the shared mutation cache, by operation + target, never from
 * one instance's `isPending`.
 */
export type PlannerWriteOp = 'blockCreate' | 'blockUpdate' | 'blockDelete' | 'blockStart' | 'blockStop' | 'eventUpdate' | 'eventDelete';

export interface PlannerWriteMeta extends Record<string, unknown> {
  plannerWrite: PlannerWriteOp;
  /** The caller shows this write's failures inline (CreatePopover): no toast on top of it. */
  inlineErrors?: boolean;
}

/** What a planner write is addressed to: the block / event id, or the task id of a create. */
export function plannerWriteTarget(op: PlannerWriteOp, vars: unknown): string | null {
  if (typeof vars === 'string') return vars; // delete / start / stop take the id itself
  if (vars === null || typeof vars !== 'object') return null;
  const v = vars as { id?: unknown; taskId?: unknown };
  const target = op === 'blockCreate' ? v.taskId : v.id;
  return typeof target === 'string' ? target : null;
}

/** The planner-write tag of a mutation, or null for any other mutation. */
export function plannerWriteOf(m: Mutation<unknown, Error, unknown, unknown>): { op: PlannerWriteOp; target: string | null; inlineErrors: boolean } | null {
  const meta = m.options.meta as Partial<PlannerWriteMeta> | undefined;
  if (!meta?.plannerWrite) return null;
  return { op: meta.plannerWrite, target: plannerWriteTarget(meta.plannerWrite, m.state.variables), inlineErrors: meta.inlineErrors === true };
}

/** True while a write `op` addressed to `target` is in flight (any hook instance). */
export function isPlannerWritePending(qc: QueryClient, op: PlannerWriteOp, target: string | null): boolean {
  if (target === null) return false;
  return qc.getMutationCache().findAll({ status: 'pending', predicate: (m) => {
    const w = plannerWriteOf(m);
    return w !== null && w.op === op && w.target === target;
  } }).length > 0;
}

export interface PendingPlannerWrite { op: PlannerWriteOp; target: string | null; variables: unknown }

/** Every planner write in flight, for the pending UI (tile indicator, drop placeholder, Start/Stop). */
export function usePendingPlannerWrites(): PendingPlannerWrite[] {
  return useMutationState({
    filters: { status: 'pending', predicate: (m) => plannerWriteOf(m) !== null },
    select: (m) => {
      const w = plannerWriteOf(m)!;
      return { op: w.op, target: w.target, variables: m.state.variables };
    },
  });
}

/**
 * The result with a `mutate` that ignores a call while the same write (`op` + target) is still in
 * flight, from this or any other hook instance — a second drop of the same task, a second Start /
 * Stop / delete of the same block would otherwise queue a second request behind the first (the
 * server makes block writes wait for a running replan, so "pending" can last seconds). The guard
 * runs before `mutate`, so an ignored call never reaches onMutate. `mutateAsync` is left alone.
 */
function ignoreWhilePending<R extends { mutate: (vars: never, opts?: never) => void }>(qc: QueryClient, op: PlannerWriteOp, result: R): R {
  const mutate = ((vars: never, opts?: never) => {
    if (isPlannerWritePending(qc, op, plannerWriteTarget(op, vars))) return;
    result.mutate(vars, opts);
  }) as R['mutate'];
  return { ...result, mutate };
}

/**
 * A mutation that calls the API, then invalidates each of `roots` (in order) on success — via
 * `invalidateRoot`, so it cannot refetch over a pending planner write's optimistic value. It does
 * not carry SCHEDULE_WRITE_KEY: it has no optimistic value to protect.
 */
function useApiMutation<TVars = void, TResult = unknown>(
  call: (api: ApiClient, vars: TVars) => Promise<TResult>,
  roots: readonly QueryKey[],
  meta?: PlannerWriteMeta,
  /** Runs on success before the invalidation (while the mutation still counts as pending). */
  onData?: (qc: QueryClient, data: TResult) => void,
  /** Refreshed on failure too: what the UI offered was stale (e.g. a 404 for a block that is gone). */
  errorRoots: readonly QueryKey[] = [],
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => call(api, vars),
    meta,
    onSuccess: (data: TResult) => {
      onData?.(qc, data);
      for (const queryKey of roots) invalidateRoot(qc, queryKey);
    },
    onError: () => {
      for (const queryKey of errorRoots) invalidateRoot(qc, queryKey);
    },
  });
}

/** True when the cached schedule list `queryKey` (['schedule', { from, to }]) covers `block`. */
function scheduleListCovers(queryKey: QueryKey, block: ScheduledBlock): boolean {
  const range = queryKey[1];
  if (range === null || typeof range !== 'object') return false; // e.g. ['schedule', 'preview']
  const { from, to } = range as { from?: string; to?: string };
  // The server's range rule (startsAt < to && endsAt > from); an open end is "from now on".
  return (to === undefined || block.startsAt < to) && (from === undefined || block.endsAt > from);
}

/**
 * Write a block row the server just returned (a create, a Start, a Stop) into every cached
 * schedule list, by its range: replaced by id where the list covers it, added where it newly
 * does, removed where its new times left the list's range. Runs on success while the mutation
 * still counts as pending, so the screen shows the server's answer in the same render the request
 * stops being pending — the drop placeholder hands over to the real tile, Start turns into
 * "Now … Stop" — instead of leaving a gap until the refetch (which may be deferred behind another
 * planner write) lands. Anything that is not a block row is ignored.
 */
function writeBlockRow(qc: QueryClient, block: ScheduledBlock): void {
  if (!block || typeof block.id !== 'string' || typeof block.startsAt !== 'string' || typeof block.endsAt !== 'string') return;
  for (const [key, data] of qc.getQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot })) {
    if (!Array.isArray(data)) continue; // the preview entry
    const list = data as Array<{ id: string }>;
    const present = list.some((b) => b.id === block.id);
    const covers = scheduleListCovers(key, block);
    if (covers) qc.setQueryData(key, present ? list.map((b) => (b.id === block.id ? block : b)) : [...list, block]);
    else if (present) qc.setQueryData(key, list.filter((b) => b.id !== block.id));
  }
}

/**
 * Undo ONE optimistic write in a cached list: only its own row (`target`) goes back to what the
 * snapshot held; everything that changed in the list since — a block created meanwhile (written
 * in by `writeBlockRow`), another write's move, a concurrent optimistic delete — is kept. A
 * whole-snapshot restore would wipe those until the next refetch.
 *
 * - Row still in the list: replaced by its snapshot version (or dropped on a 404, `gone`).
 * - Row missing: put back (at its old index) only if THIS write removed it — i.e. `applied`, the
 *   write's own change to the snapshot, lacks it (a delete). A row some other write removed stays
 *   removed. None of the optimistic writes ADD rows (update/event update map, delete/event delete
 *   filter), so nothing this write added can be left behind.
 */
function revertRow<T extends { id: string }>(current: T[], snapshot: T[], target: string, gone: boolean, applied: T[]): T[] {
  if (gone) return current.filter((x) => x.id !== target);
  const index = snapshot.findIndex((x) => x.id === target);
  if (index === -1) return current; // the write never touched this list
  const before = snapshot[index]!;
  if (current.some((x) => x.id === target)) return current.map((x) => (x.id === target ? before : x));
  const removedByThisWrite = !applied.some((x) => x.id === target);
  if (!removedByThisWrite) return current;
  const at = Math.min(index, current.length);
  return [...current.slice(0, at), before, ...current.slice(at)];
}

/**
 * A mutation that optimistically rewrites every cached LIST under `root` with `apply`, rolls the
 * snapshots back on error, and refreshes `root` and each of `alsoInvalidate` once settled.
 * It is a planner write (SCHEDULE_WRITE_KEY): settling only records its roots as deferred; they
 * are refetched, with every root deferred meanwhile, once no planner write is pending.
 */
function useOptimisticListMutation<TVars, TResult>(
  call: (api: ApiClient, vars: TVars) => Promise<TResult>,
  root: QueryKey,
  apply: (list: Array<{ id: string }>, vars: TVars) => unknown[],
  alsoInvalidate: readonly QueryKey[] = [],
  meta?: PlannerWriteMeta,
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SCHEDULE_WRITE_KEY,
    meta,
    mutationFn: (vars: TVars) => call(api, vars),
    onMutate: async (vars: TVars) => {
      await qc.cancelQueries({ queryKey: root });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: root });
      // The schedule preview entry (['schedule','preview']) shares the schedule root but holds
      // a non-array SchedulePreview — the Array.isArray guard passes it through untouched.
      qc.setQueriesData<unknown>({ queryKey: root }, (old: unknown) => (Array.isArray(old) ? apply(old, vars) : old));
      return { snapshots };
    },
    onError: (err, vars, ctx) => {
      // A write no longer in the mutation cache was dropped by a session swap: its snapshots hold
      // the previous session's data and must not be restored over the new session's cache.
      if (!qc.getMutationCache().getAll().some((m) => m.state.context === ctx)) return;
      // 404: the row is gone (a replan removed it while the edit waited, or another tab deleted
      // it). Restoring it would flash it back until the refetch removes it again, so leave it out
      // — a failed move then vanishes, a delete stays done.
      const target = meta ? plannerWriteTarget(meta.plannerWrite, vars) : null;
      const gone = target !== null && err instanceof ApiError && err.status === 404;
      ctx?.snapshots.forEach(([key, data]) => {
        const current = qc.getQueryData<unknown>(key);
        if (target === null || !Array.isArray(data) || !Array.isArray(current)) {
          // Not a list (the preview entry) or nothing to merge into: the old whole-snapshot restore.
          qc.setQueryData(key, gone && Array.isArray(data) ? (data as Array<{ id: string }>).filter((x) => x.id !== target) : data);
          return;
        }
        qc.setQueryData(key, revertRow(current as Array<{ id: string }>, data as Array<{ id: string }>, target, gone, apply(data as Array<{ id: string }>, vars) as Array<{ id: string }>));
      });
    },
    // Record only, never refetch here: the drain runs once no planner write is pending (see
    // drainWhenIdle), i.e. after this write has left the pending state, so a write is never
    // pending during its own refetch and a write that is not the last never refetches.
    onSettled: () => {
      for (const queryKey of [root, ...alsoInvalidate]) deferRefresh(qc, queryKey);
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
// Never de-duplicated: a second drag (or the next keyboard commit) of the same block is a new
// edit, and WeekGrid's hold re-baselining relies on each one being sent.
export function useUpdateScheduledBlockMutation() {
  return useOptimisticListMutation(
    (api, { id, patch }: { id: string; patch: UpdateScheduledBlockInput }) => api.updateScheduledBlock(id, patch),
    queryKeys.scheduleRoot,
    (list, { id, patch }) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    [],
    { plannerWrite: 'blockUpdate' },
  );
}

// Optimistic: drop the block from every cached schedule LIST so it vanishes immediately.
export function useDeleteScheduledBlockMutation() {
  const qc = useQueryClient();
  return ignoreWhilePending(qc, 'blockDelete', useOptimisticListMutation(
    (api, id: string) => api.deleteScheduledBlock(id),
    queryKeys.scheduleRoot,
    (list, id) => list.filter((b) => b.id !== id),
    [],
    { plannerWrite: 'blockDelete' },
  ));
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
    { plannerWrite: 'eventUpdate' },
  );
}

export function useDeleteCalendarEventMutation() {
  const qc = useQueryClient();
  return ignoreWhilePending(qc, 'eventDelete', useOptimisticListMutation(
    (api, id: string) => api.deleteCalendarEvent(id),
    queryKeys.calendarEventsRoot,
    (list, id) => list.filter((e) => e.id !== id),
    [queryKeys.scheduleRoot],
    { plannerWrite: 'eventDelete' },
  ));
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
      for (const queryKey of TASK_ROOTS) invalidateRoot(qc, queryKey);
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

const SETTINGS_ROOTS = [queryKeys.settingsRoot, queryKeys.scheduleRoot] as const;

/**
 * The Settings page's save: a PATCH of the fields that page owns, i.e. everything but the two
 * buffers (the Buffers page's), so it cannot revert a buffer change saved there meanwhile nor fail
 * on a stored buffer it does not show. `configured` false = no settings row yet (GET was 404, and
 * PATCH would be too): the whole input is PUT instead, its buffers being the form's defaults.
 */
export function useSaveSettingsMutation(configured: boolean) {
  return useApiMutation((api, input: SettingsInput) => {
    if (!configured) return api.putSettings(input);
    const { meetingBufferMs: _meeting, taskBufferMs: _task, ...owned } = input;
    return api.patchSettings(owned);
  }, SETTINGS_ROOTS);
}

export type BufferValues = { meetingBufferMs: number; taskBufferMs: number };

/**
 * The Buffers page's save: a PATCH of just the buffers given, so it cannot revert a settings
 * change made elsewhere since it loaded. With no settings row yet (`firstTime`, the defaults that
 * page shows) there is nothing to patch, so it PUTs those defaults plus the buffers instead.
 */
export function useSaveBuffersMutation(firstTime: SettingsInput | null) {
  return useApiMutation(
    (api, buffers: Partial<BufferValues>) => firstTime ? api.putSettings({ ...firstTime, ...buffers }) : api.patchSettings(buffers),
    SETTINGS_ROOTS,
  );
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

/**
 * Pin a task at a slot (panel drop, CreatePopover). Not optimistic; while it is pending the
 * planner shows a placeholder at the slot. A second create for the same task while one is pending
 * is ignored. `inlineErrors`: the caller shows failures itself (no toast).
 */
export function useCreateScheduledBlockMutation({ inlineErrors = false }: { inlineErrors?: boolean } = {}) {
  const qc = useQueryClient();
  return ignoreWhilePending(qc, 'blockCreate', useApiMutation(
    (api, body: CreateScheduledBlockInput) => api.createScheduledBlock(body),
    [queryKeys.scheduleRoot],
    { plannerWrite: 'blockCreate', inlineErrors },
    writeBlockRow,
    // A 404 here means the task is gone: refresh the panel too.
    [queryKeys.scheduleRoot, queryKeys.tasksRoot],
  ));
}

export function useStartBlockMutation() {
  const qc = useQueryClient();
  return ignoreWhilePending(qc, 'blockStart', useApiMutation(
    (api, id: string) => api.startBlock(id),
    [queryKeys.scheduleRoot, queryKeys.tasksRoot],
    { plannerWrite: 'blockStart' },
    // The started row only: other pieces the server ended arrive with the refetch.
    writeBlockRow,
    [queryKeys.scheduleRoot, queryKeys.tasksRoot],
  ));
}

export function useStopBlockMutation() {
  const qc = useQueryClient();
  return ignoreWhilePending(qc, 'blockStop', useApiMutation(
    (api, id: string) => api.stopBlock(id),
    [queryKeys.scheduleRoot, queryKeys.tasksRoot],
    { plannerWrite: 'blockStop' },
    writeBlockRow,
    [queryKeys.scheduleRoot, queryKeys.tasksRoot],
  ));
}
