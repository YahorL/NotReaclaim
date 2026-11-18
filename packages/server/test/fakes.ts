import { NotFoundError, ConflictError } from '@notreclaim/db';
import type {
  Settings, Task, TaskWithSubtasks, Habit, ScheduledBlock, CalendarEvent, User, Category, Subtask, TaskStatus,
  CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, UpsertSettingsInput,
  CreateScheduledBlockInput, UpdateScheduledBlockInput, CreateCalendarEventInput, UpdateCalendarEventInput,
  CreateCategoryInput, UpdateCategoryInput, CreateSubtaskInput, UpdateSubtaskInput,
} from '@notreclaim/db';
import { buildApp, type AppDeps } from '../src/app.js';
import { createEventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';

const FIXED_NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

export function fakeTaskRepo(seed: Task[] = []) {
  // Like the real repository, every row carries its subtasks.
  let rows: TaskWithSubtasks[] = seed.map((t) => ({ subtasks: [], ...t }));
  let n = seed.length;
  const make = (userId: string, data: CreateTaskInput): TaskWithSubtasks => ({
    id: `task-${++n}`, userId, sortOrder: 0,
    dueBy: new Date(0), categoryId: null, notBefore: null,
    status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
    subtasks: [],
    ...data,
  });
  return {
    async create(userId: string, data: CreateTaskInput): Promise<Task> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<TaskWithSubtasks | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string, opts: { status?: TaskStatus } = {}): Promise<TaskWithSubtasks[]> {
      return rows.filter((r) => r.userId === userId && (!opts.status || r.status === opts.status));
    },
    async update(userId: string, id: string, data: UpdateTaskInput): Promise<Task> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`Task ${id}`);
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) throw new NotFoundError(`Task ${id}`);
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
  const make = (userId: string, data: CreateHabitInput): Habit => ({
    id: `habit-${++n}`, userId,
    periodType: 'week', preferredStartMinute: null, preferredEndMinute: null,
    status: 'active', createdAt: new Date(0), updatedAt: new Date(0),
    ...data,
  }) as Habit;
  return {
    async create(userId: string, data: CreateHabitInput): Promise<Habit> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async findById(userId: string, id: string): Promise<Habit | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async listByUser(userId: string): Promise<Habit[]> {
      return rows.filter((r) => r.userId === userId);
    },
    async update(userId: string, id: string, data: UpdateHabitInput): Promise<Habit> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`Habit ${id}`);
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) throw new NotFoundError(`Habit ${id}`);
    },
  };
}

export function fakeSettingsRepo(seed: Settings | null = null) {
  let row = seed;
  return {
    async getByUserId(userId: string): Promise<Settings | null> {
      return row && row.userId === userId ? row : null;
    },
    async upsert(userId: string, data: UpsertSettingsInput): Promise<Settings> {
      row = {
        id: 'settings-1', userId, horizonDays: 14, meetingBufferMs: 0, taskBufferMs: 0,
        requireStartToTrack: false, dayStartMinute: 0,
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
    async create(userId: string, data: CreateScheduledBlockInput): Promise<ScheduledBlock> {
      const row = {
        id: `block-${rows.length + 1}`, userId, taskId: null, habitId: null,
        pinned: false, googleEventId: null, googleCalendarId: null, engineKey: null, startedAt: null,
        createdAt: new Date(0), updatedAt: new Date(0), ...data,
      } as ScheduledBlock;
      rows.push(row); return row;
    },
    async update(userId: string, id: string, data: UpdateScheduledBlockInput): Promise<ScheduledBlock> {
      const row = rows.find((b) => b.id === id && b.userId === userId);
      if (!row) throw new NotFoundError(`ScheduledBlock ${id}`);
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((b) => !(b.id === id && b.userId === userId));
      if (rows.length === before) throw new NotFoundError(`ScheduledBlock ${id}`);
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
    async create(userId: string, data: CreateCalendarEventInput): Promise<CalendarEvent> {
      const row: CalendarEvent = {
        id: `cal-${++n}`, userId, googleCalendarId: null, googleEventId: null,
        source: 'app', kind: 'event',
        createdAt: new Date(0), updatedAt: new Date(0),
        ...data,
      };
      rows.push(row);
      return row;
    },
    async update(userId: string, id: string, data: UpdateCalendarEventInput): Promise<CalendarEvent> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`CalendarEvent ${id}`);
      Object.assign(row, data);
      return row;
    },
    async setGoogleIds(userId: string, id: string, googleCalendarId: string, googleEventId: string): Promise<CalendarEvent> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`CalendarEvent ${id}`);
      Object.assign(row, { googleCalendarId, googleEventId });
      return row;
    },
    async findById(userId: string, id: string): Promise<CalendarEvent | null> {
      return rows.find((r) => r.id === id && r.userId === userId) ?? null;
    },
    async delete(userId: string, id: string): Promise<void> {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.userId === userId));
      if (rows.length === before) throw new NotFoundError(`CalendarEvent ${id}`);
    },
  };
}

export function fakeCategoryRepo(seed: Category[] = []) {
  let rows = [...seed];
  let n = seed.length;
  const make = (userId: string, data: CreateCategoryInput | Pick<Category, 'name' | 'windows' | 'isDefault'>): Category => ({
    id: `cat-${++n}`, userId, color: null, isDefault: false,
    createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Category;
  return {
    async listByUser(userId: string): Promise<Category[]> {
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    },
    async ensureDefault(userId: string): Promise<Category> {
      const found = rows.find((r) => r.userId === userId && r.isDefault);
      if (found) return found;
      const row = make(userId, { name: 'Working Hours', windows: null, isDefault: true });
      rows.push(row); return row;
    },
    async create(userId: string, data: CreateCategoryInput): Promise<Category> {
      const row = make(userId, data); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: UpdateCategoryInput): Promise<Category> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`Category ${id}`);
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) throw new NotFoundError(`Category ${id}`);
      if (row.isDefault) throw new ConflictError('The default category cannot be deleted');
      rows = rows.filter((r) => r.id !== id);
    },
  };
}

export function fakeSubtaskRepo(seed: Subtask[] = [], taskRepo: { findById(userId: string, id: string): Promise<Task | null> }) {
  let rows = [...seed];
  let n = seed.length;
  const make = (taskId: string, data: CreateSubtaskInput & { sortOrder: number }): Subtask => ({
    id: `sub-${++n}`, taskId, done: false, createdAt: new Date(0), updatedAt: new Date(0), ...data,
  }) as Subtask;
  const owned = async (userId: string, id: string): Promise<Subtask | null> => {
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return (await taskRepo.findById(userId, row.taskId)) ? row : null;
  };
  return {
    async create(userId: string, taskId: string, data: CreateSubtaskInput): Promise<Subtask> {
      if (!(await taskRepo.findById(userId, taskId))) throw new NotFoundError(`Task ${taskId}`);
      const taskSubtasks = rows.filter((r) => r.taskId === taskId);
      const maxOrder = taskSubtasks.reduce((m, r) => Math.max(m, r.sortOrder), 0);
      const sortOrder = maxOrder + 1;
      const row = make(taskId, { sortOrder, ...data }); rows.push(row); return row;
    },
    async update(userId: string, id: string, data: UpdateSubtaskInput): Promise<Subtask> {
      const row = await owned(userId, id);
      if (!row) throw new NotFoundError(`Subtask ${id}`);
      Object.assign(row, data); return row;
    },
    async delete(userId: string, id: string): Promise<void> {
      const row = await owned(userId, id);
      if (!row) throw new NotFoundError(`Subtask ${id}`);
      rows = rows.filter((r) => r.id !== id);
    },
  };
}

export function fakeUserRepo(seed: User[] = []) {
  const byId = new Map<string, User>(seed.map((u) => [u.id, u]));
  let n = seed.length;
  const make = (data: Partial<User>): User => ({
    id: `u${++n}`, email: '', passwordHash: null, isAdmin: false, googleId: null,
    googleRefreshToken: null, googleAuthBrokenAt: null, autoScheduledCalendarId: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...data,
  } as User);
  return {
    async findById(id: string) { return byId.get(id) ?? null; },
    async findByEmail(email: string) { return [...byId.values()].find((u) => u.email === email) ?? null; },
    async findByGoogleId(googleId: string) { return [...byId.values()].find((u) => u.googleId === googleId) ?? null; },
    async create(data: Partial<User>) { const u = make(data); byId.set(u.id, u); return u; },
    // Copy-on-write like Prisma: a row already handed out must NOT change under its holder,
    // or stale-snapshot races become invisible in tests.
    async update(id: string, data: Partial<User>) {
      const u = byId.get(id); if (!u) throw new NotFoundError(`User ${id}`);
      const updated = { ...u, ...data }; byId.set(id, updated); return updated;
    },
    /** Mirrors the repository's conditional updateMany: false when the flag doesn't flip. */
    async setGoogleAuthBroken(id: string, at: Date | null) {
      const u = byId.get(id);
      if (!u) return false;
      const isBroken = u.googleAuthBrokenAt != null;
      if (at === null ? !isBroken : isBroken) return false;
      byId.set(id, { ...u, googleAuthBrokenAt: at });
      return true;
    },
  };
}

export function fakeInviteRepo(opts: { valid?: Set<string> } = {}) {
  const consumed: string[] = [];
  const valid = opts.valid ?? new Set<string>();
  return {
    async tryConsume(code: string) {
      if (!valid.has(code)) return false;
      valid.delete(code); consumed.push(code); return true;
    },
    consumed,
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
  reconcileResult?: AppDeps['reconcile'] extends (...a: never[]) => Promise<infer R> ? R : never;
  /** When set, every reconcile call records itself and then throws this. */
  reconcileError?: unknown;
  webClientUrl?: string;
  accessToken?: string;
  /** Full override of the token lookup — lets a test assert it was never even attempted. */
  getAccessToken?: AppDeps['google']['tokens']['getAccessToken'];
  insertEvent?: AppDeps['google']['client']['insertEvent'];
  deleteEvent?: AppDeps['google']['client']['deleteEvent'];
  patchEvent?: AppDeps['google']['client']['patchEvent'];
  users?: User[];
  registrationMode?: 'closed' | 'invite' | 'open';
  validInvites?: string[];
  googleEmailVerified?: boolean;
  /** Awaited on every OAuth code exchange — lets a test hold two link callbacks in flight. */
  exchangeGate?: () => Promise<void>;
}

export function buildTestApp(opts: TestAppOptions = {}) {
  const tasks = fakeTaskRepo(opts.tasks ?? []);
  const subtasks = fakeSubtaskRepo(opts.subtasks ?? [], tasks);
  const habits = fakeHabitRepo(opts.habits ?? []);
  const settings = fakeSettingsRepo(opts.settings ?? null);
  const scheduledBlocks = fakeScheduledBlockRepo(opts.blocks ?? []);
  const calendarEvents = fakeCalendarEventRepo(opts.calendarEvents ?? []);
  const categories = fakeCategoryRepo(opts.categories ?? []);
  const users = fakeUserRepo(opts.users ?? [{
    id: 'u1', email: 'a@example.com', passwordHash: null, isAdmin: false, googleId: 'g-1',
    googleRefreshToken: 'enc', googleAuthBrokenAt: null, autoScheduledCalendarId: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  } as User]);
  const invites = fakeInviteRepo({ valid: new Set(opts.validInvites ?? []) });
  const reconcileCalls: Array<{ userId: string; now: number }> = [];

  const events = createEventBus();
  const emitted: ServerEvent[] = [];
  events.subscribe((e) => emitted.push(e));

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks, calendarEvents, categories, subtasks, users, invites },
    google: {
      client: {
        getConsentUrl: () => 'https://consent.example/auth',
        insertEvent: opts.insertEvent ?? (async () => { throw new Error('not connected'); }),
        deleteEvent: opts.deleteEvent ?? (async () => { throw new Error('not connected'); }),
        patchEvent: opts.patchEvent ?? (async () => { throw new Error('not connected'); }),
      },
      tokens: {
        exchangeCodeForLink: async () => {
          if (opts.exchangeGate) await opts.exchangeGate();
          return { email: 'a@example.com', emailVerified: opts.googleEmailVerified ?? true, googleUserId: 'g-1', encryptedRefreshToken: 'enc' };
        },
        getAccessToken: opts.getAccessToken ?? (async () => {
          if (!opts.accessToken) throw new Error('not connected');
          return opts.accessToken;
        }),
      },
    },
    reconcile: async (userId, now) => {
      reconcileCalls.push({ userId, now });
      if (opts.reconcileError !== undefined) throw opts.reconcileError;
      return opts.reconcileResult ?? { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0, pinnedSynced: 0, pinnedFailed: 0 };
    },
    events,
    config: { jwtSecret: 'test-secret', googleRedirectUri: 'http://localhost:3000/auth/google/callback', webClientUrl: opts.webClientUrl, registrationMode: opts.registrationMode ?? 'open' },
    now: () => FIXED_NOW,
  });

  return { app, settings, categories, users, invites, reconcileCalls, emitted, events, FIXED_NOW };
}

export async function tokenFor(app: Awaited<ReturnType<typeof buildTestApp>>['app'], userId = 'u1'): Promise<string> {
  await app.ready();
  return app.jwt.sign({ sub: userId });
}
