import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().min(1) });

export const authCallbackQuerySchema = z.object({ code: z.string().min(1) });

export const createTaskSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  durationMs: z.number().int().positive(),
  dueBy: z.string().datetime(),
  minChunkMs: z.number().int().positive(),
  maxChunkMs: z.number().int().positive(),
  category: z.string().nullable().optional(),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived']).optional(),
  timeLoggedMs: z.number().int().nonnegative().optional(),
});
export const listTasksQuerySchema = z.object({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived']).optional(),
});

export const createHabitSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  chunkMs: z.number().int().positive(),
  perPeriod: z.number().int().positive(),
  eligibleDays: z.array(z.number().int().min(0).max(6)),
  periodType: z.enum(['week']).optional(),
  preferredStartMinute: z.number().int().nullable().optional(),
  preferredEndMinute: z.number().int().nullable().optional(),
});
export const updateHabitSchema = createHabitSchema.partial().extend({
  status: z.enum(['active', 'paused']).optional(),
});

export const settingsSchema = z.object({
  timezone: z.string().min(1),
  workingHours: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMinute: z.number().int(),
      endMinute: z.number().int(),
    }),
  ),
  horizonDays: z.number().int().positive().optional(),
  defaultMinChunkMs: z.number().int().positive(),
  defaultMaxChunkMs: z.number().int().positive(),
});

export const rangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
