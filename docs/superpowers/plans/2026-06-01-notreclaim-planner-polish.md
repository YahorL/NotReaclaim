# Planner Polish (Review 1, Milestone A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the now-redundant Proposed overlay and restyle Planner blocks by state (meetings blue; locked task/habit green + 🔒; movable task/habit transparent + dashed green).

**Architecture:** Web-only, and intentionally **one cohesive task** — `EventBlock`'s `proposed` prop, `WeekGrid`'s proposed plumbing, `Planner`'s dedupe, and the three test files are all coupled around removing `proposed`; splitting them would leave a non-compiling intermediate. `EventBlock` styles by `(kind, pinned)`. `weekModel`, engine, DB, server are untouched; the schedule-preview query stays for the At-risk panel.

**Tech Stack:** React 18 + Vite + Tailwind v3 + Vitest + @testing-library/react@16 + jsdom (`TZ=UTC`).

**Conventions:** `packages/web` imports EXTENSIONLESS; NEVER `import React` (`useMemo`/`useState` from 'react' OK); Tailwind utility classes (literal strings for the JIT). Run: `npm test -w @notreclaim/web -- <path>`; build `npm run build -w @notreclaim/web`. All paths under `packages/web/`. Stage only the listed files; never `seed-dev.mjs`/`.env.run`/`design_handoff_notreclaim`/`review`/`.claude`.

---

## File Structure
- Modify `tailwind.config.js` (add `event` blue token).
- Modify `src/app/planner/EventBlock.tsx` + `EventBlock.test.tsx`.
- Modify `src/app/planner/WeekGrid.tsx` + `WeekGrid.test.tsx`.
- Modify `src/app/pages/Planner.tsx` + `Planner.test.tsx`.
- Untouched: `weekModel*`, `AtRiskPanel*`, everything outside `packages/web`.

---

## Task 1: Remove Proposed + state-based block styling (single cohesive change)

Do the edits in this order, then run the full suite once at the end (the change is a coupled refactor; per-file red-first isn't meaningful across the cross-file `proposed` removal).

- [ ] **Step 1: Add the blue `event` token to `tailwind.config.js`.** In `theme.extend.colors`, add a top-level `event` color immediately after `low: '#2fa45f',`:

```js
        low: '#2fa45f',
        event: '#4285f4',
```
(Everything else, including the `kind` palette, unchanged.)

- [ ] **Step 2: Replace `src/app/planner/EventBlock.tsx`**

```tsx
export type BlockKind = 'meeting' | 'task' | 'habit';

const BASE = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';

/** Color by state, Google-Calendar-style: meeting=blue, locked task/habit=green+lock, movable=transparent dashed green. */
function variantClass(kind: BlockKind, pinned: boolean): string {
  if (kind === 'meeting') return 'bg-event text-white';
  if (pinned) return 'bg-low text-white';
  return 'border border-dashed border-low bg-transparent text-kind-habitText';
}

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false }: EventBlockProps) {
  const locked = kind !== 'meeting' && pinned;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      className={`${BASE} ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      {locked && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
```

- [ ] **Step 3: Replace `src/app/planner/EventBlock.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBlock } from './EventBlock';

describe('EventBlock', () => {
  it('renders title, kind, and position', () => {
    render(<EventBlock title="Standup" kind="meeting" topPct={10} heightPct={5} startLabel="10:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveTextContent('Standup');
    expect(el).toHaveAttribute('data-kind', 'meeting');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.style.top).toBe('10%');
    expect(el.style.height).toBe('5%');
  });

  it('renders a meeting as a solid blue block', () => {
    render(<EventBlock title="Standup" kind="meeting" topPct={0} heightPct={5} startLabel="10:00" />);
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('bg-event');
    expect(el.className).toContain('text-white');
    expect(el).not.toHaveTextContent('🔒');
  });

  it('renders a locked (pinned) task as solid green with a lock', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'true');
    expect(el.className).toContain('bg-low');
    expect(el.className).toContain('text-white');
    expect(el).toHaveTextContent('🔒');
    expect(el.className).not.toContain('border-dashed');
  });

  it('renders a movable (unpinned) task as transparent with a dashed green outline', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.className).toContain('border-dashed');
    expect(el.className).toContain('border-low');
    expect(el.className).not.toContain('text-white');
    expect(el).not.toHaveTextContent('🔒');
  });

  it('a movable habit uses the same scheme as a task', () => {
    render(<EventBlock title="Workout" kind="habit" topPct={0} heightPct={5} startLabel="08:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'habit');
    expect(el.className).toContain('border-dashed');
    expect(el.className).toContain('border-low');
  });
});
```

- [ ] **Step 4: Replace `src/app/planner/WeekGrid.tsx`** (drop `proposed`/`useState`/toggle/`fromProposed`; state-based legend; `EventBlock` without `proposed`)

```tsx
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY } from './weekModel';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 06:00 → 21:00 row starts (06:00–22:00 window)

const LEGEND: { label: string; swatch: string }[] = [
  { label: 'Meeting', swatch: 'bg-event' },
  { label: 'Locked 🔒', swatch: 'bg-low' },
  { label: 'Movable', swatch: 'border border-dashed border-low' },
];

function hourLabel(h: number): string {
  const period = h < 12 ? 'a' : 'p';
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${period}`;
}

export interface WeekGridProps {
  days: number[];            // 7 local-midnight timestamps
  nowMs: number;
  weekLabel: string;
  blocks: ScheduledBlock[];
  events: CalendarEvent[];
  replanPending: boolean;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onReplan: () => void;
}

interface Item {
  key: string;
  title: string;
  kind: BlockKind;
  pinned: boolean;
  startMs: number;
  endMs: number;
  startLabel: string;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toItems(blocks: ScheduledBlock[], events: CalendarEvent[]): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned,
      startMs, endMs: Date.parse(b.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: 'meeting', pinned: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: timeLabel(startMs) };
  });
  return [...fromEvents, ...fromBlocks];
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, replanPending, onPrev, onToday, onNext, onReplan } = props;
  const items = toItems(blocks, events);

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Previous week" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">‹</button>
          <button onClick={onNext} aria-label="Next week" className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-card text-[20px] text-inkSoft">›</button>
        </div>
        <span className="text-[18px] font-bold text-ink">{weekLabel}</span>
        <button onClick={onToday} className="rounded-[9px] px-4 py-2 text-[14.5px] font-bold text-indigo hover:bg-indigoSoft">Today</button>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded-[9px] bg-indigo px-3 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
        <div className="ml-2 flex items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[14px] font-semibold text-inkSoft">
              <span className={`h-[11px] w-[11px] rounded-[3px] ${l.swatch}`} /> {l.label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[820px] overflow-hidden rounded-[14px] border border-line bg-card">
          {/* header grid */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-line">
            <div />
            {days.map((d, i) => {
              const today = isToday(nowMs, d);
              const date = new Date(d).getDate();
              return (
                <div
                  key={d}
                  data-testid={`day-header-${i}`}
                  data-today={today}
                  className="border-l border-line py-3 text-center"
                >
                  <div className="text-[13px] font-bold uppercase tracking-wide text-inkSoft">{DAY_LABELS[i]}</div>
                  <div className="mt-0.5 text-[21px] font-extrabold">
                    {today
                      ? <span className="rounded-[9px] bg-indigo px-[9px] py-[1px] text-white">{date}</span>
                      : <span className="text-ink">{date}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* body grid */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)]">
            <div>
              {HOURS.map((h) => (
                <div key={h} className="relative h-[58px]">
                  <span className="absolute right-[10px] -top-[8px] text-[12px] font-semibold text-[#a6aab8]">{hourLabel(h)}</span>
                </div>
              ))}
            </div>
            {days.map((d, i) => {
              const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
              const line = nowLine(nowMs, d);
              return (
                <div key={d} data-testid={`day-col-${i}`} className="relative border-l border-line">
                  {HOURS.map((h) => <div key={h} className="h-[58px] border-t border-[#f1f2f6]" />)}
                  {dayItems.map((it) => {
                    const pos = placeInDay(it.startMs, it.endMs, d);
                    if (!pos) return null;
                    return (
                      <EventBlock
                        key={it.key}
                        title={it.title}
                        kind={it.kind}
                        pinned={it.pinned}
                        topPct={pos.topPct}
                        heightPct={pos.heightPct}
                        startLabel={it.startLabel}
                      />
                    );
                  })}
                  {line != null && (
                    <div data-testid="now-line" className="absolute left-0 right-0 h-0.5 bg-crit" style={{ top: `${line}%` }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update `src/app/planner/WeekGrid.test.tsx`**
  - Change the import on line 3 to: `import type { ScheduledBlock, CalendarEvent } from '../../api/types';` (drop `PreviewBlock`).
  - Delete the entire last test: `it('renders proposed blocks as ghosts by default and the toggle hides them', …)`.
  - Leave the `renderGrid` helper and all other tests unchanged (the helper never set `proposed`).

- [ ] **Step 6: Replace `src/app/pages/Planner.tsx`** (drop the dedupe memos + comment + the `proposed` prop)

```tsx
import { useMemo, useState } from 'react';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation } from '../../api/queries';
import { startOfWeek, dayColumns, addWeeks } from '../planner/weekModel';
import { WeekGrid } from '../planner/WeekGrid';
import { AtRiskPanel } from '../planner/AtRiskPanel';

function weekLabel(days: number[]): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(days[0]!)} – ${fmt(days[6]!)}`;
}

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const [weekStartMs, setWeekStartMs] = useState(() => startOfWeek(nowMs));
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(addWeeks(weekStartMs, 1)).toISOString();

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const replan = useReplanMutation();

  const isLoading = schedule.isLoading || calendar.isLoading || preview.isLoading;
  const isError = schedule.isError || calendar.isError || preview.isError;

  if (isError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn't load the schedule.</p>
        <button
          onClick={() => { void schedule.refetch(); void calendar.refetch(); void preview.refetch(); }}
          className="rounded border border-gray-300 px-3 py-1"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your week…</div>}
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days)}
          blocks={schedule.data ?? []}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setWeekStartMs((ms) => addWeeks(ms, -1))}
          onNext={() => setWeekStartMs((ms) => addWeeks(ms, 1))}
          onToday={() => setWeekStartMs(startOfWeek(now()))}
          onReplan={() => replan.mutate()}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      <AtRiskPanel items={preview.data?.unscheduled ?? []} />
    </div>
  );
}
```

- [ ] **Step 7: Update `src/app/pages/Planner.test.tsx`**
  - Change the import on line 3 to: `import type { ScheduledBlock, CalendarEvent, SchedulePreview } from '../../api/types';` (drop `PreviewBlock`).
  - Delete the entire test `it('shows proposed blocks on the grid by default and the Proposed toggle hides them', …)`.
  - Delete the entire test `it('does not draw a proposed ghost for a block already committed (same engineKey)', …)`.
  - Keep `'renders blocks, meetings, and at-risk items'`, `'clicking Re-plan calls api.replan'`, and `'navigating to the next week refetches with a new range'` unchanged.

- [ ] **Step 8: Confirm no dangling references**

Run: `grep -rn "proposed\|toggle-proposed\|data-proposed\|proposedGhosts\|committedKeys" packages/web/src`
Expected: NO results.

- [ ] **Step 9: Run the touched files, full web suite, and build**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx` → PASS.
Run: `npm test -w @notreclaim/web` → ALL PASS.
Run: `npm run build -w @notreclaim/web` → clean.

- [ ] **Step 10: Commit**

```bash
git add packages/web/tailwind.config.js \
  packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/EventBlock.test.tsx \
  packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx \
  packages/web/src/app/pages/Planner.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): remove Proposed overlay; Google-Calendar-style blocks (blue/green+lock/dashed)"
```

---

## Task 2: full verification

- [ ] **Step 1: Run the whole monorepo suite + web build** (web-only change; the others should be unaffected — confirm no surprise):

```bash
npm test -w @notreclaim/scheduler
npm test -w @notreclaim/core
npm test -w @notreclaim/google
npm test -w @notreclaim/db
npm test -w @notreclaim/server
npm test -w @notreclaim/web
npm run build -w @notreclaim/web
```
(Postgres up for `@notreclaim/db`; start only if needed:
`/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start`.)
Expected: all PASS, build clean. Report per-package counts.

---

## Notes for the implementer
- `weekModel.ts` and `AtRiskPanel.tsx` are NOT touched. `useSchedulePreviewQuery` stays (At-risk panel + loading/error gate).
- The `event` token (`#4285f4`) is top-level → `bg-event` available; only `bg-event` is used.
- All block classes are literal strings (JIT). 🔒 renders only for `kind !== 'meeting' && pinned`.
- This is one coupled change — do all the file edits, then run the suite once (Step 9). Do not commit a partial state.
- Stage only the 7 files listed in Task 1 Step 10.
