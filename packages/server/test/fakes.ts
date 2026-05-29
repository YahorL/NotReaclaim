import type { Settings, Task, Habit, ScheduledBlock, User } from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import { buildApp, type AppDeps } from '../src/app.js';

const FIXED_NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

export function fakeTaskRepo(seed: Task[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: Record<string, unknown>): Task => ({
    id: `task-${++n}`, userId, title: '', priority: 1, durationMs: 0,
    dueBy: new Date(0), minChunkMs: 0, maxChunkMs: 0, category: null,
    status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
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
        defaultMinChunkMs: 0, defaultMaxChunkMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
        ...data,
      } as Settings;
      return row;
    },
  };
}

export function fakeScheduledBlockRepo(seed: ScheduledBlock[] = []) {
  return {
    async listByUserInRange(userId: string): Promise<ScheduledBlock[]> {
      return seed.filter((b) => b.userId === userId);
    },
  };
}

export interface TestAppOptions {
  tasks?: Task[];
  habits?: Habit[];
  settings?: Settings | null;
  blocks?: ScheduledBlock[];
  connectUser?: User;
  reconcileResult?: AppDeps['reconcile'] extends (...a: never[]) => Promise<infer R> ? R : never;
  schedulingReposOverride?: SchedulingRepositories;
}

export function buildTestApp(opts: TestAppOptions = {}) {
  const tasks = fakeTaskRepo(opts.tasks ?? []);
  const habits = fakeHabitRepo(opts.habits ?? []);
  const settings = fakeSettingsRepo(opts.settings ?? null);
  const scheduledBlocks = fakeScheduledBlockRepo(opts.blocks ?? []);
  const reconcileCalls: Array<{ userId: string; now: number }> = [];

  const schedulingRepos: SchedulingRepositories = opts.schedulingReposOverride ?? {
    settings,
    calendarEvents: { listByUserInRange: async () => [] },
    tasks,
    habits,
    scheduledBlocks,
  };

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: {
      client: { getConsentUrl: () => 'https://consent.example/auth' },
      tokens: {
        connectFromCode: async () =>
          opts.connectUser ?? ({
            id: 'u1', email: 'a@example.com', googleId: 'g-1', googleRefreshToken: 'enc',
            autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0),
          } as User),
      },
    },
    schedulingRepos,
    reconcile: async (userId, now) => {
      reconcileCalls.push({ userId, now });
      return opts.reconcileResult ?? { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 };
    },
    config: { jwtSecret: 'test-secret', googleRedirectUri: 'http://localhost:3000/auth/google/callback' },
    now: () => FIXED_NOW,
  });

  return { app, tasks, habits, settings, reconcileCalls, FIXED_NOW };
}

export async function tokenFor(app: Awaited<ReturnType<typeof buildTestApp>>['app'], userId = 'u1'): Promise<string> {
  await app.ready();
  return app.jwt.sign({ sub: userId });
}
