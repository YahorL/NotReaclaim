import { z } from 'zod';

export const idParamSchema = z.object({ id: z.string().min(1) });

export const authCallbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().optional() });
export const consentQuerySchema = z.object({ invite: z.string().min(1).optional() });

export const createTaskSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  durationMs: z.number().int().positive(),
  dueBy: z.string().datetime(),
  minChunkMs: z.number().int().positive(),
  maxChunkMs: z.number().int().positive(),
  categoryId: z.string().nullable().optional(),
  notBefore: z.string().datetime().nullable().optional(),
  sortOrder: z.number().optional(),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived', 'backlog']).optional(),
  timeLoggedMs: z.number().int().nonnegative().optional(),
});
export const listTasksQuerySchema = z.object({
  status: z.enum(['pending', 'scheduled', 'completed', 'archived', 'backlog']).optional(),
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
  meetingBufferMs: z.number().int().nonnegative().optional(),
  taskBufferMs: z.number().int().nonnegative().optional(),
  requireStartToTrack: z.boolean().optional(),
});

export const workingHourEntrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
}).refine((w) => w.startMinute < w.endMinute, { message: 'startMinute must be before endMinute' });

export const createCategorySchema = z.object({
  name: z.string().min(1),
  windows: z.array(workingHourEntrySchema).min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  windows: z.array(workingHourEntrySchema).min(1).nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
}).refine(
  (b) => b.name !== undefined || b.windows !== undefined || b.color !== undefined,
  { message: 'name, windows, or color is required' },
);

export const createSubtaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
});
export const updateSubtaskSchema = z.object({
  title: z.string().min(1).optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().optional(),
}).refine(
  (b) => b.title !== undefined || b.done !== undefined || b.sortOrder !== undefined,
  { message: 'title, done, or sortOrder is required' },
);

export const rangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const createCalendarEventSchema = z
  .object({ title: z.string().min(1), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((b) => Date.parse(b.startsAt) < Date.parse(b.endsAt), { message: 'startsAt must be before endsAt' });

export const createScheduledBlockSchema = z
  .object({ taskId: z.string().min(1), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((b) => Date.parse(b.startsAt) < Date.parse(b.endsAt), { message: 'startsAt must be before endsAt' });

export const updateScheduledBlockSchema = z
  .object({
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((b) => !(b.startsAt && b.endsAt) || Date.parse(b.startsAt) < Date.parse(b.endsAt), {
    message: 'startsAt must be before endsAt',
  });

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  inviteCode: z.string().min(1).optional(),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const setPasswordSchema = z.object({ password: z.string().min(10) });
export const changeEmailSchema = z.object({ email: z.string().email() });
