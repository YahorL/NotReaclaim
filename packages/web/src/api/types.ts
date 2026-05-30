export type TaskStatus = 'pending' | 'scheduled' | 'completed' | 'archived';
export type HabitStatus = 'active' | 'paused';

export interface Task {
  id: string;
  userId: string;
  title: string;
  priority: number;
  durationMs: number;
  dueBy: string;
  minChunkMs: number;
  maxChunkMs: number;
  category: string | null;
  status: TaskStatus;
  timeLoggedMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  priority: number;
  chunkMs: number;
  perPeriod: number;
  periodType: 'week';
  preferredStartMinute: number | null;
  preferredEndMinute: number | null;
  eligibleDays: number[];
  status: HabitStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHour {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Settings {
  id: string;
  userId: string;
  timezone: string;
  workingHours: WorkingHour[];
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledBlock {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  taskId: string | null;
  habitId: string | null;
  pinned: boolean;
  engineKey: string | null;
}

export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
}

export interface SchedulePreview {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledItem[];
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  pinned: number;
  removed: number;
}

export interface CreateTaskInput {
  title: string;
  priority: number;
  durationMs: number;
  dueBy: string;
  minChunkMs: number;
  maxChunkMs: number;
  category?: string | null;
}
export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: TaskStatus; timeLoggedMs?: number };

export interface CreateHabitInput {
  title: string;
  priority: number;
  chunkMs: number;
  perPeriod: number;
  eligibleDays: number[];
  periodType?: 'week';
  preferredStartMinute?: number | null;
  preferredEndMinute?: number | null;
}
export type UpdateHabitInput = Partial<CreateHabitInput> & { status?: HabitStatus };

export interface SettingsInput {
  timezone: string;
  workingHours: WorkingHour[];
  horizonDays?: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
}
