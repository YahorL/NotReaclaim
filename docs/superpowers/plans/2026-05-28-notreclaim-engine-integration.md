# NotReclaim Engine Integration Implementation Plan (Milestone 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@notreclaim/core` — the pure layer that turns persisted user data into an engine `ScheduleInput`, runs the scheduler, and returns the desired schedule — plus a hard `allowedWindows` extension to the engine.

**Architecture:** One additive, backward-compatible field on the engine's `Habit` (`allowedWindows`, a hard placement restriction). A new pure package `@notreclaim/core` with timezone-aware expansion (luxon), `ScheduleInput` assembly via injected repository interfaces, and a `computeDesiredSchedule` entry point. Everything is deterministic: an explicit `now` (epoch ms) is passed in, and all tests use in-memory repository fakes — no Postgres, no Google.

**Tech Stack:** TypeScript (ESM, strict, `.js` import extensions), luxon, Vitest, npm workspaces.

---

## Conventions & invariants

- Weekday convention is **Sunday = 0 … Saturday = 6** (JS `getDay()` style), for both `workingHours[].weekday` and `Habit.eligibleDays`. luxon uses Mon=1…Sun=7, so the mapping is `our = luxon.weekday % 7`.
- Habit `periods` are **ISO weeks (Monday start)** in the user's timezone (luxon `startOf('week')`).
- The horizon end is `now + horizonDays * 86_400_000` ms (a fixed cutoff); the *windows within* are computed per calendar day in the timezone, so DST is handled correctly.
- No `Date.now`, no `Math.random`. The only I/O is through injected repositories.

## File Structure

```
packages/scheduler/src/types.ts          # MODIFY: add Habit.allowedWindows
packages/scheduler/src/items.ts          # MODIFY: scheduleHabit honors allowedWindows
packages/scheduler/test/items.test.ts    # MODIFY: add allowedWindows tests
packages/db/src/index.ts                 # MODIFY: re-export Prisma model types
packages/db/package.json                 # MODIFY: add ./mappers subpath export
packages/core/
  package.json                           # @notreclaim/core
  tsconfig.json
  vitest.config.ts
  src/
    errors.ts                            # SettingsRequiredError, InvalidTimezoneError, InvalidHorizonError
    time-windows.ts                      # WorkingHourEntry, assertValidZone, expandWorkingWindows
    habit-expansion.ts                   # expandHabit
    bridge.ts                            # toScheduledBlockInput
    assemble.ts                          # SchedulingRepositories, assembleScheduleInput
    compute.ts                           # computeDesiredSchedule
    index.ts
  test/
    fakes.ts                             # in-memory repo fakes + model builders
    time-windows.test.ts
    habit-expansion.test.ts
    bridge.test.ts
    assemble.test.ts
    compute.test.ts
```

---

### Task 1: Engine extension — hard `allowedWindows`

**Files:**
- Modify: `packages/scheduler/src/types.ts`
- Modify: `packages/scheduler/src/items.ts`
- Modify: `packages/scheduler/test/items.test.ts`

- [ ] **Step 1: Add the failing tests.** Append to `packages/scheduler/test/items.test.ts` (the file already imports `scheduleHabit` and defines a `habit(over)` factory with `chunkMs: 30`, `perPeriod: 2`, `periods: [{ start: 0, end: 1000 }]`):

```ts
describe('scheduleHabit with allowedWindows (hard restriction)', () => {
  it('places within preferred ∩ allowed', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 100, end: 200 }],
      preferredWindows: [{ start: 150, end: 300 }],
    }));
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 150, end: 180 },
    ]);
  });

  it('falls back to allowed (not outside) when preferred does not fit', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 0, end: 200 }],
      preferredWindows: [{ start: 0, end: 20 }],
    }));
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
  });

  it('leaves an occurrence unscheduled rather than placing outside allowedWindows', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 1,
      allowedWindows: [{ start: 500, end: 520 }],
    }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]).toMatchObject({ sourceId: 'h1', remainingMs: 30 });
  });

  it('does not place a second occurrence outside the allowed window', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit({
      perPeriod: 2,
      allowedWindows: [{ start: 0, end: 40 }],
    }));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ start: 0, end: 30 });
    expect(result.unscheduled[0]).toMatchObject({ remainingMs: 30 });
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: FAIL — `allowedWindows` is not a known property (type error) / new tests fail.

- [ ] **Step 3: Add the field to `packages/scheduler/src/types.ts`.** Inside the `Habit` interface, after the `preferredWindows?` field, add:

```ts
  /**
   * Optional HARD restriction: placement is confined to these windows
   * (intersected with each period). Unlike preferredWindows, the engine never
   * places outside allowedWindows — an occurrence that cannot fit there is left
   * unscheduled. Omit for unrestricted placement (previous behavior).
   */
  allowedWindows?: Interval[];
```

- [ ] **Step 4: Update `scheduleHabit` in `packages/scheduler/src/items.ts`.** Replace the whole `scheduleHabit` function body's per-period block so it reads exactly:

```ts
export function scheduleHabit(free: Interval[], habit: Habit): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
  let missed = 0;
  let index = 0;

  for (const period of habit.periods) {
    const periodWindow: Interval[] = [period];
    const bound = habit.allowedWindows
      ? intersectIntervals(habit.allowedWindows, periodWindow)
      : periodWindow;
    const preferred = habit.preferredWindows
      ? intersectIntervals(habit.preferredWindows, bound)
      : undefined;

    for (let k = 0; k < habit.perPeriod; k++) {
      const primaryWindow = preferred && preferred.length > 0 ? preferred : bound;
      let res = placeItem(remainingFree, [habit.chunkMs], period.end, primaryWindow);
      if (res.placements.length === 0 && primaryWindow !== bound) {
        res = placeItem(remainingFree, [habit.chunkMs], period.end, bound);
      }

      if (res.placements.length === 0) {
        missed++;
        continue;
      }

      remainingFree = res.free;
      const p = res.placements[0]!;
      blocks.push({
        id: `habit:${habit.id}:${index}`,
        sourceType: 'habit',
        sourceId: habit.id,
        title: habit.title,
        start: p.start,
        end: p.end,
      });
      index++;
    }
  }

  const unscheduled: UnscheduledItem[] =
    missed > 0
      ? [
          {
            sourceType: 'habit',
            sourceId: habit.id,
            title: habit.title,
            reason: 'could not place all habit occurrences in free time',
            remainingMs: missed * habit.chunkMs,
          },
        ]
      : [];

  return { blocks, free: remainingFree, unscheduled };
}
```

(This generalizes the prior logic: when `allowedWindows` is omitted, `bound = periodWindow`, which is byte-for-byte the previous behavior.)

- [ ] **Step 5: Run scheduler tests to verify pass (old + new).**
Run: `cd packages/scheduler && npx vitest run`
Expected: PASS — all prior tests plus the 4 new `allowedWindows` tests (27 total).

- [ ] **Step 6: Rebuild the scheduler so downstream packages see the new field.**
Run: `cd packages/scheduler && npm run build`
Expected: compiles; `dist/index.d.ts` now includes `allowedWindows`.

- [ ] **Step 7: Commit.**

```bash
git add packages/scheduler/src/types.ts packages/scheduler/src/items.ts packages/scheduler/test/items.test.ts
git commit -m "feat(scheduler): add hard allowedWindows restriction to habits"
```

---

### Task 2: Prepare `@notreclaim/db` for consumption by core

`@notreclaim/core` needs db's pure mappers and model types *without* importing db's index (which instantiates `PrismaClient`). Add a `./mappers` subpath export and re-export the Prisma model types.

**Files:**
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add an `exports` map to `packages/db/package.json`.** Add this top-level key (keep the existing `main`/`types`):

```json
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./mappers": { "types": "./dist/mappers.d.ts", "default": "./dist/mappers.js" }
  },
```

- [ ] **Step 2: Re-export Prisma model types from `packages/db/src/index.ts`.** Append:

```ts
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
```

- [ ] **Step 3: Rebuild db and confirm db tests still pass.**
Run: `cd packages/db && npm run build && npx vitest run`
Expected: build clean; all 27 db tests still pass (the changes are additive).

- [ ] **Step 4: Commit.**

```bash
git add packages/db/package.json packages/db/src/index.ts
git commit -m "chore(db): expose ./mappers subpath and re-export model types"
```

---

### Task 3: Scaffold `@notreclaim/core`

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/errors.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@notreclaim/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@notreclaim/scheduler": "*",
    "@notreclaim/db": "*",
    "luxon": "^3.5.0"
  },
  "devDependencies": {
    "@types/luxon": "^3.4.2",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/core/src/errors.ts`**

```ts
/** No Settings row exists for the user; cannot build a schedule. */
export class SettingsRequiredError extends Error {
  constructor(userId: string) {
    super(`No settings found for user ${userId}`);
    this.name = 'SettingsRequiredError';
  }
}

/** The provided IANA timezone string is not valid. */
export class InvalidTimezoneError extends Error {
  constructor(timezone: string) {
    super(`Invalid timezone: ${timezone}`);
    this.name = 'InvalidTimezoneError';
  }
}

/** horizonDays must be a positive number. */
export class InvalidHorizonError extends Error {
  constructor(horizonDays: number) {
    super(`horizonDays must be > 0, got ${horizonDays}`);
    this.name = 'InvalidHorizonError';
  }
}
```

- [ ] **Step 5: Install deps and build prerequisite packages (so types resolve).**
Run: `npm install`
Then: `npm run build -w @notreclaim/scheduler && npm run build -w @notreclaim/db`
Expected: luxon installed; both dist outputs present (`packages/db/dist/mappers.d.ts` exists).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/errors.ts package-lock.json
git commit -m "chore(core): scaffold @notreclaim/core package"
```

---

### Task 4: `expandWorkingWindows`

**Files:**
- Create: `packages/core/src/time-windows.ts`
- Test: `packages/core/test/time-windows.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/time-windows.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { expandWorkingWindows } from '../src/time-windows.js';
import { InvalidTimezoneError, InvalidHorizonError } from '../src/errors.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('expandWorkingWindows', () => {
  it('emits a window per matching weekday within the horizon', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const windows = expandWorkingWindows(
      [{ weekday: 1, startMinute: 540, endMinute: 1020 }], // Monday 09:00-17:00
      'utc', now, 7,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T17:00:00') },
    ]);
  });

  it('clips the first window to now', () => {
    const now = utc('2026-01-05T12:00:00'); // Monday noon
    const windows = expandWorkingWindows(
      [{ weekday: 1, startMinute: 540, endMinute: 1020 }], 'utc', now, 1,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-05T12:00:00'), end: utc('2026-01-05T17:00:00') },
    ]);
  });

  it('skips days whose weekday has no working-hours entry', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const windows = expandWorkingWindows(
      [{ weekday: 2, startMinute: 540, endMinute: 1020 }], // Tuesday only
      'utc', now, 3,
    );
    expect(windows).toEqual([
      { start: utc('2026-01-06T09:00:00'), end: utc('2026-01-06T17:00:00') },
    ]);
  });

  it('tracks wall-clock across a DST spring-forward (window stays 09:00 local)', () => {
    const zone = 'America/New_York'; // 2026-03-08 springs forward 02:00 -> 03:00
    const now = DateTime.fromObject({ year: 2026, month: 3, day: 6 }, { zone }).toMillis();
    const wh = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    const windows = expandWorkingWindows(wh, zone, now, 5);
    for (const w of windows) {
      expect(DateTime.fromMillis(w.start, { zone }).hour).toBe(9);
      expect(DateTime.fromMillis(w.end, { zone }).hour).toBe(17);
    }
    const mar7 = windows.find((w) => DateTime.fromMillis(w.start, { zone }).day === 7)!;
    const mar8 = windows.find((w) => DateTime.fromMillis(w.start, { zone }).day === 8)!;
    expect(mar8.start - mar7.start).toBe(23 * 60 * 60 * 1000);
  });

  it('throws for an invalid timezone and a non-positive horizon', () => {
    const now = utc('2026-01-05T00:00:00');
    expect(() => expandWorkingWindows([], 'Not/AZone', now, 7)).toThrow(InvalidTimezoneError);
    expect(() => expandWorkingWindows([], 'utc', now, 0)).toThrow(InvalidHorizonError);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/time-windows.test.ts`
Expected: FAIL — cannot find module `../src/time-windows.js`.

- [ ] **Step 3: Implement `packages/core/src/time-windows.ts`**

```ts
import { DateTime } from 'luxon';
import type { Interval } from '@notreclaim/scheduler';
import { InvalidHorizonError, InvalidTimezoneError } from './errors.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A working-hours entry. weekday: 0 = Sunday .. 6 = Saturday. */
export interface WorkingHourEntry {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Throw if the IANA timezone is invalid (clock-free check). */
export function assertValidZone(timezone: string): void {
  if (!DateTime.fromMillis(0, { zone: timezone }).isValid) {
    throw new InvalidTimezoneError(timezone);
  }
}

/**
 * Expand working-hours entries into concrete epoch-ms intervals over
 * [now, now + horizonDays days], computed per calendar day in `timezone`
 * (DST-correct via luxon). Intervals are clipped to the horizon and sorted.
 */
export function expandWorkingWindows(
  workingHours: WorkingHourEntry[],
  timezone: string,
  now: number,
  horizonDays: number,
): Interval[] {
  assertValidZone(timezone);
  if (horizonDays <= 0) throw new InvalidHorizonError(horizonDays);

  const horizonEnd = now + horizonDays * MS_PER_DAY;
  const windows: Interval[] = [];
  let day = DateTime.fromMillis(now, { zone: timezone }).startOf('day');

  while (day.toMillis() < horizonEnd) {
    const weekday = day.weekday % 7; // luxon Mon=1..Sun=7 -> Sun=0..Sat=6
    for (const wh of workingHours) {
      if (wh.weekday !== weekday) continue;
      const start = Math.max(day.plus({ minutes: wh.startMinute }).toMillis(), now);
      const end = Math.min(day.plus({ minutes: wh.endMinute }).toMillis(), horizonEnd);
      if (end > start) windows.push({ start, end });
    }
    day = day.plus({ days: 1 });
  }

  windows.sort((a, b) => a.start - b.start);
  return windows;
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/core && npx vitest run test/time-windows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/time-windows.ts packages/core/test/time-windows.test.ts
git commit -m "feat(core): add timezone-aware expandWorkingWindows"
```

---

### Task 5: `expandHabit`

**Files:**
- Create: `packages/core/src/habit-expansion.ts`
- Test: `packages/core/test/habit-expansion.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/habit-expansion.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Habit } from '@notreclaim/db';
import { expandHabit } from '../src/habit-expansion.js';
import { InvalidTimezoneError } from '../src/errors.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

const dbHabit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  userId: 'u1',
  title: 'Exercise',
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
});

describe('expandHabit', () => {
  it('produces ISO Monday-week periods clipped to the horizon', () => {
    const now = utc('2026-01-07T00:00:00'); // Wednesday; ISO week starts Mon 2026-01-05
    const h = expandHabit(dbHabit(), 'utc', now, 10);
    expect(h.periods[0]!.start).toBe(now);
    expect(h.periods[0]!.end).toBe(utc('2026-01-12T00:00:00'));
    expect(h.periods[1]!.start).toBe(utc('2026-01-12T00:00:00'));
  });

  it('builds full-day allowedWindows only on eligible weekdays', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const h = expandHabit(dbHabit({ eligibleDays: [1] }), 'utc', now, 7); // Mondays only
    expect(h.allowedWindows).toEqual([
      { start: utc('2026-01-05T00:00:00'), end: utc('2026-01-06T00:00:00') },
    ]);
  });

  it('adds preferredWindows when a preferred time-of-day is set', () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const h = expandHabit(
      dbHabit({ eligibleDays: [1], preferredStartMinute: 540, preferredEndMinute: 660 }),
      'utc', now, 7,
    );
    expect(h.preferredWindows).toEqual([
      { start: utc('2026-01-05T09:00:00'), end: utc('2026-01-05T11:00:00') },
    ]);
  });

  it('omits preferredWindows when no preferred time-of-day is set', () => {
    const now = utc('2026-01-05T00:00:00');
    const h = expandHabit(dbHabit({ eligibleDays: [1] }), 'utc', now, 7);
    expect(h.preferredWindows).toBeUndefined();
  });

  it('copies id, title, priority, chunkMs, perPeriod', () => {
    const now = utc('2026-01-05T00:00:00');
    const h = expandHabit(dbHabit(), 'utc', now, 7);
    expect(h).toMatchObject({ id: 'h1', title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3 });
  });

  it('throws InvalidTimezoneError for a bad zone', () => {
    expect(() => expandHabit(dbHabit(), 'Not/AZone', utc('2026-01-05T00:00:00'), 7))
      .toThrow(InvalidTimezoneError);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/habit-expansion.test.ts`
Expected: FAIL — cannot find module `../src/habit-expansion.js`.

- [ ] **Step 3: Implement `packages/core/src/habit-expansion.ts`**

```ts
import { DateTime } from 'luxon';
import type { Habit as EngineHabit, Interval } from '@notreclaim/scheduler';
import type { Habit as DbHabit } from '@notreclaim/db';
import { InvalidHorizonError } from './errors.js';
import { assertValidZone } from './time-windows.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Expand a DB habit (recurrence rule) into the engine Habit over the horizon:
 * ISO Monday-week `periods`, hard `allowedWindows` on eligible days, and soft
 * `preferredWindows` when a preferred time-of-day is set.
 */
export function expandHabit(
  habit: DbHabit,
  timezone: string,
  now: number,
  horizonDays: number,
): EngineHabit {
  assertValidZone(timezone);
  if (horizonDays <= 0) throw new InvalidHorizonError(horizonDays);

  const horizonEnd = now + horizonDays * MS_PER_DAY;

  // ISO Monday-week periods, clipped to the horizon.
  const periods: Interval[] = [];
  let weekStart = DateTime.fromMillis(now, { zone: timezone }).startOf('week');
  while (weekStart.toMillis() < horizonEnd) {
    const weekEnd = weekStart.plus({ weeks: 1 });
    const start = Math.max(weekStart.toMillis(), now);
    const end = Math.min(weekEnd.toMillis(), horizonEnd);
    if (end > start) periods.push({ start, end });
    weekStart = weekEnd;
  }

  // Eligible-day allowed windows (hard) + optional preferred windows (soft).
  const eligible = new Set(habit.eligibleDays);
  const hasPreferred =
    habit.preferredStartMinute != null && habit.preferredEndMinute != null;
  const allowedWindows: Interval[] = [];
  const preferredWindows: Interval[] = [];

  let day = DateTime.fromMillis(now, { zone: timezone }).startOf('day');
  while (day.toMillis() < horizonEnd) {
    if (eligible.has(day.weekday % 7)) {
      const dayStart = Math.max(day.toMillis(), now);
      const dayEnd = Math.min(day.plus({ days: 1 }).toMillis(), horizonEnd);
      if (dayEnd > dayStart) allowedWindows.push({ start: dayStart, end: dayEnd });

      if (hasPreferred) {
        const ps = Math.max(day.plus({ minutes: habit.preferredStartMinute! }).toMillis(), now);
        const pe = Math.min(day.plus({ minutes: habit.preferredEndMinute! }).toMillis(), horizonEnd);
        if (pe > ps) preferredWindows.push({ start: ps, end: pe });
      }
    }
    day = day.plus({ days: 1 });
  }

  const result: EngineHabit = {
    id: habit.id,
    title: habit.title,
    priority: habit.priority,
    chunkMs: habit.chunkMs,
    perPeriod: habit.perPeriod,
    periods,
    allowedWindows,
  };
  if (preferredWindows.length > 0) {
    result.preferredWindows = preferredWindows;
  }
  return result;
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/core && npx vitest run test/habit-expansion.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/habit-expansion.ts packages/core/test/habit-expansion.test.ts
git commit -m "feat(core): add timezone-aware expandHabit"
```

---

### Task 6: `toScheduledBlockInput` bridge

**Files:**
- Create: `packages/core/src/bridge.ts`
- Test: `packages/core/test/bridge.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/bridge.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toScheduledBlockInput } from '../src/bridge.js';

describe('toScheduledBlockInput', () => {
  it('maps a task block to taskId', () => {
    expect(
      toScheduledBlockInput({
        id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Focus', start: 1000, end: 2000,
      }),
    ).toEqual({
      taskId: 't1', habitId: null, title: 'Focus', startsAt: new Date(1000), endsAt: new Date(2000),
    });
  });

  it('maps a habit block to habitId', () => {
    const r = toScheduledBlockInput({
      id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Run', start: 0, end: 30,
    });
    expect(r.habitId).toBe('h1');
    expect(r.taskId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/bridge.test.ts`
Expected: FAIL — cannot find module `../src/bridge.js`.

- [ ] **Step 3: Implement `packages/core/src/bridge.ts`**

```ts
import type { ScheduledBlock as EngineScheduledBlock } from '@notreclaim/scheduler';
import type { CreateScheduledBlockInput } from '@notreclaim/db';

/** Map an engine ScheduledBlock back to a DB-writable create input. */
export function toScheduledBlockInput(block: EngineScheduledBlock): CreateScheduledBlockInput {
  return {
    taskId: block.sourceType === 'task' ? block.sourceId : null,
    habitId: block.sourceType === 'habit' ? block.sourceId : null,
    title: block.title,
    startsAt: new Date(block.start),
    endsAt: new Date(block.end),
  };
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/core && npx vitest run test/bridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/bridge.ts packages/core/test/bridge.test.ts
git commit -m "feat(core): add toScheduledBlockInput bridge"
```

---

### Task 7: `assembleScheduleInput` (+ test fakes)

**Files:**
- Create: `packages/core/src/assemble.ts`
- Create: `packages/core/test/fakes.ts`
- Test: `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Create the test fakes `packages/core/test/fakes.ts`** (in-memory repositories + model row builders):

```ts
import type {
  Settings, CalendarEvent, Task, Habit, ScheduledBlock,
} from '@notreclaim/db';
import type { SchedulingRepositories } from '../src/assemble.js';

export interface FakeData {
  settings?: Settings | null;
  events?: CalendarEvent[];
  blocks?: ScheduledBlock[];
  tasks?: Task[];
  habits?: Habit[];
}

export function fakeRepos(data: FakeData): SchedulingRepositories {
  return {
    settings: { getByUserId: async () => data.settings ?? null },
    calendarEvents: { listByUserInRange: async () => data.events ?? [] },
    tasks: { listByUser: async () => data.tasks ?? [] },
    habits: { listByUser: async () => data.habits ?? [] },
    scheduledBlocks: { listByUserInRange: async () => data.blocks ?? [] },
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
    category: null,
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
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test `packages/core/test/assemble.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { assembleScheduleInput } from '../src/assemble.js';
import { SettingsRequiredError } from '../src/errors.js';
import { fakeRepos, makeSettings, makeTask, makeHabit, makeEvent, makeBlock } from './fakes.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('assembleScheduleInput', () => {
  it('throws SettingsRequiredError when there are no settings', async () => {
    await expect(assembleScheduleInput(fakeRepos({ settings: null }), 'u1', 0))
      .rejects.toThrow(SettingsRequiredError);
  });

  it('includes only active habits and pending/scheduled tasks', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [
          makeTask({ id: 't1', status: 'pending' }),
          makeTask({ id: 't2', status: 'completed' }),
          makeTask({ id: 't3', status: 'scheduled' }),
        ],
        habits: [
          makeHabit({ id: 'h1', status: 'active', eligibleDays: [1] }),
          makeHabit({ id: 'h2', status: 'paused', eligibleDays: [1] }),
        ],
      }),
      'u1', now,
    );
    expect(input.tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
    expect(input.habits.map((h) => h.id)).toEqual(['h1']);
    expect(input.workingWindows.length).toBeGreaterThan(0);
  });

  it('maps fixed events and keeps only pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        events: [makeEvent({
          id: 'e1',
          startsAt: new Date(utc('2026-01-05T10:00:00')),
          endsAt: new Date(utc('2026-01-05T11:00:00')),
        })],
        blocks: [
          makeBlock({ id: 'b1', pinned: true, taskId: 't1' }),
          makeBlock({ id: 'b2', pinned: false, taskId: 't1' }),
        ],
      }),
      'u1', now,
    );
    expect(input.fixedEvents).toEqual([
      { id: 'e1', start: utc('2026-01-05T10:00:00'), end: utc('2026-01-05T11:00:00') },
    ]);
    expect(input.pinnedBlocks.map((b) => b.id)).toEqual(['b1']);
  });
});
```

- [ ] **Step 3: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/assemble.test.ts`
Expected: FAIL — cannot find module `../src/assemble.js`.

- [ ] **Step 4: Implement `packages/core/src/assemble.ts`**

```ts
import type {
  ScheduleInput,
  FixedEvent,
  FlexibleTask,
  Habit as EngineHabit,
  ScheduledBlock as EngineScheduledBlock,
} from '@notreclaim/scheduler';
import type {
  SettingsRepository,
  CalendarEventRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
  TaskStatus,
} from '@notreclaim/db';
import { toFixedEvent, toFlexibleTask, toScheduledBlock } from '@notreclaim/db/mappers';
import { expandWorkingWindows, type WorkingHourEntry } from './time-windows.js';
import { expandHabit } from './habit-expansion.js';
import { SettingsRequiredError } from './errors.js';

/** The repository surface the scheduling layer reads from (DI seam). */
export interface SchedulingRepositories {
  settings: Pick<SettingsRepository, 'getByUserId'>;
  calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange'>;
  tasks: Pick<TaskRepository, 'listByUser'>;
  habits: Pick<HabitRepository, 'listByUser'>;
  scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCHEDULABLE_TASK_STATUSES: TaskStatus[] = ['pending', 'scheduled'];

/** Assemble a complete engine ScheduleInput from persisted user data. */
export async function assembleScheduleInput(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
): Promise<ScheduleInput> {
  const settings = await repos.settings.getByUserId(userId);
  if (!settings) throw new SettingsRequiredError(userId);

  const horizonDays = settings.horizonDays;
  const horizonStart = new Date(now);
  const horizonEnd = new Date(now + horizonDays * MS_PER_DAY);

  const workingWindows = expandWorkingWindows(
    settings.workingHours as unknown as WorkingHourEntry[],
    settings.timezone,
    now,
    horizonDays,
  );

  const events = await repos.calendarEvents.listByUserInRange(userId, horizonStart, horizonEnd);
  const fixedEvents: FixedEvent[] = events.map(toFixedEvent);

  const blocks = await repos.scheduledBlocks.listByUserInRange(userId, horizonStart, horizonEnd);
  const pinnedBlocks: EngineScheduledBlock[] = blocks
    .filter((b) => b.pinned)
    .map(toScheduledBlock);

  const allTasks = await repos.tasks.listByUser(userId);
  const tasks: FlexibleTask[] = allTasks
    .filter((t) => SCHEDULABLE_TASK_STATUSES.includes(t.status))
    .map(toFlexibleTask);

  const allHabits = await repos.habits.listByUser(userId);
  const habits: EngineHabit[] = allHabits
    .filter((h) => h.status === 'active')
    .map((h) => expandHabit(h, settings.timezone, now, horizonDays));

  return { workingWindows, fixedEvents, pinnedBlocks, tasks, habits };
}
```

- [ ] **Step 5: Run to verify pass.**
Run: `cd packages/core && npx vitest run test/assemble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/assemble.ts packages/core/test/fakes.ts packages/core/test/assemble.test.ts
git commit -m "feat(core): add assembleScheduleInput with injected repositories"
```

---

### Task 8: `computeDesiredSchedule`

**Files:**
- Create: `packages/core/src/compute.ts`
- Test: `packages/core/test/compute.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/compute.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { computeDesiredSchedule } from '../src/compute.js';
import { fakeRepos, makeSettings, makeTask } from './fakes.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('computeDesiredSchedule', () => {
  it('computes desired blocks from repository data', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 1,
          workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({
          id: 't1', status: 'pending', priority: 1,
          durationMs: 3600000, dueBy: new Date(utc('2026-01-05T17:00:00')),
          minChunkMs: 1800000, maxChunkMs: 1800000,
        })],
      }),
      'u1', now,
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.sourceId).toBe('t1');
    expect(result.unscheduled).toHaveLength(0);
  });

  it('surfaces an over-deadline task as unscheduled', async () => {
    const now = utc('2026-01-05T00:00:00');
    const result = await computeDesiredSchedule(
      fakeRepos({
        settings: makeSettings({
          timezone: 'utc',
          horizonDays: 1,
          workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as ReturnType<typeof makeSettings>['workingHours'],
        }),
        tasks: [makeTask({
          id: 't1', status: 'pending', priority: 1,
          durationMs: 36000000, dueBy: new Date(utc('2026-01-05T10:00:00')),
          minChunkMs: 3600000, maxChunkMs: 3600000,
        })],
      }),
      'u1', now,
    );
    expect(result.unscheduled.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/core && npx vitest run test/compute.test.ts`
Expected: FAIL — cannot find module `../src/compute.js`.

- [ ] **Step 3: Implement `packages/core/src/compute.ts`**

```ts
import { schedule } from '@notreclaim/scheduler';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { assembleScheduleInput, type SchedulingRepositories } from './assemble.js';

/** Assemble inputs from the DB and run the engine to get the desired schedule. */
export async function computeDesiredSchedule(
  repos: SchedulingRepositories,
  userId: string,
  now: number,
): Promise<ScheduleResult> {
  const input = await assembleScheduleInput(repos, userId, now);
  return schedule(input);
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/core && npx vitest run test/compute.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/compute.ts packages/core/test/compute.test.ts
git commit -m "feat(core): add computeDesiredSchedule"
```

---

### Task 9: Public exports and full verification

**Files:**
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write `packages/core/src/index.ts`**

```ts
export { SettingsRequiredError, InvalidTimezoneError, InvalidHorizonError } from './errors.js';
export { expandWorkingWindows, assertValidZone } from './time-windows.js';
export type { WorkingHourEntry } from './time-windows.js';
export { expandHabit } from './habit-expansion.js';
export { toScheduledBlockInput } from './bridge.js';
export { assembleScheduleInput } from './assemble.js';
export type { SchedulingRepositories } from './assemble.js';
export { computeDesiredSchedule } from './compute.js';
```

- [ ] **Step 2: Run the full core test suite.**
Run: `cd packages/core && npx vitest run`
Expected: PASS — time-windows 5, habit-expansion 6, bridge 2, assemble 3, compute 2 = 18 tests.

- [ ] **Step 3: Build the package.**
Run: `cd packages/core && npm run build`
Expected: compiles to `dist/` with no TypeScript errors; `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 4: Run the whole monorepo suite to confirm nothing regressed.**
Run: `cd /home/nyx-ai/Projects/NotReclaim && npm test`
Expected: scheduler 27, db 27, core 18 — all pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): add public exports"
```

---

## Self-Review Notes

- **Spec coverage:** engine `allowedWindows` extension (Task 1) · `expandWorkingWindows` with DST handling (Task 4) · `expandHabit` with ISO-Monday periods, hard eligible-day `allowedWindows`, soft `preferredWindows` (Task 5) · `SchedulingRepositories` + `assembleScheduleInput` with status filtering and pinned-only blocks (Task 7) · `computeDesiredSchedule` (Task 8) · `toScheduledBlockInput` bridge (Task 6) · typed errors (Task 3) · DB-free tests via in-memory fakes and fixed `now` (Tasks 4–8). The db consumption seam (`./mappers` subpath + model-type re-exports) is Task 2. All 3b items (OAuth, Google client, sync, diff/write-back) are intentionally absent.
- **Type consistency:** weekday mapping `luxon.weekday % 7` (Sunday=0) used identically in `time-windows.ts` and `habit-expansion.ts`; `SchedulingRepositories` uses `Pick<...>` of the db repository interfaces so real repos satisfy it structurally and fakes implement only the read methods; `expandHabit` returns the engine `Habit` including the new `allowedWindows` from Task 1; `toScheduledBlockInput` returns M2's `CreateScheduledBlockInput`.
- **No placeholders:** every code/test step is complete; no "similar to" references.
- **Determinism:** `now` is injected everywhere; timezone validity uses `DateTime.fromMillis(0, …)` not the clock; no `Math.random`.
- **Cross-package build order:** Task 1 rebuilds `@notreclaim/scheduler`; Tasks 2–3 rebuild `@notreclaim/db`; both must precede core typechecking (covered by Task 3 Step 5).
```
