# NotReclaim Scheduler Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic auto-scheduling engine that places flexible tasks and habits into open time slots around fixed events — the core of NotReclaim.

**Architecture:** A standalone TypeScript package (`@notreclaim/scheduler`) with zero runtime dependencies. The engine is a pure function `schedule(input) → result`: no Date.now, no randomness, no I/O. All time is expressed as epoch milliseconds (`number`); calendar/timezone expansion (turning "9–5 Mon–Fri" into concrete intervals) is the caller's job in a later milestone, so this package stays fully testable in isolation.

**Tech Stack:** TypeScript (ESM, strict), Vitest, npm workspaces.

---

## Milestone Roadmap (context)

This is **plan 1 of 5** for NotReclaim v1. Later plans (separate documents) cover: (2) Postgres persistence + data model, (3) Google auth + calendar sync worker, (4) REST API + WebSocket, (5) React web client. This plan delivers the engine those later layers call into.

## File Structure

```
package.json                          # root, npm workspaces
tsconfig.base.json                    # shared TS config
.gitignore
packages/scheduler/
  package.json                        # @notreclaim/scheduler
  tsconfig.json
  vitest.config.ts
  src/
    types.ts                          # all domain types (Interval, FixedEvent, FlexibleTask, Habit, ScheduledBlock, ...)
    intervals.ts                      # mergeIntervals, subtractIntervals, intersectIntervals
    placement.ts                      # splitDuration, placeItem
    items.ts                          # scheduleTask, scheduleHabit
    schedule.ts                       # schedule() orchestrator
    index.ts                          # public exports
  test/
    intervals.test.ts
    placement.test.ts
    items.test.ts
    schedule.test.ts
```

Each `src` file has one responsibility; tests mirror them. Files stay small and focused so they can be reasoned about in isolation.

---

### Task 0: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/scheduler/package.json`
- Create: `packages/scheduler/tsconfig.json`
- Create: `packages/scheduler/vitest.config.ts`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "notreclaim",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
.env
.env.*
```

- [ ] **Step 4: Create `packages/scheduler/package.json`**

```json
{
  "name": "@notreclaim/scheduler",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 5: Create `packages/scheduler/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `packages/scheduler/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json .gitignore packages/scheduler/package.json packages/scheduler/tsconfig.json packages/scheduler/vitest.config.ts package-lock.json
git commit -m "chore: scaffold monorepo and scheduler package"
```

---

### Task 1: Domain types

**Files:**
- Create: `packages/scheduler/src/types.ts`

No tests — these are type declarations only (no runtime behavior). They are exercised by every later test.

- [ ] **Step 1: Write `packages/scheduler/src/types.ts`**

```ts
/** A half-open time interval [start, end) in epoch milliseconds. start < end. */
export interface Interval {
  start: number;
  end: number;
}

/** A fixed, immovable calendar event (e.g. a meeting synced from Google). */
export interface FixedEvent {
  id: string;
  start: number;
  end: number;
}

/** A flexible task to be auto-scheduled. Lower `priority` number = scheduled first. */
export interface FlexibleTask {
  id: string;
  title: string;
  priority: number;
  /** Total work time required, in ms. */
  durationMs: number;
  /** Deadline: every placed chunk must end at or before this epoch ms. */
  dueBy: number;
  /** Smallest acceptable single block, in ms. */
  minChunkMs: number;
  /** Largest acceptable single block, in ms. */
  maxChunkMs: number;
}

/** A recurring flexible block. `perPeriod` occurrences of `chunkMs` within each period. */
export interface Habit {
  id: string;
  title: string;
  priority: number;
  /** Duration of a single occurrence, in ms. */
  chunkMs: number;
  /** Target number of occurrences per period. */
  perPeriod: number;
  /** Concrete period boundaries over the horizon (caller-supplied, e.g. weeks). */
  periods: Interval[];
  /**
   * Optional concrete preferred placement windows (e.g. "mornings").
   * The engine prefers these; if an occurrence cannot fit, it falls back to
   * any free time within the period.
   */
  preferredWindows?: Interval[];
}

/** Engine output: a concrete placement bound to a task or habit. */
export interface ScheduledBlock {
  /** Deterministic id, e.g. "task:<id>:<index>" or "habit:<id>:<index>". */
  id: string;
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  start: number;
  end: number;
}

/** An item (or portion of one) that could not be placed. */
export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
  /** Amount of work time that could not be placed, in ms. */
  remainingMs: number;
}

/** Input to the scheduling engine. All times are epoch ms. */
export interface ScheduleInput {
  /** Available working time over the horizon (already expanded by the caller). */
  workingWindows: Interval[];
  /** Immovable events that block time. */
  fixedEvents: FixedEvent[];
  /** Already-fixed engine blocks (user-pinned). Treated as busy AND echoed in output. */
  pinnedBlocks: ScheduledBlock[];
  tasks: FlexibleTask[];
  habits: Habit[];
}

/** Result of the scheduling engine. */
export interface ScheduleResult {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledItem[];
}
```

- [ ] **Step 2: Type-check**

Run: `cd packages/scheduler && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/scheduler/src/types.ts
git commit -m "feat(scheduler): add domain types"
```

---

### Task 2: Interval algebra

**Files:**
- Create: `packages/scheduler/src/intervals.ts`
- Test: `packages/scheduler/test/intervals.test.ts`

`mergeIntervals` normalizes a list (sorts, drops empty, merges overlapping/touching). `subtractIntervals(base, busy)` returns the parts of `base` not covered by `busy`. `intersectIntervals(a, b)` returns the overlap.

- [ ] **Step 1: Write the failing test for `mergeIntervals`**

`packages/scheduler/test/intervals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeIntervals, subtractIntervals, intersectIntervals } from '../src/intervals.js';

describe('mergeIntervals', () => {
  it('sorts and merges overlapping and touching intervals, dropping empties', () => {
    const input = [
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 10, end: 20 }, // touches previous -> merges
      { start: 15, end: 18 }, // contained -> merges
      { start: 50, end: 50 }, // empty -> dropped
    ];
    expect(mergeIntervals(input)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scheduler && npx vitest run test/intervals.test.ts`
Expected: FAIL — cannot find module `../src/intervals.js` / `mergeIntervals is not a function`.

- [ ] **Step 3: Implement `mergeIntervals`**

`packages/scheduler/src/intervals.ts`:

```ts
import type { Interval } from './types.js';

/** Sort, drop empty intervals, and merge overlapping or touching ones. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const result: Interval[] = [];
  for (const cur of valid) {
    const last = result[result.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      result.push({ start: cur.start, end: cur.end });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/scheduler && npx vitest run test/intervals.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add failing tests for `subtractIntervals` and `intersectIntervals`**

Append to `packages/scheduler/test/intervals.test.ts`:

```ts
describe('subtractIntervals', () => {
  it('removes busy ranges from base, splitting where needed', () => {
    const base = [{ start: 0, end: 100 }];
    const busy = [
      { start: 20, end: 30 },
      { start: 60, end: 70 },
    ];
    expect(subtractIntervals(base, busy)).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
      { start: 70, end: 100 },
    ]);
  });

  it('returns base unchanged when busy does not overlap', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 20, end: 30 }]))
      .toEqual([{ start: 0, end: 10 }]);
  });

  it('returns empty when busy fully covers base', () => {
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 0, end: 10 }]))
      .toEqual([]);
  });
});

describe('intersectIntervals', () => {
  it('returns only the overlapping regions', () => {
    const a = [{ start: 0, end: 50 }, { start: 60, end: 100 }];
    const b = [{ start: 40, end: 70 }];
    expect(intersectIntervals(a, b)).toEqual([
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ]);
  });
});
```

- [ ] **Step 6: Run tests to verify the new ones fail**

Run: `cd packages/scheduler && npx vitest run test/intervals.test.ts`
Expected: FAIL — `subtractIntervals is not a function` / `intersectIntervals is not a function`.

- [ ] **Step 7: Implement `subtractIntervals` and `intersectIntervals`**

Append to `packages/scheduler/src/intervals.ts`:

```ts
/** Return the portions of `base` not covered by any interval in `busy`. */
export function subtractIntervals(base: Interval[], busy: Interval[]): Interval[] {
  const mergedBase = mergeIntervals(base);
  const mergedBusy = mergeIntervals(busy);
  const result: Interval[] = [];

  for (const b of mergedBase) {
    let cursor = b.start;
    for (const x of mergedBusy) {
      if (x.end <= cursor || x.start >= b.end) continue;
      if (x.start > cursor) {
        result.push({ start: cursor, end: Math.min(x.start, b.end) });
      }
      cursor = Math.max(cursor, x.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) result.push({ start: cursor, end: b.end });
  }
  return result.filter((i) => i.end > i.start);
}

/** Return the overlapping regions between `a` and `b`. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;

  while (i < A.length && j < B.length) {
    const ai = A[i]!;
    const bj = B[j]!;
    const start = Math.max(ai.start, bj.start);
    const end = Math.min(ai.end, bj.end);
    if (end > start) result.push({ start, end });
    if (ai.end < bj.end) i++;
    else j++;
  }
  return result;
}
```

- [ ] **Step 8: Run all interval tests to verify they pass**

Run: `cd packages/scheduler && npx vitest run test/intervals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/scheduler/src/intervals.ts packages/scheduler/test/intervals.test.ts
git commit -m "feat(scheduler): add interval algebra (merge, subtract, intersect)"
```

---

### Task 3: Duration splitting

**Files:**
- Create: `packages/scheduler/src/placement.ts`
- Test: `packages/scheduler/test/placement.test.ts`

`splitDuration` divides a total duration into chunk sizes that sum exactly to the total, using the fewest chunks while keeping each chunk within `[minChunkMs, maxChunkMs]` when the total allows. Distribution is even and deterministic.

- [ ] **Step 1: Write the failing test for `splitDuration`**

`packages/scheduler/test/placement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitDuration } from '../src/placement.js';

describe('splitDuration', () => {
  it('returns a single chunk when duration fits in maxChunk', () => {
    expect(splitDuration(20, 15, 30)).toEqual([20]);
  });

  it('splits evenly into the fewest chunks not exceeding maxChunk', () => {
    expect(splitDuration(60, 15, 30)).toEqual([30, 30]);
    expect(splitDuration(90, 15, 30)).toEqual([30, 30, 30]);
  });

  it('distributes a non-divisible total as evenly as possible (sums exactly)', () => {
    const chunks = splitDuration(50, 15, 30);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(50);
    expect(chunks).toEqual([25, 25]);
  });

  it('returns empty for non-positive duration', () => {
    expect(splitDuration(0, 15, 30)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scheduler && npx vitest run test/placement.test.ts`
Expected: FAIL — `splitDuration is not a function`.

- [ ] **Step 3: Implement `splitDuration`**

`packages/scheduler/src/placement.ts`:

```ts
import type { Interval } from './types.js';
import { intersectIntervals, subtractIntervals, mergeIntervals } from './intervals.js';

/**
 * Split `durationMs` into chunk sizes summing exactly to it, using the fewest
 * chunks such that each is <= maxChunkMs, while avoiding chunks below minChunkMs
 * when the total allows. Distribution is even and deterministic.
 */
export function splitDuration(
  durationMs: number,
  minChunkMs: number,
  maxChunkMs: number,
): number[] {
  if (durationMs <= 0) return [];
  if (durationMs <= maxChunkMs) return [durationMs];

  let n = Math.ceil(durationMs / maxChunkMs);
  const maxChunks = Math.max(1, Math.floor(durationMs / minChunkMs));
  if (n > maxChunks) n = maxChunks;

  const base = Math.floor(durationMs / n);
  const remainder = durationMs - base * n;
  const chunks: number[] = [];
  for (let k = 0; k < n; k++) {
    chunks.push(base + (k < remainder ? 1 : 0));
  }
  return chunks;
}
```

> Note: the `mergeIntervals` import is unused until Task 4. TypeScript with the base config does not error on unused imports, but if a linter is added later, this is resolved when `placeItem` is implemented in Task 4. Leaving it here keeps the import block stable across tasks.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/scheduler && npx vitest run test/placement.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/placement.ts packages/scheduler/test/placement.test.ts
git commit -m "feat(scheduler): add splitDuration"
```

---

### Task 4: Chunk placement

**Files:**
- Modify: `packages/scheduler/src/placement.ts`
- Test: `packages/scheduler/test/placement.test.ts`

`placeItem` places a list of chunk sizes into the earliest-fitting free slots, optionally restricted to candidate windows, never placing a chunk that ends after `deadline`. It returns the placements, the updated (shrunken) free timeline, and any chunk sizes that could not be placed.

- [ ] **Step 1: Add the `Placement` type and failing tests**

Append to `packages/scheduler/test/placement.test.ts`:

```ts
import { placeItem } from '../src/placement.js';

describe('placeItem', () => {
  it('places chunks into the earliest free slots and shrinks free time', () => {
    const free = [{ start: 0, end: 100 }];
    const result = placeItem(free, [30, 30], 100);
    expect(result.placements).toEqual([
      { start: 0, end: 30 },
      { start: 30, end: 60 },
    ]);
    expect(result.unplaced).toEqual([]);
    expect(result.free).toEqual([{ start: 60, end: 100 }]);
  });

  it('does not place a chunk that would end after the deadline', () => {
    const free = [{ start: 0, end: 100 }];
    const result = placeItem(free, [30], 20);
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([30]);
    expect(result.free).toEqual([{ start: 0, end: 100 }]);
  });

  it('restricts placement to candidate windows when provided', () => {
    const free = [{ start: 0, end: 100 }];
    const candidates = [{ start: 40, end: 100 }];
    const result = placeItem(free, [30], 100, candidates);
    expect(result.placements).toEqual([{ start: 40, end: 70 }]);
    expect(result.free).toEqual([{ start: 0, end: 40 }, { start: 70, end: 100 }]);
  });

  it('reports chunks that do not fit as unplaced', () => {
    const free = [{ start: 0, end: 40 }];
    const result = placeItem(free, [30, 30], 1000);
    expect(result.placements).toEqual([{ start: 0, end: 30 }]);
    expect(result.unplaced).toEqual([30]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/scheduler && npx vitest run test/placement.test.ts`
Expected: FAIL — `placeItem is not a function`.

- [ ] **Step 3: Implement `placeItem`**

Append to `packages/scheduler/src/placement.ts`:

```ts
export interface Placement {
  start: number;
  end: number;
}

export interface PlaceItemResult {
  placements: Placement[];
  /** Free timeline after removing the placed blocks. */
  free: Interval[];
  /** Chunk sizes that could not be placed. */
  unplaced: number[];
}

/**
 * Greedily place each chunk size into the earliest free slot large enough,
 * optionally restricted to `candidateWindows`, never ending after `deadline`.
 */
export function placeItem(
  free: Interval[],
  chunkSizes: number[],
  deadline: number,
  candidateWindows?: Interval[],
): PlaceItemResult {
  let remainingFree = mergeIntervals(free);
  const placements: Placement[] = [];
  const unplaced: number[] = [];

  for (const size of chunkSizes) {
    const candidates = candidateWindows
      ? intersectIntervals(remainingFree, candidateWindows)
      : remainingFree;

    const slot = candidates.find(
      (s) => s.end - s.start >= size && s.start + size <= deadline,
    );

    if (!slot) {
      unplaced.push(size);
      continue;
    }

    const placement: Placement = { start: slot.start, end: slot.start + size };
    placements.push(placement);
    remainingFree = subtractIntervals(remainingFree, [placement]);
  }

  return { placements, free: remainingFree, unplaced };
}
```

- [ ] **Step 4: Run all placement tests to verify they pass**

Run: `cd packages/scheduler && npx vitest run test/placement.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/placement.ts packages/scheduler/test/placement.test.ts
git commit -m "feat(scheduler): add placeItem chunk placement"
```

---

### Task 5: Scheduling a single task

**Files:**
- Create: `packages/scheduler/src/items.ts`
- Test: `packages/scheduler/test/items.test.ts`

`scheduleTask` splits a task into chunks, places them before the due date, builds `ScheduledBlock`s with deterministic ids, and reports any unplaced time as an `UnscheduledItem`.

- [ ] **Step 1: Write the failing test for `scheduleTask`**

`packages/scheduler/test/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scheduleTask } from '../src/items.js';
import type { FlexibleTask } from '../src/types.js';

const task = (over: Partial<FlexibleTask> = {}): FlexibleTask => ({
  id: 't1',
  title: 'Write report',
  priority: 1,
  durationMs: 60,
  dueBy: 1000,
  minChunkMs: 15,
  maxChunkMs: 30,
  ...over,
});

describe('scheduleTask', () => {
  it('places chunks and returns blocks with deterministic ids', () => {
    const free = [{ start: 0, end: 100 }];
    const result = scheduleTask(free, task());
    expect(result.blocks).toEqual([
      { id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 0, end: 30 },
      { id: 'task:t1:1', sourceType: 'task', sourceId: 't1', title: 'Write report', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
    expect(result.free).toEqual([{ start: 60, end: 100 }]);
  });

  it('reports unplaced time when free space runs out before the due date', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleTask(free, task({ durationMs: 60 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'task',
        sourceId: 't1',
        title: 'Write report',
        reason: 'insufficient free time before due date',
        remainingMs: 30,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: FAIL — `scheduleTask is not a function`.

- [ ] **Step 3: Implement `scheduleTask`**

`packages/scheduler/src/items.ts`:

```ts
import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { intersectIntervals } from './intervals.js';
import { placeItem, splitDuration } from './placement.js';

export interface ScheduleItemResult {
  blocks: ScheduledBlock[];
  free: Interval[];
  unscheduled: UnscheduledItem[];
}

/** Split a task into chunks and place them before its due date. */
export function scheduleTask(free: Interval[], task: FlexibleTask): ScheduleItemResult {
  const chunkSizes = splitDuration(task.durationMs, task.minChunkMs, task.maxChunkMs);
  const result = placeItem(free, chunkSizes, task.dueBy);

  const blocks: ScheduledBlock[] = result.placements.map((p, i) => ({
    id: `task:${task.id}:${i}`,
    sourceType: 'task',
    sourceId: task.id,
    title: task.title,
    start: p.start,
    end: p.end,
  }));

  const remainingMs = result.unplaced.reduce((a, b) => a + b, 0);
  const unscheduled: UnscheduledItem[] =
    remainingMs > 0
      ? [
          {
            sourceType: 'task',
            sourceId: task.id,
            title: task.title,
            reason: 'insufficient free time before due date',
            remainingMs,
          },
        ]
      : [];

  return { blocks, free: result.free, unscheduled };
}
```

> Note: the `Habit` and `intersectIntervals` imports are used by `scheduleHabit` in Task 6. They are declared now to keep the import block stable.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/items.ts packages/scheduler/test/items.test.ts
git commit -m "feat(scheduler): add scheduleTask"
```

---

### Task 6: Scheduling a habit

**Files:**
- Modify: `packages/scheduler/src/items.ts`
- Test: `packages/scheduler/test/items.test.ts`

`scheduleHabit` places up to `perPeriod` occurrences of `chunkMs` inside each period. It prefers `preferredWindows` (intersected with the period); if an occurrence cannot fit there, it falls back to any free time within the period. Missed occurrences are reported as a single `UnscheduledItem`.

- [ ] **Step 1: Add failing tests for `scheduleHabit`**

Append to `packages/scheduler/test/items.test.ts`:

```ts
import { scheduleHabit } from '../src/items.js';
import type { Habit } from '../src/types.js';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Exercise',
  priority: 2,
  chunkMs: 30,
  perPeriod: 2,
  periods: [{ start: 0, end: 1000 }],
  ...over,
});

describe('scheduleHabit', () => {
  it('places perPeriod occurrences within the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(free, habit());
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 0, end: 30 },
      { id: 'habit:h1:1', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 30, end: 60 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('prefers preferredWindows but falls back to any free time in the period', () => {
    const free = [{ start: 0, end: 1000 }];
    const result = scheduleHabit(
      free,
      habit({ perPeriod: 1, preferredWindows: [{ start: 500, end: 600 }] }),
    );
    expect(result.blocks).toEqual([
      { id: 'habit:h1:0', sourceType: 'habit', sourceId: 'h1', title: 'Exercise', start: 500, end: 530 },
    ]);
  });

  it('reports missed occurrences when free time is exhausted', () => {
    const free = [{ start: 0, end: 30 }];
    const result = scheduleHabit(free, habit({ perPeriod: 2 }));
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toEqual([
      {
        sourceType: 'habit',
        sourceId: 'h1',
        title: 'Exercise',
        reason: 'could not place all habit occurrences in free time',
        remainingMs: 30,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: FAIL — `scheduleHabit is not a function`.

- [ ] **Step 3: Implement `scheduleHabit`**

Append to `packages/scheduler/src/items.ts`:

```ts
/** Place up to perPeriod occurrences of the habit within each period. */
export function scheduleHabit(free: Interval[], habit: Habit): ScheduleItemResult {
  let remainingFree = free;
  const blocks: ScheduledBlock[] = [];
  let missed = 0;
  let index = 0;

  for (const period of habit.periods) {
    const periodWindow: Interval[] = [period];
    const preferred = habit.preferredWindows
      ? intersectIntervals(habit.preferredWindows, periodWindow)
      : undefined;

    for (let k = 0; k < habit.perPeriod; k++) {
      let res = placeItem(remainingFree, [habit.chunkMs], period.end, preferred ?? periodWindow);
      if (res.placements.length === 0 && preferred && preferred.length > 0) {
        res = placeItem(remainingFree, [habit.chunkMs], period.end, periodWindow);
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

- [ ] **Step 4: Run all item tests to verify they pass**

Run: `cd packages/scheduler && npx vitest run test/items.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/items.ts packages/scheduler/test/items.test.ts
git commit -m "feat(scheduler): add scheduleHabit with preferred-window fallback"
```

---

### Task 7: The schedule orchestrator

**Files:**
- Create: `packages/scheduler/src/schedule.ts`
- Test: `packages/scheduler/test/schedule.test.ts`

`schedule` builds the free timeline (working windows minus fixed events and pinned blocks), orders tasks and habits by priority (then deadline/period-start, then id), places each in turn against the shrinking free timeline, echoes pinned blocks into the output, and returns sorted blocks plus all unscheduled items.

- [ ] **Step 1: Write the failing test for `schedule`**

`packages/scheduler/test/schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { schedule } from '../src/schedule.js';
import type { ScheduleInput } from '../src/types.js';

const baseInput = (): ScheduleInput => ({
  workingWindows: [{ start: 0, end: 1000 }],
  fixedEvents: [],
  pinnedBlocks: [],
  tasks: [],
  habits: [],
});

describe('schedule', () => {
  it('avoids fixed events and schedules higher-priority tasks first', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      fixedEvents: [{ id: 'm1', start: 0, end: 50 }],
      tasks: [
        { id: 'low', title: 'Low', priority: 5, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
        { id: 'high', title: 'High', priority: 1, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
      ],
    };
    const result = schedule(input);
    // free starts at 50 (after the meeting); 'high' goes first.
    expect(result.blocks).toEqual([
      { id: 'task:high:0', sourceType: 'task', sourceId: 'high', title: 'High', start: 50, end: 80 },
      { id: 'task:low:0', sourceType: 'task', sourceId: 'low', title: 'Low', start: 80, end: 110 },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('treats pinned blocks as busy and echoes them in the output', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      pinnedBlocks: [
        { id: 'pin:1', sourceType: 'task', sourceId: 'x', title: 'Pinned', start: 0, end: 100 },
      ],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: 30, dueBy: 1000, minChunkMs: 30, maxChunkMs: 30 },
      ],
    };
    const result = schedule(input);
    expect(result.blocks).toEqual([
      { id: 'pin:1', sourceType: 'task', sourceId: 'x', title: 'Pinned', start: 0, end: 100 },
      { id: 'task:t:0', sourceType: 'task', sourceId: 't', title: 'T', start: 100, end: 130 },
    ]);
  });

  it('surfaces tasks that cannot meet their deadline as unscheduled', () => {
    const input: ScheduleInput = {
      ...baseInput(),
      workingWindows: [{ start: 0, end: 20 }],
      tasks: [
        { id: 't', title: 'T', priority: 1, durationMs: 60, dueBy: 20, minChunkMs: 20, maxChunkMs: 20 },
      ],
    };
    const result = schedule(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]!.sourceId).toBe('t');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scheduler && npx vitest run test/schedule.test.ts`
Expected: FAIL — `schedule is not a function`.

- [ ] **Step 3: Implement `schedule`**

`packages/scheduler/src/schedule.ts`:

```ts
import type {
  FlexibleTask,
  Habit,
  Interval,
  ScheduleInput,
  ScheduleResult,
  ScheduledBlock,
  UnscheduledItem,
} from './types.js';
import { mergeIntervals, subtractIntervals } from './intervals.js';
import { scheduleHabit, scheduleTask } from './items.js';

type WorkItem =
  | { kind: 'task'; priority: number; tie: number; id: string; task: FlexibleTask }
  | { kind: 'habit'; priority: number; tie: number; id: string; habit: Habit };

function earliestPeriodStart(periods: Interval[]): number {
  let min = Infinity;
  for (const p of periods) if (p.start < min) min = p.start;
  return min;
}

/** Pure auto-scheduling entry point. */
export function schedule(input: ScheduleInput): ScheduleResult {
  const busy = mergeIntervals([
    ...input.fixedEvents.map((e) => ({ start: e.start, end: e.end })),
    ...input.pinnedBlocks.map((b) => ({ start: b.start, end: b.end })),
  ]);
  let free = subtractIntervals(input.workingWindows, busy);

  const work: WorkItem[] = [
    ...input.tasks.map(
      (t): WorkItem => ({ kind: 'task', priority: t.priority, tie: t.dueBy, id: t.id, task: t }),
    ),
    ...input.habits.map(
      (h): WorkItem => ({
        kind: 'habit',
        priority: h.priority,
        tie: earliestPeriodStart(h.periods),
        id: h.id,
        habit: h,
      }),
    ),
  ];
  work.sort(
    (a, b) => a.priority - b.priority || a.tie - b.tie || a.id.localeCompare(b.id),
  );

  const blocks: ScheduledBlock[] = [...input.pinnedBlocks];
  const unscheduled: UnscheduledItem[] = [];

  for (const item of work) {
    const res =
      item.kind === 'task'
        ? scheduleTask(free, item.task)
        : scheduleHabit(free, item.habit);
    blocks.push(...res.blocks);
    unscheduled.push(...res.unscheduled);
    free = res.free;
  }

  blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return { blocks, unscheduled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/scheduler && npx vitest run test/schedule.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/schedule.ts packages/scheduler/test/schedule.test.ts
git commit -m "feat(scheduler): add schedule orchestrator"
```

---

### Task 8: Public exports and full build

**Files:**
- Create: `packages/scheduler/src/index.ts`

- [ ] **Step 1: Write `packages/scheduler/src/index.ts`**

```ts
export * from './types.js';
export { mergeIntervals, subtractIntervals, intersectIntervals } from './intervals.js';
export { splitDuration, placeItem } from './placement.js';
export type { Placement, PlaceItemResult } from './placement.js';
export { scheduleTask, scheduleHabit } from './items.js';
export type { ScheduleItemResult } from './items.js';
export { schedule } from './schedule.js';
```

- [ ] **Step 2: Run the full test suite**

Run: `cd packages/scheduler && npx vitest run`
Expected: PASS — all tests across `intervals`, `placement`, `items`, `schedule` (18 tests total).

- [ ] **Step 3: Build the package**

Run: `cd packages/scheduler && npm run build`
Expected: compiles to `dist/` with no TypeScript errors; `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 4: Commit**

```bash
git add packages/scheduler/src/index.ts
git commit -m "feat(scheduler): add public exports"
```

---

## Self-Review Notes

- **Spec coverage:** This plan covers the spec's "Auto-Scheduling Engine (v1 core solver)" section — free/busy timeline (Task 2), priority-then-due ordering (Task 7), chunking with min/max (Tasks 3–4), habit frequency with preferred windows (Task 6), pinned blocks as busy (Task 7), and "at-risk/unscheduled" surfacing (Tasks 5–7). Working-hours/timezone expansion, Google sync, persistence, API, and UI are explicitly deferred to milestone plans 2–5.
- **Type consistency:** `ScheduleItemResult` (Task 5) is reused by `scheduleHabit` (Task 6) and `schedule` (Task 7). Block id format `task:<id>:<index>` / `habit:<id>:<index>` is consistent across Tasks 5–7. `placeItem` signature `(free, chunkSizes, deadline, candidateWindows?)` is identical in Tasks 4–6.
- **Determinism:** no `Date.now`, `Math.random`, or I/O anywhere; all sorts have explicit `id` tiebreakers.
- **Forward-reference imports:** Tasks 3 and 5 deliberately import symbols used by later tasks in the same file; notes flag this so an out-of-order reader is not confused.
