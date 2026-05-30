import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiProvider';

export const queryKeys = {
  scheduleRoot: ['schedule'] as const,
  schedule: (from?: string, to?: string) => ['schedule', { from, to }] as const,
  schedulePreview: () => ['schedule', 'preview'] as const,
  calendarEventsRoot: ['calendarEvents'] as const,
  calendarEvents: (from?: string, to?: string) => ['calendarEvents', { from, to }] as const,
  tasksRoot: ['tasks'] as const,
  tasks: (status?: string) => ['tasks', { status }] as const,
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
