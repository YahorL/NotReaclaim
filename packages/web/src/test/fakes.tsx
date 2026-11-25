import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../api/ApiProvider';
import { AuthProvider } from '../auth/AuthContext';
import { vi } from 'vitest';
import { createApiClient, type ApiClient } from '../api/client';

/** What the real client throws for a failed response: one request, answered by `response`. */
async function errorFromResponse(response: Response): Promise<unknown> {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
  try {
    await createApiClient({ baseUrl: '', getToken: () => null }).patchSettings({});
  } catch (e) {
    return e;
  } finally {
    spy.mockRestore();
  }
  throw new Error(`expected a ${response.status} to reject`);
}

/**
 * The error a save gets when a proxy in front of the API (Caddy in production) answers `status`
 * with its own HTML page — the API container is stopped or restarting.
 */
export function gatewayError(status: number): Promise<unknown> {
  return errorFromResponse(new Response(`<html><body>${status}</body></html>`, { status, headers: { 'Content-Type': 'text/html' } }));
}

/** The error a save gets when the API itself answers `status` with its JSON error body. */
export function apiErrorFor(status: number, body: { code: string; message: string }): Promise<unknown> {
  return errorFromResponse(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

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
    patchSettings: notImplemented('patchSettings'),
    getSchedule: notImplemented('getSchedule'),
    updateScheduledBlock: notImplemented('updateScheduledBlock'),
    deleteScheduledBlock: notImplemented('deleteScheduledBlock'),
    getCalendarEvents: notImplemented('getCalendarEvents'),
    updateCalendarEvent: notImplemented('updateCalendarEvent'),
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
    getLinkGoogleUrl: notImplemented('getLinkGoogleUrl'),
    getGoogleStatus: notImplemented('getGoogleStatus'),
  };
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
