export { prisma } from './client.js';
export type { PrismaClient } from './client.js';
export { getDatabaseUrl } from './config.js';
export { NotFoundError, ConflictError, translatePrismaError } from './errors.js';
export { toFixedEvent, toFlexibleTask, toScheduledBlock } from './mappers.js';

export { createUserRepository } from './repositories/user-repository.js';
export type { UserRepository, CreateUserInput, UpdateUserInput } from './repositories/user-repository.js';
export { createSettingsRepository } from './repositories/settings-repository.js';
export type { SettingsRepository, UpsertSettingsInput } from './repositories/settings-repository.js';
export { createCalendarEventRepository } from './repositories/calendar-event-repository.js';
export type { CalendarEventRepository, UpsertCalendarEventInput } from './repositories/calendar-event-repository.js';
export { createTaskRepository } from './repositories/task-repository.js';
export type { TaskRepository, CreateTaskInput, UpdateTaskInput } from './repositories/task-repository.js';
export { createHabitRepository } from './repositories/habit-repository.js';
export type { HabitRepository, CreateHabitInput, UpdateHabitInput } from './repositories/habit-repository.js';
export { createScheduledBlockRepository } from './repositories/scheduled-block-repository.js';
export type { ScheduledBlockRepository, CreateScheduledBlockInput } from './repositories/scheduled-block-repository.js';

// Re-export Prisma model types and enums so consumers can type rows without
// importing the Prisma client runtime.
export type {
  User,
  Settings,
  CalendarEvent,
  Task,
  Habit,
  ScheduledBlock,
  TaskStatus,
  HabitStatus,
  HabitPeriod,
  Prisma,
} from '@prisma/client';
