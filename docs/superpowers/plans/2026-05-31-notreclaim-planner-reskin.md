# Planner Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the existing Planner week-view to the design handoff (kind-tinted event blocks, white calendar card with 58px/hour rows, day-header indigo pill, legend) without changing any behavior.

**Architecture:** Purely presentational. `weekModel.ts` is untouched — `placeInDay`/`nowLine` already return top/height **percentages**, so the 06:00–22:00 window and positioning math stay fixed. Only `EventBlock.tsx`, `WeekGrid.tsx`, and `AtRiskPanel.tsx` (and their tests) change. Every `data-testid` and `data-*` attribute is preserved; only presentational test assertions update.

**Tech Stack:** React 18 + Vite 5 + Tailwind v3 + Vitest + @testing-library/react@16 + jsdom (`TZ=UTC`).

**Conventions (every task):** TS ESM strict, `noUncheckedIndexedAccess`. Imports **extensionless**; **never** `import React` (`import { useState } from 'react'` is fine). Tailwind utility classes only (arbitrary values like `h-[58px]`, `border-l-[#f59e0b]` allowed). Tests use `fakeApiClient(overrides as never)` + `renderWithProviders` from `src/test/fakes`; no real network. All paths under `packages/web/`. **Per-task run:** `npm test -w @notreclaim/web -- <path>`. Build: `npm run build -w @notreclaim/web`.

**Kind palette tokens** (already in `tailwind.config.js`, usable as Tailwind classes): `bg-kind-meetingBg`/`text-kind-meetingText`/`border-l-kind-meetingBar` (red); `…-taskBg/…-taskText/…-taskBar` (orange); `…-habitBg/…-habitText/…-habitBar` (green). Other tokens: `indigo`, `indigoSoft`, `line`, `card`, `ink`, `inkSoft`, `crit`, `bg`. The handoff's **Focus kind is dropped**.

---

## File Structure

- Modify: `src/app/planner/EventBlock.tsx` + `EventBlock.test.tsx` (Task 1)
- Modify: `src/app/planner/WeekGrid.tsx` + `WeekGrid.test.tsx`; `src/app/pages/Planner.test.tsx` (button-name updates) (Task 2)
- Modify: `src/app/planner/AtRiskPanel.tsx` (Task 3)
- **Untouched:** `weekModel.ts`/`weekModel.test.ts`, `Planner.tsx` (already passes the right props), `AtRiskPanel.test.tsx` (asserts only testids + text, both preserved).

---

## Task 1: EventBlock re-skin (kind tint + 3px bar + dark text)

**Files:**
- Modify: `src/app/planner/EventBlock.tsx`
- Modify: `src/app/planner/EventBlock.test.tsx`

- [ ] **Step 1: Update the test `src/app/planner/EventBlock.test.tsx`** (these are the new presentational expectations; keep behavioral assertions)

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

  it('marks pinned blocks with an amber left bar', () => {
    render(<EventBlock title="Review" kind="task" pinned topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'true');
    expect(el.className).toContain('border-l-[#f59e0b]');
  });

  it('renders a proposed block as a dashed ghost', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={10} heightPct={5} startLabel="13:00" proposed />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'true');
    expect(el).toHaveAttribute('data-kind', 'task');
    expect(el.className).toContain('border-dashed');
  });

  it('a committed task block is solid: kind tint + kind bar, dark text, no dashed border', () => {
    render(<EventBlock title="Write spec" kind="task" topPct={0} heightPct={5} startLabel="13:00" />);
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-proposed', 'false');
    expect(el.className).not.toContain('border-dashed');
    expect(el.className).toContain('text-kind-taskText');
    expect(el.className).toContain('bg-kind-taskBg');
    expect(el.className).toContain('border-l-kind-taskBar');
    expect(el.className).not.toContain('text-white');
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: FAIL (current EventBlock uses `text-white`/`bg-slate-400`, not the kind classes).

- [ ] **Step 3: Rewrite `src/app/planner/EventBlock.tsx`**

```tsx
export type BlockKind = 'meeting' | 'task' | 'habit';

// Literal class strings so Tailwind's content scanner emits them.
const KIND_SOLID: Record<BlockKind, string> = {
  meeting: 'bg-kind-meetingBg text-kind-meetingText',
  task: 'bg-kind-taskBg text-kind-taskText',
  habit: 'bg-kind-habitBg text-kind-habitText',
};

const KIND_BAR: Record<BlockKind, string> = {
  meeting: 'border-l-kind-meetingBar',
  task: 'border-l-kind-taskBar',
  habit: 'border-l-kind-habitBar',
};

const KIND_PROPOSED: Record<BlockKind, string> = {
  meeting: 'border border-dashed border-kind-meetingBar bg-kind-meetingBg/60 text-kind-meetingText',
  task: 'border border-dashed border-kind-taskBar bg-kind-taskBg/60 text-kind-taskText',
  habit: 'border border-dashed border-kind-habitBar bg-kind-habitBg/60 text-kind-habitText',
};

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
  proposed?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false, proposed = false }: EventBlockProps) {
  const base = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';
  const variant = proposed
    ? KIND_PROPOSED[kind]
    : `border-l-[3px] ${KIND_SOLID[kind]} ${pinned ? 'border-l-[#f59e0b]' : KIND_BAR[kind]}`;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      data-proposed={proposed}
      title={`${startLabel} ${title}`}
      className={`${base} ${variant}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/planner/EventBlock.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/EventBlock.tsx packages/web/src/app/planner/EventBlock.test.tsx
git commit -m "feat(web): re-skin EventBlock to kind palette (tint + 3px bar + dark text)"
```

---

## Task 2: WeekGrid re-skin (header strip, white card, day-header pill, 58px/hr rows)

**Files:**
- Modify: `src/app/planner/WeekGrid.tsx`
- Modify: `src/app/planner/WeekGrid.test.tsx`
- Modify: `src/app/pages/Planner.test.tsx`

- [ ] **Step 1: Update `src/app/planner/WeekGrid.test.tsx` nav-button lookups**

In the `'fires nav callbacks'` test, change the two prev/next button lookups (leave Today as-is):

```tsx
  it('fires nav callbacks', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
    renderGrid({ onPrev, onNext, onToday });
    fireEvent.click(screen.getByRole('button', { name: /previous week/i }));
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });
```

Leave every other test in this file unchanged (event-block placement, `highlights today` → `day-header-2` `data-today`, `now-line`, `/re-plan/i`, the `toggle-proposed` show/hide test).

- [ ] **Step 2: Update `src/app/pages/Planner.test.tsx` next-week button lookups**

There are two `screen.getByRole('button', { name: '▶' })` calls (in the `'navigating to the next week refetches…'` test). Change both to:

```tsx
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
```

Leave all other assertions (`Write spec`, `Standup`, `Tax filing`, `/re-plan/i`, `toggle-proposed`) unchanged.

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx`
Expected: FAIL (the current WeekGrid renders `◀`/`▶` buttons, so `/previous week/i` / `/next week/i` don't match yet).

- [ ] **Step 4: Rewrite `src/app/planner/WeekGrid.tsx`**

```tsx
import { useState } from 'react';
import type { ScheduledBlock, CalendarEvent, PreviewBlock } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY } from './weekModel';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 06:00 → 21:00 row starts (06:00–22:00 window)

const LEGEND: { label: string; swatch: string }[] = [
  { label: 'Meeting', swatch: 'bg-kind-meetingBar' },
  { label: 'Habit', swatch: 'bg-kind-habitBar' },
  { label: 'Task', swatch: 'bg-kind-taskBar' },
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
  proposed?: PreviewBlock[];
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
  proposed: boolean;
  startMs: number;
  endMs: number;
  startLabel: string;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toItems(blocks: ScheduledBlock[], events: CalendarEvent[], proposed: PreviewBlock[]): Item[] {
  const fromBlocks = blocks.map((b): Item => {
    const cls = classifyBlock(b);
    const startMs = Date.parse(b.startsAt);
    return { key: `b:${b.id}`, title: b.title, kind: cls.kind, pinned: cls.pinned, proposed: false,
      startMs, endMs: Date.parse(b.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromEvents = events.map((e): Item => {
    const startMs = Date.parse(e.startsAt);
    return { key: `e:${e.id}`, title: e.title, kind: 'meeting', pinned: false, proposed: false,
      startMs, endMs: Date.parse(e.endsAt), startLabel: timeLabel(startMs) };
  });
  const fromProposed = proposed.map((b): Item => ({
    key: `p:${b.id}`, title: b.title, kind: b.sourceType, pinned: false, proposed: true,
    startMs: b.start, endMs: b.end, startLabel: timeLabel(b.start),
  }));
  return [...fromEvents, ...fromBlocks, ...fromProposed];
}

export function WeekGrid(props: WeekGridProps) {
  const { days, nowMs, weekLabel, blocks, events, proposed = [], replanPending, onPrev, onToday, onNext, onReplan } = props;
  const [showProposed, setShowProposed] = useState(true);
  const items = toItems(blocks, events, showProposed ? proposed : []);

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
          data-testid="toggle-proposed"
          aria-pressed={showProposed}
          onClick={() => setShowProposed((v) => !v)}
          className={`rounded-[9px] px-3 py-2 text-[14px] font-bold ${showProposed ? 'bg-indigoSoft text-indigo' : 'text-inkSoft hover:bg-bg'}`}
        >
          Proposed
        </button>
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
                        proposed={it.proposed}
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

- [ ] **Step 5: Run the two test files to verify they pass**

Run: `npm test -w @notreclaim/web -- src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx`
Expected: PASS (WeekGrid 6 tests, Planner 4 tests).

Note: the now-line position % is unchanged (`nowLine` is untouched); the day column's height now comes from the 16×58px rows, and `placeInDay`/`nowLine` percentages position relative to that column height exactly as before.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): re-skin WeekGrid header/legend/day-headers + 58px-hour calendar card"
```

---

## Task 3: AtRiskPanel restyle + full verification

**Files:**
- Modify: `src/app/planner/AtRiskPanel.tsx`

- [ ] **Step 1: Rewrite `src/app/planner/AtRiskPanel.tsx`** (restyle only — props, `data-testid`, text, and `humanizeMs`/" unplaced" suffix all preserved)

```tsx
import type { UnscheduledItem } from '../../api/types';
import { humanizeMs } from './weekModel';

export function AtRiskPanel({ items }: { items: UnscheduledItem[] }) {
  return (
    <aside className="w-44 shrink-0 rounded-xl border border-line bg-card p-3 text-xs shadow-card">
      <h3 className="mb-2 font-semibold text-ink">⚠ At-risk ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-inkSoft">Nothing at risk.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={`${it.sourceType}:${it.sourceId}`}
              data-testid="at-risk-item"
              className="rounded border-l-2 border-crit bg-crit/10 px-2 py-1"
            >
              <div className="font-medium text-ink">{it.title}</div>
              <div className="text-[11px] text-crit">{it.reason}</div>
              <div className="text-[11px] text-inkSoft">{humanizeMs(it.remainingMs)} unplaced</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Run the AtRiskPanel + Planner tests**

Run: `npm test -w @notreclaim/web -- src/app/planner/AtRiskPanel.test.tsx src/app/pages/Planner.test.tsx`
Expected: PASS (AtRiskPanel.test asserts only testids + text — `Tax filing`, `1h 30m unplaced`, `2h unplaced`, `Nothing at risk.` — all preserved).

- [ ] **Step 3: Run the full web suite + build**

Run: `npm test -w @notreclaim/web`
Expected: ALL PASS.

Run: `npm run build -w @notreclaim/web`
Expected: build succeeds (typechecks tests too).

- [ ] **Step 4: Run the whole monorepo suite** (Postgres must be up for `@notreclaim/db`; start it only if needed:
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

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/planner/AtRiskPanel.tsx
git commit -m "feat(web): re-skin AtRiskPanel to the card system"
```

---

## Notes for the implementer

- **Do NOT modify `weekModel.ts`** or `Planner.tsx`. If you think you need to, stop and report — the percentages from `placeInDay`/`nowLine` already drive positioning against the new 58px-row column height.
- Keep every `data-testid` (`event-block`, `day-header-{i}`, `day-col-{i}`, `now-line`, `toggle-proposed`, `at-risk-item`) and `data-kind`/`data-pinned`/`data-proposed` exactly.
- The Re-plan button text must keep the substring "Re-plan" so `getByRole('button', { name: /re-plan/i })` matches. The Today button text "Today" keeps `/today/i`.
- Kind/bar/proposed classes must be **literal strings** in the records (no concatenation) so Tailwind emits them.
- Stage only the files listed per task; never stage `seed-dev.mjs`, `.env.run`, `design_handoff_notreclaim/`, `review/`, `.claude/`.
