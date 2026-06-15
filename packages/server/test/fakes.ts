import type { Settings, Task, Habit, ScheduledBlock, CalendarEvent, User, Category, Subtask } from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import { buildApp, type AppDeps } from '../src/app.js';
import { createEventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';

const FIXED_NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

export function fakeTaskRepo(seed: Task[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Task => ({
    id: `task-${++n}`, userId, title: '', priority: 1, sortOrder: 0, durationMs: 0,
    dueBy: new Date(0), minChunkMs: 0, maxChunkMs: 0, categoryId: null, notBefore: null,
    status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
    subtasks: [],
    ...data,
  }) as Task;
  return {
    async create(userId: string, data: Record<string, unknown>): Promise<Task> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<Task | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string, opts: { status?: string } = {}): Promise<Task[]> {
      return rows.filter((r) => r.userId === userId && (!opts.status || r.status === opts.status));
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Task> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${id}`); }
    },
    async purgeCompletedBefore(userId: string, cutoff: Date): Promise<number> {
      const before = rows.length;
      rows = rows.filter((r) => !(
        r.userId === userId &&
        r.status === 'completed' &&
        r.completedAt != null &&
        r.completedAt < cutoff
      ));
      return before - rows.length;
    },
  };
}

export function fakeHabitRepo(seed: Habit[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Habit => ({
    id: `habit-${++n}`, userId, title: '', priority: 1, chunkMs: 0, perPeriod: 1,
    periodType: 'week', preferredStartMinute: null, preferredEndMinute: null,
    eligibleDays: [], status: 'active', createdAt: new Date(0), updatedAt: new Date(0),
    ...data,
  }) as Habit;
  return {
    async create(userId: string, data: Record<string, unknown>): Promise<Habit> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<Habit | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string): Promise<Habit[]> {
      return rows.filter((r) => r.userId === userId);
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Habit> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Habit ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Habit ${id}`); }
    },
  };
}

export function fakeSettingsRepo(seed: Settings | null = null) {
  let row = seed;
  return {
    async getByUserId(userId: string): Promise<Settings | null> {
      return row && row.userId === userId ? row : null;
    },
    async upsert(userId: string, data: Record<string, unknown>): Promise<Settings> {
      row = {
        id: 'settings-1', userId, timezone: 'utc', workingHours: [], horizonDays: 14,
        defaultMinChunkMs: 0, defaultMaxChunkMs: 0, meetingBufferMs: 0, taskBufferMs: 0,
        requireStartToTrack: false,
        createdAt: new Date(0), updatedAt: new Date(0),
        ...data,
      } as Settings;
      return row;
    },
  };
}

export function fakeScheduledBlockRepo(seed: ScheduledBlock[] = []) {
  let rows = [...seed];
  return {
    async listByUserInRange(userId: string, start: Date, end: Date): Promise<ScheduledBlock[]> {
      return rows.filter((b) => b.userId === userId && b.startsAt < end && b.endsAt > start);
    },
    async findById(userId: string, id: string): Promise<ScheduledBlock | null> {
      return rows.find((b) => b.id === id && b.userId === userId) ?? null;
    },
    async create(userId: string, data: Record<string, unknown>): Promise<ScheduledBlock> {
      const row = {
        id: `block-${rows.length + 1}`, userId, taskId: null, habitId: null, title: '',
        pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0), ...data,
      } as ScheduledBlock;
      rows.push(row); return row;
    },
    async update(userId: string, id: string, data: Partial<ScheduledBlock>): Promise<ScheduledBlock> {
      const row = rows.find((b) => b.id === id && b.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`ScheduledBlock ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((b) => !(b.id === id && b.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`ScheduledBlock ${id}`); }
    },
  };
}

export function fakeCalendarEventRepo(seed: CalendarEvent[] = []) {
  let rows = [...seed];
  let n = seed.length;
  return {
    async listByUserInRange(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
      return rows.filter(
        (e) => e.userId === userId && e.startsAt < end && e.endsAt > start,
      );
    },
    async create(userId: string, data: Record<string, unknown>): Promise<CalendarEvent> {
      const row: CalendarEvent = {
        id: `cal-${++n}`, userId, googleCalendarId: null, googleEventId: null,
        title: '', startsAt: new Date(0), endsAt: new Date(0),
        createdAt: new Date(0), updatedAt: new Date(0),
        ...data,
      } as CalendarEvent;
      rows.push(row);
      return row;
    },
    async setGoogleIds(userId: string, id: string, googleCalendarId: string, googleEventId: string): Promise<CalendarEvent> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`CalendarEvent ${id}`); }
      Object.assign(row, { googleCalendarId, googleEventId });
      return row;
    },
    async findById(userId: string, id: string): Promise<CalendarEvent | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`CalendarEvent ${id}`); }
    },
  };
}

export function fakeCategoryRepo(seed: Category[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Category => ({
    id: `cat-${++n}`, userId, name: '', windows: null, color: null, isDefault: false,
    createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Category;
  return {
    async listByUser(userId: string): Promise<Category[]> {
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    },
    async getDefault(userId: string): Promise<Category | null> {
      return rows.find((r) => r.userId === userId && r.isDefault) ?? null;
    },
    async ensureDefault(userId: string): Promise<Category> {
      const found = rows.find((r) => r.userId === userId && r.isDefault);
      if (found) return found;
      const row = make(userId, { name: 'Working Hours', windows: null, isDefault: true });
      rows.push(row); return row;
    },
    async create(userId: string, data: Record<string, unknown>): Promise<Category> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Category> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Category ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Category ${id}`); }
      if (row.isDefault) { const { ConflictError } = await import('@notreclaim/db'); throw new ConflictError('The default category cannot be deleted'); }
      rows = rows.filter((r) => r.id !== id);
    },
  };
}

export function fakeSubtaskRepo(seed: Subtask[] = [], taskRepo: { findById(userId: string, id: string): Promise<Task | null> }) {
  let rows = [...seed];
  let n = seed.length;
  const make = (taskId: string, data: Record<string, unknown>): Subtask => ({
    id: `sub-${++n}`, taskId, title: '', done: false, sortOrder: 0, createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Subtask;
  const owned = async (userId: string, id: string): Promise<Subtask | null> => {
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return (await taskRepo.findById(userId, row.taskId)) ? row : null;
  };
  return {
    async create(userId: string, taskId: string, data: Record<string, unknown>): Promise<Subtask> {
      if (!(await taskRepo.findById(userId, taskId))) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Task ${taskId}`); }
      const taskSubtasks = rows.filter((r) => r.taskId === taskId);
      const maxOrder = taskSubtasks.reduce((m, r) => Math.max(m, r.sortOrder), 0);
      const sortOrder = maxOrder + 1;
      const row = make(taskId, { sortOrder, ...data }); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: Record<string, unknown>): Promise<Subtask> {
      const row = await owned(userId, id);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Subtask ${id}`); }
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = await owned(userId, id);
      if (!row) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`Subtask ${id}`); }
      rows = rows.filter((r) => r.id !== id);
    },
  };
}

export interface TestAppOptions {
  tasks?: Task[];
  habits?: Habit[];
  settings?: Settings | null;
  blocks?: ScheduledBlock[];
  calendarEvents?: CalendarEvent[];
  categories?: Category[];
  subtasks?: Subtask[];
  connectUser?: User;
  reconcileResult?: AppDeps['reconcile'] extends (...a: never[]) => Promise<infer R> ? R : never;
  schedulingReposOverride?: SchedulingRepositories;
  webClientUrl?: string;
  accessToken?: string;
  insertEvent?: AppDeps['google']['client']['insertEvent'];
  deleteEvent?: AppDeps['google']['client']['deleteEvent'];
}

export function buildTestApp(opts: TestAppOptions = {}) {
  const tasks = fakeTaskRepo(opts.tasks ?? []);
  const subtasks = fakeSubtaskRepo(opts.subtasks ?? [], tasks);
  const habits = fakeHabitRepo(opts.habits ?? []);
  const settings = fakeSettingsRepo(opts.settings ?? null);
  const scheduledBlocks = fakeScheduledBlockRepo(opts.blocks ?? []);
  const calendarEvents = fakeCalendarEventRepo(opts.calendarEvents ?? []);
  const categories = fakeCategoryRepo(opts.categories ?? []);
  const reconcileCalls: Array<{ userId: string; now: number }> = [];

  const events = createEventBus();
  const emitted: ServerEvent[] = [];
  events.subscribe((e) => emitted.push(e));

  const schedulingRepos: SchedulingRepositories = opts.schedulingReposOverride ?? {
    settings,
    calendarEvents,
    tasks,
    habits,
    scheduledBlocks,
    categories,
  };

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks, calendarEvents, categories, subtasks },
    google: {
      client: {
        getConsentUrl: () => 'https://consent.example/auth',
        insertEvent: opts.insertEvent ?? (async () => { throw new Error('not connected'); }),
        deleteEvent: opts.deleteEvent ?? (async () => { throw new Error('not connected'); }),
      },
      tokens: {
        connectFromCode: async () =>
          opts.connectUser ?? ({
            id: 'u1', email: 'a@example.com', googleId: 'g-1', googleRefreshToken: 'enc',
            autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0),
          } as User),
        getAccessToken: async () => {
          if (!opts.accessToken) throw new Error('not connected');
          return opts.accessToken;
        },
      },
    },
    schedulingRepos,
    reconcile: async (userId, now) => {
      reconcileCalls.push({ userId, now });
      return opts.reconcileResult ?? { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 };
    },
    events,
    config: { jwtSecret: 'test-secret', googleRedirectUri: 'http://localhost:3000/auth/google/callback', webClientUrl: opts.webClientUrl },
    now: () => FIXED_NOW,
  });

  return { app, tasks, subtasks, habits, settings, categories, reconcileCalls, emitted, events, FIXED_NOW };
}

export async function tokenFor(app: Awaited<ReturnType<typeof buildTestApp>>['app'], userId = 'u1'): Promise<string> {
  await app.ready();
  return app.jwt.sign({ sub: userId });
}
