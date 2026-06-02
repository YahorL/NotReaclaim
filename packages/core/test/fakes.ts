import type {
  Settings, CalendarEvent, Task, Habit, ScheduledBlock, Category,
} from '@notreclaim/db';
import type { SchedulingRepositories } from '../src/assemble.js';

export interface FakeData {
  settings?: Settings | null;
  events?: CalendarEvent[];
  blocks?: ScheduledBlock[];
  tasks?: Task[];
  habits?: Habit[];
  categories?: Category[];
}

export function fakeRepos(data: FakeData): SchedulingRepositories {
  return {
    settings: { getByUserId: async () => data.settings ?? null },
    calendarEvents: { listByUserInRange: async () => data.events ?? [] },
    tasks: { listByUser: async () => data.tasks ?? [] },
    habits: { listByUser: async () => data.habits ?? [] },
    scheduledBlocks: { listByUserInRange: async () => data.blocks ?? [] },
    categories: { listByUser: async () => data.categories ?? [] },
  };
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    id: 's1',
    userId: 'u1',
    timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
    horizonDays: 7,
    defaultMinChunkMs: 900000,
    defaultMaxChunkMs: 1800000,
    meetingBufferMs: 0,
    taskBufferMs: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    userId: 'u1',
    title: 'Task',
    priority: 1,
    durationMs: 1800000,
    dueBy: new Date('2026-01-09T17:00:00.000Z'),
    minChunkMs: 900000,
    maxChunkMs: 1800000,
    notBefore: null,
    categoryId: null,
    status: 'pending',
    timeLoggedMs: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    userId: 'u1',
    title: 'Habit',
    priority: 2,
    chunkMs: 1800000,
    perPeriod: 3,
    periodType: 'week',
    preferredStartMinute: null,
    preferredEndMinute: null,
    eligibleDays: [1, 3, 5],
    status: 'active',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    userId: 'u1',
    googleCalendarId: 'primary',
    googleEventId: 'g1',
    title: 'Meeting',
    startsAt: new Date('2026-01-05T10:00:00.000Z'),
    endsAt: new Date('2026-01-05T11:00:00.000Z'),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-default',
    userId: 'u1',
    name: 'Working Hours',
    windows: null,
    isDefault: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function makeBlock(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1',
    userId: 'u1',
    taskId: 't1',
    habitId: null,
    title: 'Focus',
    startsAt: new Date('2026-01-05T12:00:00.000Z'),
    endsAt: new Date('2026-01-05T12:30:00.000Z'),
    pinned: false,
    googleEventId: null,
    googleCalendarId: null,
    engineKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}
