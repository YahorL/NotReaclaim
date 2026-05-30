import type {
  Task, Habit, Settings, ScheduledBlock, SchedulePreview, ReconcileResult,
  TaskStatus, CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput,
} from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
}

export interface ApiClient {
  getConsentUrl(): Promise<{ url: string }>;
  listTasks(status?: TaskStatus): Promise<Task[]>;
  createTask(body: CreateTaskInput): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  listHabits(): Promise<Habit[]>;
  createHabit(body: CreateHabitInput): Promise<Habit>;
  updateHabit(id: string, patch: UpdateHabitInput): Promise<Habit>;
  deleteHabit(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  putSettings(body: SettingsInput): Promise<Settings>;
  getSchedule(from?: string, to?: string): Promise<ScheduledBlock[]>;
  getSchedulePreview(): Promise<SchedulePreview>;
  replan(): Promise<ReconcileResult>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = config.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let code = 'error';
      let message = `Request failed with status ${res.status}`;
      try {
        const parsed = (await res.json()) as { code?: string; message?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.message) message = parsed.message;
      } catch {
        // non-JSON error body; keep the defaults
      }
      throw new ApiError(res.status, code, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getConsentUrl: () => request('GET', '/auth/google'),
    listTasks: (status) => request('GET', `/tasks${status ? `?${new URLSearchParams({ status }).toString()}` : ''}`),
    createTask: (body) => request('POST', '/tasks', body),
    updateTask: (id, patch) => request('PATCH', `/tasks/${id}`, patch),
    deleteTask: (id) => request('DELETE', `/tasks/${id}`),
    listHabits: () => request('GET', '/habits'),
    createHabit: (body) => request('POST', '/habits', body),
    updateHabit: (id, patch) => request('PATCH', `/habits/${id}`, patch),
    deleteHabit: (id) => request('DELETE', `/habits/${id}`),
    getSettings: () => request('GET', '/settings'),
    putSettings: (body) => request('PUT', '/settings', body),
    getSchedule: (from, to) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      return request('GET', `/schedule${qs ? `?${qs}` : ''}`);
    },
    getSchedulePreview: () => request('GET', '/schedule/preview'),
    replan: () => request('POST', '/schedule/replan'),
  };
}
