# Stats Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stats dashboard at `/stats` (4 summary cards + "Hours by day" stacked bar chart + "Time split" donut), computed client-side from the current week's proposed plan + meetings + tasks, replacing the "Coming soon" placeholder.

**Architecture:** A pure `statsModel.ts` does all aggregation (bucket proposed task/habit blocks + Google meetings by day, summaries, task completion, donut segments) — fully unit-tested with injected `now`/`TZ=UTC`. Thin presentational components render it; the `Stats` page wires the three existing queries. No backend, no new query keys.

**Tech Stack:** React 18 + Vite 5 + Tailwind v3 + TanStack Query v5 + Vitest + @testing-library/react@16 + jsdom (`TZ=UTC`).

**Conventions (every task):** TS ESM strict, `noUncheckedIndexedAccess`. Imports **extensionless**; **never** `import React` (`import { useMemo } from 'react'`, `import type { ReactNode } from 'react'` are fine). Tailwind utility classes only. **The only permitted inline `style`s are (a) the conic-gradient donut background and (b) the computed px bar heights** (Tailwind can't express dynamic px / conic gradients). Tests use `fakeApiClient(overrides as never)` + `renderWithProviders` from `src/test/fakes`; no real network. All paths under `packages/web/`. **Per-task run:** `npm test -w @notreclaim/web -- <path>`. Build: `npm run build -w @notreclaim/web`.

**Tokens:** `kind.taskBar` `#f2700f` / `kind.meetingBar` `#e5484d` / `kind.habitBar` `#2fa45f` (classes `bg-kind-taskBar` etc.); `kind.taskText`; `indigo`, `crit`, `low` `#2fa45f`, `line`, `card`, `ink`, `inkSoft`; `shadow-card`. Reuse `weekModel` (`startOfWeek`, `dayColumns`, `addWeeks`, `MS_PER_DAY`) — **do not modify it**.

---

## File Structure

- Create: `src/app/stats/statsModel.ts` + `statsModel.test.ts` (Task 1)
- Create: `src/app/stats/StatCard.tsx`, `HoursByDayChart.tsx`, `TimeSplitDonut.tsx` + tests (Task 2)
- Create: `src/app/pages/Stats.tsx` + `Stats.test.tsx`; Modify `src/app/App.tsx` + `App.test.tsx`; Delete `src/app/pages/StatsPlaceholder.tsx` (Task 3)

---

## Task 1: `statsModel.ts` pure aggregation

**Files:**
- Create: `src/app/stats/statsModel.ts`
- Create: `src/app/stats/statsModel.test.ts`

- [ ] **Step 1: Write the failing test `src/app/stats/statsModel.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { SchedulePreview, CalendarEvent, Task } from '../../api/types';
import { startOfWeek, dayColumns } from '../planner/weekModel';
import {
  hoursByDay, summary, meetingCount, taskCompletion, donutSegments, formatHours, chartScaleMs, HOUR_MS,
} from './statsModel';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday
const days = dayColumns(startOfWeek(NOW)); // Mon 2026-01-05 .. Sun 2026-01-11 (UTC)

const preview = (over: Partial<SchedulePreview> = {}): SchedulePreview => ({
  blocks: [
    { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'A', start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T15:00:00.000Z') }, // Wed, 2h task
    { id: 'p2', sourceType: 'habit', sourceId: 'h1', title: 'B', start: Date.parse('2026-01-05T08:00:00.000Z'), end: Date.parse('2026-01-05T09:00:00.000Z') }, // Mon, 1h habit
    { id: 'p3', sourceType: 'task', sourceId: 't9', title: 'C', start: Date.parse('2026-02-01T10:00:00.000Z'), end: Date.parse('2026-02-01T11:00:00.000Z') }, // out of week
  ],
  unscheduled: [],
  ...over,
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z', // Wed, 30m meeting
  googleCalendarId: 'primary', googleEventId: 'g1', ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'x', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('hoursByDay', () => {
  it('buckets proposed task/habit blocks and meetings into the right day (TZ=UTC)', () => {
    const perDay = hoursByDay(days, preview(), [event()]);
    expect(perDay).toHaveLength(7);
    // Monday (index 0): 1h habit
    expect(perDay[0]).toEqual({ task: 0, meeting: 0, habit: HOUR_MS });
    // Wednesday (index 2): 2h task + 30m meeting
    expect(perDay[2]).toEqual({ task: 2 * HOUR_MS, meeting: HOUR_MS / 2, habit: 0 });
    // out-of-week task block excluded everywhere
    expect(perDay.reduce((a, d) => a + d.task, 0)).toBe(2 * HOUR_MS);
  });

  it('treats undefined preview as no blocks', () => {
    const perDay = hoursByDay(days, undefined, []);
    expect(perDay.every((d) => d.task === 0 && d.meeting === 0 && d.habit === 0)).toBe(true);
  });
});

describe('summary', () => {
  it('sums each kind and the total', () => {
    const perDay = hoursByDay(days, preview(), [event()]);
    const s = summary(perDay);
    expect(s.taskMs).toBe(2 * HOUR_MS);
    expect(s.habitMs).toBe(HOUR_MS);
    expect(s.meetingMs).toBe(HOUR_MS / 2);
    expect(s.totalMs).toBe(2 * HOUR_MS + HOUR_MS + HOUR_MS / 2);
  });
});

describe('meetingCount', () => {
  it('counts events whose start falls in the week', () => {
    expect(meetingCount(days, [event(), event({ id: 'e2', startsAt: '2026-02-01T10:00:00.000Z' })])).toBe(1);
  });
});

describe('taskCompletion', () => {
  it('computes done/total/pct excluding archived', () => {
    const tasks = [task({ status: 'completed' }), task({ id: 't2', status: 'pending' }), task({ id: 't3', status: 'archived' })];
    expect(taskCompletion(tasks)).toEqual({ done: 1, total: 2, pct: 50 });
  });
  it('pct is 0 when there are no tasks', () => {
    expect(taskCompletion([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe('donutSegments', () => {
  it('produces cumulative percentages in task,meeting,habit order', () => {
    const segs = donutSegments({ taskMs: 2 * HOUR_MS, meetingMs: HOUR_MS, habitMs: HOUR_MS });
    expect(segs).toEqual([
      { kind: 'task', ms: 2 * HOUR_MS, fromPct: 0, toPct: 50 },
      { kind: 'meeting', ms: HOUR_MS, fromPct: 50, toPct: 75 },
      { kind: 'habit', ms: HOUR_MS, fromPct: 75, toPct: 100 },
    ]);
  });
  it('omits zero-ms kinds and returns [] when total is 0', () => {
    expect(donutSegments({ taskMs: HOUR_MS, meetingMs: 0, habitMs: HOUR_MS })).toEqual([
      { kind: 'task', ms: HOUR_MS, fromPct: 0, toPct: 50 },
      { kind: 'habit', ms: HOUR_MS, fromPct: 50, toPct: 100 },
    ]);
    expect(donutSegments({ taskMs: 0, meetingMs: 0, habitMs: 0 })).toEqual([]);
  });
});

describe('formatHours', () => {
  it('formats hours with a trailing-zero strip', () => {
    expect(formatHours(34 * HOUR_MS)).toBe('34h');
    expect(formatHours(21.5 * HOUR_MS)).toBe('21.5h');
    expect(formatHours(0)).toBe('0h');
  });
});

describe('chartScaleMs', () => {
  it('is the max of 8h and the busiest day total', () => {
    expect(chartScaleMs([{ task: 0, meeting: 0, habit: 0 }])).toBe(8 * HOUR_MS);
    expect(chartScaleMs([{ task: 10 * HOUR_MS, meeting: 0, habit: 0 }])).toBe(10 * HOUR_MS);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -w @notreclaim/web -- src/app/stats/statsModel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/stats/statsModel.ts`**

```ts
import type { SchedulePreview, CalendarEvent, Task } from '../../api/types';
import { MS_PER_DAY } from '../planner/weekModel';

export const HOUR_MS = 3_600_000;

export interface KindMs { task: number; meeting: number; habit: number }

export function hoursByDay(days: number[], preview: SchedulePreview | undefined, events: CalendarEvent[]): KindMs[] {
  const blocks = preview?.blocks ?? [];
  return days.map((d) => {
    const end = d + MS_PER_DAY;
    let task = 0;
    let habit = 0;
    let meeting = 0;
    for (const b of blocks) {
      if (b.start >= d && b.start < end) {
        if (b.sourceType === 'task') task += b.end - b.start;
        else habit += b.end - b.start;
      }
    }
    for (const e of events) {
      const s = Date.parse(e.startsAt);
      if (s >= d && s < end) meeting += Date.parse(e.endsAt) - s;
    }
    return { task, meeting, habit };
  });
}

export function summary(perDay: KindMs[]): { totalMs: number; taskMs: number; meetingMs: number; habitMs: number } {
  const taskMs = perDay.reduce((a, d) => a + d.task, 0);
  const meetingMs = perDay.reduce((a, d) => a + d.meeting, 0);
  const habitMs = perDay.reduce((a, d) => a + d.habit, 0);
  return { taskMs, meetingMs, habitMs, totalMs: taskMs + meetingMs + habitMs };
}

export function meetingCount(days: number[], events: CalendarEvent[]): number {
  const first = days[0] ?? 0;
  const last = (days[days.length - 1] ?? 0) + MS_PER_DAY;
  return events.filter((e) => {
    const s = Date.parse(e.startsAt);
    return s >= first && s < last;
  }).length;
}

export function taskCompletion(tasks: Task[]): { done: number; total: number; pct: number } {
  const active = tasks.filter((t) => t.status !== 'archived');
  const done = active.filter((t) => t.status === 'completed').length;
  const total = active.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export type DonutKind = 'task' | 'meeting' | 'habit';
export interface DonutSegment { kind: DonutKind; ms: number; fromPct: number; toPct: number }

export function donutSegments(s: { taskMs: number; meetingMs: number; habitMs: number }): DonutSegment[] {
  const total = s.taskMs + s.meetingMs + s.habitMs;
  if (total <= 0) return [];
  const ordered: { kind: DonutKind; ms: number }[] = [
    { kind: 'task', ms: s.taskMs },
    { kind: 'meeting', ms: s.meetingMs },
    { kind: 'habit', ms: s.habitMs },
  ];
  const out: DonutSegment[] = [];
  let acc = 0;
  for (const seg of ordered) {
    if (seg.ms <= 0) continue;
    const fromPct = (acc / total) * 100;
    acc += seg.ms;
    out.push({ kind: seg.kind, ms: seg.ms, fromPct, toPct: (acc / total) * 100 });
  }
  return out;
}

export function formatHours(ms: number): string {
  const h = Math.round(ms / (HOUR_MS / 10)) / 10; // 1-decimal hours
  return `${h}h`;
}

export function chartScaleMs(perDay: KindMs[]): number {
  return Math.max(8 * HOUR_MS, ...perDay.map((d) => d.task + d.meeting + d.habit));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/stats/statsModel.test.ts`
Expected: PASS. (Note `formatHours` uses `Math.round(ms/360000)/10`; `34h`→340/10, `21.5h`→215/10, `0`→0.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/stats/statsModel.ts packages/web/src/app/stats/statsModel.test.ts
git commit -m "feat(web): statsModel — week bucketing, summary, completion, donut segments"
```

---

## Task 2: Stats components (StatCard, HoursByDayChart, TimeSplitDonut)

**Files:**
- Create: `src/app/stats/StatCard.tsx`, `src/app/stats/HoursByDayChart.tsx`, `src/app/stats/TimeSplitDonut.tsx`
- Create: `src/app/stats/StatsComponents.test.tsx`

- [ ] **Step 1: Implement `src/app/stats/StatCard.tsx`**

```tsx
export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div data-testid="stat-card" className="flex-1 rounded-[14px] border border-line bg-card p-5 shadow-card">
      <div className="text-[14.5px] font-bold text-inkSoft">{label}</div>
      <div className={`mt-1.5 text-[36px] font-extrabold leading-none ${accent}`}>{value}</div>
      <div className="mt-1 text-[14px] text-inkSoft">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/app/stats/HoursByDayChart.tsx`**

```tsx
import { type KindMs, type DonutKind, chartScaleMs } from './statsModel';

const KIND_BG: Record<DonutKind, string> = {
  task: 'bg-kind-taskBar',
  meeting: 'bg-kind-meetingBar',
  habit: 'bg-kind-habitBar',
};

export function HoursByDayChart({ perDay, dayLabels }: { perDay: KindMs[]; dayLabels: string[] }) {
  const scale = chartScaleMs(perDay);
  return (
    <div data-testid="hours-by-day" className="flex-[2] rounded-[14px] border border-line bg-card p-6">
      <div className="mb-5 text-[17px] font-bold text-ink">Hours by day</div>
      <div className="flex h-[220px] items-end gap-4">
        {perDay.map((d, i) => {
          const stack = ([
            { kind: 'task' as const, ms: d.task },
            { kind: 'meeting' as const, ms: d.meeting },
            { kind: 'habit' as const, ms: d.habit },
          ]).filter((s) => s.ms > 0);
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-[200px] w-[34px] flex-col justify-end gap-0.5">
                {stack.map((s, j) => (
                  <div
                    key={s.kind}
                    data-testid="bar"
                    data-kind={s.kind}
                    className={`${KIND_BG[s.kind]} ${j === 0 ? 'rounded-t-[3px]' : ''}`}
                    style={{ height: `${(s.ms / scale) * 200}px` }}
                  />
                ))}
              </div>
              <span className="text-[13px] font-semibold text-inkSoft">{dayLabels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/app/stats/TimeSplitDonut.tsx`**

```tsx
import { type DonutKind, type DonutSegment, formatHours } from './statsModel';

const KIND_HEX: Record<DonutKind, string> = { task: '#f2700f', meeting: '#e5484d', habit: '#2fa45f' };
const KIND_DOT: Record<DonutKind, string> = {
  task: 'bg-kind-taskBar',
  meeting: 'bg-kind-meetingBar',
  habit: 'bg-kind-habitBar',
};

export function TimeSplitDonut({ segments, totalMs }: { segments: DonutSegment[]; totalMs: number }) {
  return (
    <div data-testid="time-split" className="flex-1 rounded-[14px] border border-line bg-card p-6">
      <div className="mb-4 text-[17px] font-bold text-ink">Time split</div>
      {segments.length === 0 ? (
        <p className="py-8 text-center text-inkSoft">No scheduled time yet</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div
              className="flex h-[150px] w-[150px] items-center justify-center rounded-full"
              style={{ background: `conic-gradient(${segments.map((s) => `${KIND_HEX[s.kind]} ${s.fromPct}% ${s.toPct}%`).join(', ')})` }}
            >
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-card">
                <span className="text-[26px] font-extrabold text-ink">{formatHours(totalMs)}</span>
                <span className="text-[12px] text-inkSoft">total</span>
              </div>
            </div>
          </div>
          <div>
            {segments.map((s) => (
              <div key={s.kind} className="flex items-center gap-2.5 py-1">
                <span className={`h-[11px] w-[11px] rounded-[3px] ${KIND_DOT[s.kind]}`} />
                <span className="flex-1 text-[14.5px] font-semibold capitalize text-ink">{s.kind}</span>
                <span className="text-[14.5px] font-bold text-inkSoft">{formatHours(s.ms)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the test `src/app/stats/StatsComponents.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';
import { HoursByDayChart } from './HoursByDayChart';
import { TimeSplitDonut } from './TimeSplitDonut';
import { HOUR_MS, type KindMs, type DonutSegment } from './statsModel';

describe('StatCard', () => {
  it('renders label, value, sub and the accent class', () => {
    render(<StatCard label="Total scheduled" value="34h" sub="this week" accent="text-indigo" />);
    const card = screen.getByTestId('stat-card');
    expect(card).toHaveTextContent('Total scheduled');
    expect(card).toHaveTextContent('34h');
    expect(card).toHaveTextContent('this week');
    expect(card.querySelector('.text-indigo')).not.toBeNull();
  });
});

describe('HoursByDayChart', () => {
  it('renders 7 day labels and scales a busy day bar to px height', () => {
    const perDay: KindMs[] = Array.from({ length: 7 }, () => ({ task: 0, meeting: 0, habit: 0 }));
    perDay[0] = { task: 4 * HOUR_MS, meeting: 0, habit: 0 }; // 4h on a max(8h) scale → 100px
    render(<HoursByDayChart perDay={perDay} dayLabels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} />);
    expect(screen.getByTestId('hours-by-day')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
    const bars = screen.getAllByTestId('bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute('data-kind', 'task');
    expect(bars[0]!.style.height).toBe('100px');
  });
});

describe('TimeSplitDonut', () => {
  it('renders the legend hours and center total', () => {
    const segments: DonutSegment[] = [
      { kind: 'task', ms: 2 * HOUR_MS, fromPct: 0, toPct: 50 },
      { kind: 'meeting', ms: HOUR_MS, fromPct: 50, toPct: 75 },
      { kind: 'habit', ms: HOUR_MS, fromPct: 75, toPct: 100 },
    ];
    render(<TimeSplitDonut segments={segments} totalMs={4 * HOUR_MS} />);
    expect(screen.getByText('task')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument(); // center total
  });

  it('shows an empty message when there are no segments', () => {
    render(<TimeSplitDonut segments={[]} totalMs={0} />);
    expect(screen.getByText(/no scheduled time yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the components test**

Run: `npm test -w @notreclaim/web -- src/app/stats/StatsComponents.test.tsx`
Expected: PASS (4 tests). (Bar height: `(4h / 8h) * 200 = 100` → `'100px'`.)

- [ ] **Step 6: Run the full web suite + build**

Run: `npm test -w @notreclaim/web` → expect ALL PASS.
Run: `npm run build -w @notreclaim/web` → expect success.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/stats/StatCard.tsx packages/web/src/app/stats/HoursByDayChart.tsx \
  packages/web/src/app/stats/TimeSplitDonut.tsx packages/web/src/app/stats/StatsComponents.test.tsx
git commit -m "feat(web): Stats cards, hours-by-day bar chart, time-split donut"
```

---

## Task 3: `Stats` page + routing swap + retire placeholder + verification

**Files:**
- Create: `src/app/pages/Stats.tsx`, `src/app/pages/Stats.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/App.test.tsx`
- Delete: `src/app/pages/StatsPlaceholder.tsx`

- [ ] **Step 1: Write the failing test `src/app/pages/Stats.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Stats } from './Stats';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'x', priority: 2, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  category: null, status: 'pending', timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const populatedPreview: SchedulePreview = {
  blocks: [
    { id: 'p1', sourceType: 'task', sourceId: 't1', title: 'A', start: Date.parse('2026-01-07T13:00:00.000Z'), end: Date.parse('2026-01-07T15:00:00.000Z') },
    { id: 'p2', sourceType: 'habit', sourceId: 'h1', title: 'B', start: Date.parse('2026-01-05T08:00:00.000Z'), end: Date.parse('2026-01-05T09:00:00.000Z') },
  ],
  unscheduled: [],
};

function api(over = {}) {
  return fakeApiClient({
    getSchedulePreview: vi.fn(async () => populatedPreview),
    getCalendarEvents: vi.fn(async () => []),
    listTasks: vi.fn(async () => [task({ status: 'completed' }), task({ id: 't2', status: 'pending' })]),
    ...over,
  } as never);
}

describe('Stats page', () => {
  it('renders summary cards and charts from the proposed plan', async () => {
    renderWithProviders(<Stats now={() => NOW} />, { api: api() });
    await waitFor(() => expect(screen.getByText('Total scheduled')).toBeInTheDocument());
    expect(screen.getByText('Task time')).toBeInTheDocument();
    expect(screen.getByText('Tasks done')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument(); // one completed of two active
    expect(screen.getByTestId('hours-by-day')).toBeInTheDocument();
    expect(screen.getByTestId('time-split')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is scheduled and no tasks exist', async () => {
    const empty = api({
      getSchedulePreview: vi.fn(async () => ({ blocks: [], unscheduled: [] })),
      listTasks: vi.fn(async () => []),
    });
    renderWithProviders(<Stats now={() => NOW} />, { api: empty });
    await waitFor(() => expect(screen.getByText(/nothing scheduled yet/i)).toBeInTheDocument());
    expect(screen.queryByText('Total scheduled')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -w @notreclaim/web -- src/app/pages/Stats.test.tsx`
Expected: FAIL (module `./Stats` not found).

- [ ] **Step 3: Implement `src/app/pages/Stats.tsx`**

```tsx
import { useMemo } from 'react';
import { useSchedulePreviewQuery, useCalendarEventsQuery, useTasksQuery } from '../../api/queries';
import { startOfWeek, dayColumns, addWeeks } from '../planner/weekModel';
import {
  hoursByDay, summary, meetingCount, taskCompletion, donutSegments, formatHours,
} from '../stats/statsModel';
import { StatCard } from '../stats/StatCard';
import { HoursByDayChart } from '../stats/HoursByDayChart';
import { TimeSplitDonut } from '../stats/TimeSplitDonut';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Stats({ now = () => Date.now() }: { now?: () => number }) {
  const weekStartMs = startOfWeek(now());
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(addWeeks(weekStartMs, 1)).toISOString();

  const preview = useSchedulePreviewQuery();
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const tasksQ = useTasksQuery();

  const isLoading = preview.isLoading || calendar.isLoading || tasksQ.isLoading;
  const isError = preview.isError || calendar.isError || tasksQ.isError;

  const perDay = useMemo(() => hoursByDay(days, preview.data, calendar.data ?? []), [days, preview.data, calendar.data]);
  const sum = useMemo(() => summary(perDay), [perDay]);
  const mc = meetingCount(days, calendar.data ?? []);
  const comp = taskCompletion(tasksQ.data ?? []);
  const segs = donutSegments(sum);

  if (isError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-crit">Couldn't load your stats.</p>
        <button
          type="button"
          onClick={() => { void preview.refetch(); void calendar.refetch(); void tasksQ.refetch(); }}
          className="rounded border border-line px-3 py-1"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="px-[30px] pt-4 text-sm text-inkSoft">Loading…</div>;
  }

  if (sum.totalMs === 0 && comp.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-inkSoft">
        <div className="text-[19px] font-bold">Nothing scheduled yet</div>
        <div className="text-[15px]">Add tasks or habits and they'll show up here.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px] px-[30px] pb-10 pt-1">
      <div className="flex gap-[18px]">
        <StatCard label="Total scheduled" value={formatHours(sum.totalMs)} sub="this week" accent="text-indigo" />
        <StatCard label="Task time" value={formatHours(sum.taskMs)} sub="auto-scheduled" accent="text-kind-taskText" />
        <StatCard label="In meetings" value={formatHours(sum.meetingMs)} sub={`${mc} events`} accent="text-crit" />
        <StatCard label="Tasks done" value={`${comp.done} / ${comp.total}`} sub={`${comp.pct}% complete`} accent="text-low" />
      </div>
      <div className="flex items-stretch gap-[18px]">
        <HoursByDayChart perDay={perDay} dayLabels={DAY_LABELS} />
        <TimeSplitDonut segments={segs} totalMs={sum.totalMs} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the Stats page test**

Run: `npm test -w @notreclaim/web -- src/app/pages/Stats.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Swap the route in `src/app/App.tsx`**

Replace the `StatsPlaceholder` import with `Stats`:
```tsx
import { Stats } from './pages/Stats';
```
(remove `import { StatsPlaceholder } from './pages/StatsPlaceholder';`)

And the route element:
```tsx
          <Route path="/stats" element={<Stats />} />
```

- [ ] **Step 6: Delete the placeholder**

```bash
git rm packages/web/src/app/pages/StatsPlaceholder.tsx
```

- [ ] **Step 7: Update the `/stats` test in `src/app/App.test.tsx`**

Replace the `'shows the Stats placeholder at /stats'` test with:
```tsx
  it('renders the Stats dashboard at /stats', async () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    const api = fakeApiClient({
      getSchedule: async () => [],
      getCalendarEvents: async () => [],
      getSchedulePreview: async () => ({ blocks: [], unscheduled: [] }),
      listTasks: async () => [{
        id: 't1', userId: 'u1', title: 'x', priority: 2, durationMs: 3_600_000,
        dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
        category: null, status: 'pending', timeLoggedMs: 0,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      listHabits: async () => [],
    } as never);
    renderWithProviders(<App />, { initialEntries: ['/stats'], api });
    expect(await screen.findByText(/total scheduled/i)).toBeInTheDocument();
  });
```
(The single task makes `comp.total > 0`, so the dashboard renders instead of the empty state. Leave the other App tests unchanged; `screen` is already imported.)

- [ ] **Step 8: Verify nothing still imports the placeholder**

Run: `grep -rn "StatsPlaceholder" packages/web/src` → expect NO results.

- [ ] **Step 9: Run the full web suite + build**

Run: `npm test -w @notreclaim/web` → expect ALL PASS.
Run: `npm run build -w @notreclaim/web` → expect success.

- [ ] **Step 10: Run the whole monorepo suite** (Postgres up for `@notreclaim/db`; start only if needed:
`/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start`)

```bash
npm test -w @notreclaim/core
npm test -w @notreclaim/scheduler
npm test -w @notreclaim/google
npm test -w @notreclaim/db
npm test -w @notreclaim/server
npm test -w @notreclaim/web
```
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/app/pages/Stats.tsx packages/web/src/app/pages/Stats.test.tsx \
  packages/web/src/app/App.tsx packages/web/src/app/App.test.tsx
git commit -m "feat(web): Stats dashboard page at /stats, retire placeholder"
```

---

## Notes for the implementer

- **Do NOT modify `weekModel.ts`** or any planner file. Reuse `startOfWeek`/`dayColumns`/`addWeeks`/`MS_PER_DAY`.
- Permitted inline `style`s: the conic-gradient donut background and the chart bar `height` px — nothing else (everything else is Tailwind utilities).
- `KIND_HEX` in the donut uses real hex (`#f2700f`/`#e5484d`/`#2fa45f`) because `conic-gradient` needs real colors, not Tailwind classes. Keep these as literal strings; the `KIND_BG`/`KIND_DOT` records are literal Tailwind classes for the JIT.
- The `/stats` App test MUST provide at least one task (shown above) or it hits the empty state and the assertion fails.
- Stage only the files listed per task; never stage `seed-dev.mjs`, `.env.run`, `design_handoff_notreclaim/`, `review/`, `.claude/`.
```
