import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../api/ApiProvider';
import { AuthProvider } from '../auth/AuthContext';
import type { ApiClient } from '../api/client';

export function fakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notImplemented = (name: string) => () => Promise.reject(new Error(`${name} not implemented in fake`));
  const base: ApiClient = {
    getConsentUrl: notImplemented('getConsentUrl'),
    listTasks: notImplemented('listTasks'),
    createTask: notImplemented('createTask'),
    updateTask: notImplemented('updateTask'),
    deleteTask: notImplemented('deleteTask'),
    listHabits: notImplemented('listHabits'),
    createHabit: notImplemented('createHabit'),
    updateHabit: notImplemented('updateHabit'),
    deleteHabit: notImplemented('deleteHabit'),
    getSettings: notImplemented('getSettings'),
    putSettings: notImplemented('putSettings'),
    getSchedule: notImplemented('getSchedule'),
    updateScheduledBlock: notImplemented('updateScheduledBlock'),
    deleteScheduledBlock: notImplemented('deleteScheduledBlock'),
    getCalendarEvents: notImplemented('getCalendarEvents'),
    deleteCalendarEvent: notImplemented('deleteCalendarEvent'),
    getSchedulePreview: notImplemented('getSchedulePreview'),
    replan: notImplemented('replan'),
    listCategories: notImplemented('listCategories'),
    createCategory: notImplemented('createCategory'),
    updateCategory: notImplemented('updateCategory'),
    deleteCategory: notImplemented('deleteCategory'),
    createSubtask: notImplemented('createSubtask'),
    updateSubtask: notImplemented('updateSubtask'),
    deleteSubtask: notImplemented('deleteSubtask'),
    createCalendarEvent: notImplemented('createCalendarEvent'),
    createScheduledBlock: notImplemented('createScheduledBlock'),
    startBlock: notImplemented('startBlock'),
    stopBlock: notImplemented('stopBlock'),
    register: notImplemented('register'),
    login: notImplemented('login'),
    setPassword: notImplemented('setPassword'),
    changeEmail: notImplemented('changeEmail'),
    getLinkGoogleUrl: notImplemented('getLinkGoogleUrl'),
  } as unknown as ApiClient;
  return { ...base, ...overrides };
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { api?: ApiClient; initialEntries?: string[] } = {},
): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = opts.api ?? fakeApiClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
