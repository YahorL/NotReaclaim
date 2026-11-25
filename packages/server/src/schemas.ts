import { z } from 'zod';
import { isValidTimezone } from '@notreclaim/core';

export const idParamSchema = z.object({ id: z.string().min(1) });

const taskStatusSchema = z.enum(['pending', 'scheduled', 'completed', 'archived', 'backlog']);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional();

// Shared by the range refines below. Only the comparison and message are shared: the create
// schemas compare unconditionally (zod runs a refine on a dirty object, so e.g. `startsAt: ''`
// also reports the range issue there), while the block update compares only when both are set.
const startsBeforeEnds = (startsAt: string, endsAt: string) => Date.parse(startsAt) < Date.parse(endsAt);
const START_BEFORE_END = { message: 'startsAt must be before endsAt' };

export const authCallbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().optional() });
export const consentQuerySchema = z.object({ invite: z.string().min(1).optional() });

// Shared by the chunk-order refines below and the PATCH /tasks merged check in task-routes.
// Messages on a field path read after the field name: the 400 body says "minChunkMs: must not…".
export const CHUNK_ORDER = { message: 'must not exceed maxChunkMs', path: ['minChunkMs'] };

const taskFieldsSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  durationMs: z.number().int().positive(),
  dueBy: z.string().datetime().nullable().optional(),
  minChunkMs: z.number().int().positive(),
  maxChunkMs: z.number().int().positive(),
  categoryId: z.string().nullable().optional(),
  notBefore: z.string().datetime().nullable().optional(),
  sortOrder: z.number().optional(),
});
export const createTaskSchema = taskFieldsSchema.refine((b) => b.minChunkMs <= b.maxChunkMs, CHUNK_ORDER);
// Partial: chunk order is checked in the route against the stored row, and only when the
// patch touches min or max, so rows that already conflict stay editable.
export const updateTaskSchema = taskFieldsSchema.partial().extend({
  status: taskStatusSchema.optional(),
});
export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
});

// A minute of the local day, 00:00..24:00 inclusive (1440 = end of day, as for working hours).
const minuteOfDaySchema = z.number().int().min(0).max(1440);

// Shared by the create refine below and the PATCH /habits merged check in habit-routes. Core
// has no overnight preferred windows: it silently drops one whose end is not after its start.
export const PREFERRED_ORDER = { message: 'must be after preferredStartMinute', path: ['preferredEndMinute'] };
export const preferredWindowInOrder = (start: number | null | undefined, end: number | null | undefined): boolean =>
  start == null || end == null || start < end;

const habitFieldsSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int(),
  chunkMs: z.number().int().positive(),
  perPeriod: z.number().int().positive(),
  eligibleDays: z.array(z.number().int().min(0).max(6)),
  periodType: z.enum(['week']).optional(),
  preferredStartMinute: minuteOfDaySchema.nullable().optional(),
  preferredEndMinute: minuteOfDaySchema.nullable().optional(),
});
export const createHabitSchema = habitFieldsSchema.refine(
  (b) => preferredWindowInOrder(b.preferredStartMinute, b.preferredEndMinute), PREFERRED_ORDER,
);
// Partial: window order is checked in the route against the stored row, and only when the
// patch touches a bound, so rows that already conflict stay editable.
export const updateHabitSchema = habitFieldsSchema.partial().extend({
  status: z.enum(['active', 'paused']).optional(),
});

/**
 * One weekly window, shared by settings working hours and category hours. The bounds and
 * start < end are not cosmetic: core turns an out-of-range minute into a time on a
 * neighbouring day and silently drops an empty/inverted window.
 */
export const workingHourEntrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
}).refine((w) => w.startMinute < w.endMinute, { message: 'startMinute must be before endMinute' });

// 0..24 h. Also keeps the value inside the 32-bit Int column (a larger one was a 500).
const bufferMsSchema = z.number().int().nonnegative().max(24 * 60 * 60_000, { message: 'must be at most 24 hours' });

const settingsFieldsSchema = z.object({
  timezone: z.string().refine(isValidTimezone, { message: 'must be a valid IANA time zone' }),
  // An empty week is allowed here (unlike category windows): it means "no working hours".
  workingHours: z.array(workingHourEntrySchema),
  horizonDays: z.number().int().positive().optional(),
  defaultMinChunkMs: z.number().int().positive(),
  defaultMaxChunkMs: z.number().int().positive(),
  meetingBufferMs: bufferMsSchema.optional(),
  taskBufferMs: bufferMsSchema.optional(),
  requireStartToTrack: z.boolean().optional(),
  /** Visual planner day boundary, minutes past local midnight (0 = midnight, 180 = 03:00). */
  dayStartMinute: z.number().int().min(0).max(1439).optional(),
});
// Shared by the PUT refine and the PATCH /settings merged check in settings-routes.
export const DEFAULT_CHUNK_ORDER = { message: 'must not exceed defaultMaxChunkMs', path: ['defaultMinChunkMs'] };
export const settingsSchema = settingsFieldsSchema.refine(
  (b) => b.defaultMinChunkMs <= b.defaultMaxChunkMs, DEFAULT_CHUNK_ORDER,
);
// PATCH: any subset, each field under the PUT rules. Chunk order is checked in the route against
// the stored row, and only when the patch touches min or max, so other edits are never blocked
// by a stored value that predates a rule (e.g. a legacy invalid time zone).
export const patchSettingsSchema = settingsFieldsSchema.partial().refine(
  (b) => Object.values(b).some((v) => v !== undefined), { message: 'empty update' },
);

export const createCategorySchema = z.object({
  name: z.string().min(1),
  windows: z.array(workingHourEntrySchema).min(1),
  color: hexColorSchema,
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  windows: z.array(workingHourEntrySchema).min(1).nullable().optional(),
  color: hexColorSchema,
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
  .object({
    title: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    // 'blocked' = local busy time (relax/personal): busy in the engine, never sent to Google.
    kind: z.enum(['event', 'blocked']).optional(),
  })
  .refine((b) => startsBeforeEnds(b.startsAt, b.endsAt), START_BEFORE_END);

export const updateCalendarEventSchema = z
  .object({
    title: z.string().min(1).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .refine((b) => b.title !== undefined || b.startsAt !== undefined || b.endsAt !== undefined, {
    message: 'empty update',
  });

export const createScheduledBlockSchema = z
  .object({ taskId: z.string().min(1), startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((b) => startsBeforeEnds(b.startsAt, b.endsAt), START_BEFORE_END);

export const updateScheduledBlockSchema = z
  .object({
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((b) => !(b.startsAt && b.endsAt) || startsBeforeEnds(b.startsAt, b.endsAt), START_BEFORE_END);

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
