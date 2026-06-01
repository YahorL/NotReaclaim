import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiProvider';
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput, UpdateScheduledBlockInput } from './types';

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
    onSuccess: () => {
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
