import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiProvider';
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput, UpdateScheduledBlockInput, CreateCategoryInput, UpdateCategoryInput, CreateSubtaskInput, UpdateSubtaskInput, CreateCalendarEventInput, CreateScheduledBlockInput } from './types';

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
};

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
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.replan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useUpdateScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateScheduledBlockInput }) => api.updateScheduledBlock(id, patch),
    // Optimistic: patch every cached schedule LIST so the released block renders in place
    // immediately. The preview entry (['schedule','preview']) shares the root but holds a
    // non-array SchedulePreview — the Array.isArray guard passes it through untouched.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.scheduleRoot });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot });
      qc.setQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot }, (old: unknown) =>
        Array.isArray(old) ? old.map((b: { id: string }) => (b.id === id ? { ...b, ...patch } : b)) : old,
      );
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useDeleteScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteScheduledBlock(id),
    // Optimistic: drop the block from every cached schedule LIST so it vanishes immediately.
    // The preview entry shares the root but is non-array — the Array.isArray guard skips it.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.scheduleRoot });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot });
      qc.setQueriesData<unknown>({ queryKey: queryKeys.scheduleRoot }, (old: unknown) =>
        Array.isArray(old) ? old.filter((b: { id: string }) => b.id !== id) : old,
      );
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useDeleteCalendarEventMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCalendarEvent(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.calendarEventsRoot });
      const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.calendarEventsRoot });
      qc.setQueriesData<unknown>({ queryKey: queryKeys.calendarEventsRoot }, (old: unknown) =>
        Array.isArray(old) ? old.filter((e: { id: string }) => e.id !== id) : old,
      );
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.calendarEventsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useTasksQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tasks(), queryFn: () => api.listTasks() });
}

export function useHabitsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.habits(), queryFn: () => api.listHabits() });
}

function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}
function invalidateHabits(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.habitsRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}

export function useCreateTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateTaskInput) => api.createTask(body), onSuccess: () => invalidateTasks(qc) });
}
export function useUpdateTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) => api.updateTask(id, patch), onSuccess: () => invalidateTasks(qc) });
}
export function useDeleteTaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteTask(id), onSuccess: () => invalidateTasks(qc) });
}

export function useCreateHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateHabitInput) => api.createHabit(body), onSuccess: () => invalidateHabits(qc) });
}
export function useUpdateHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateHabitInput }) => api.updateHabit(id, patch), onSuccess: () => invalidateHabits(qc) });
}
export function useDeleteHabitMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteHabit(id), onSuccess: () => invalidateHabits(qc) });
}

export function useSettingsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings(), queryFn: () => api.getSettings() });
}

export function useUpdateSettingsMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsInput) => api.putSettings(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settingsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useCategoriesQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.categories(), queryFn: () => api.listCategories() });
}

function invalidateCategories(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.categoriesRoot });
  void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
}

export function useCreateCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateCategoryInput) => api.createCategory(body), onSuccess: () => invalidateCategories(qc) });
}
export function useUpdateCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateCategoryInput }) => api.updateCategory(id, patch), onSuccess: () => invalidateCategories(qc) });
}
export function useDeleteCategoryMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteCategory(id), onSuccess: () => invalidateCategories(qc) });
}

function invalidateTasksOnly(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
}

export function useCreateSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: CreateSubtaskInput) => api.createSubtask(body), onSuccess: () => invalidateTasksOnly(qc) });
}
export function useUpdateSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateSubtaskInput }) => api.updateSubtask(id, patch), onSuccess: () => invalidateTasksOnly(qc) });
}
export function useDeleteSubtaskMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.deleteSubtask(id), onSuccess: () => invalidateTasksOnly(qc) });
}

export function useCreateCalendarEventMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCalendarEventInput) => api.createCalendarEvent(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.calendarEventsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useCreateScheduledBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScheduledBlockInput) => api.createScheduledBlock(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}

export function useStartBlockMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.startBlock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.tasksRoot });
    },
  });
}
