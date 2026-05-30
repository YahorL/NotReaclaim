import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { EventBlock, type BlockKind } from './EventBlock';
import { placeInDay, nowLine, isToday, classifyBlock, MS_PER_DAY } from './weekModel';
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_TICKS = [6, 8, 10, 12, 14, 16, 18, 20, 22];

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
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onPrev} className="rounded border border-gray-300 px-2 py-0.5">◀</button>
        <button onClick={onToday} className="rounded border border-gray-300 px-2 py-0.5">Today</button>
        <button onClick={onNext} className="rounded border border-gray-300 px-2 py-0.5">▶</button>
        <span className="font-semibold">{weekLabel}</span>
        <span className="flex-1" />
        <button
          onClick={onReplan}
          disabled={replanPending}
          className="rounded bg-blue-600 px-3 py-0.5 text-white disabled:opacity-50"
        >
          {replanPending ? 'Re-planning…' : '↻ Re-plan'}
        </button>
      </div>

      <div className="grid grid-cols-[34px_repeat(7,1fr)] overflow-hidden rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50" />
        {days.map((d, i) => {
          const today = isToday(nowMs, d);
          return (
            <div
              key={d}
              data-testid={`day-header-${i}`}
              data-today={today}
              className={`border-b border-l border-gray-100 bg-gray-50 py-1 text-center text-xs font-semibold ${
                today ? 'text-blue-600' : ''
              }`}
            >
              {DAY_LABELS[i]} {new Date(d).getDate()}
            </div>
          );
        })}

        <div className="bg-gray-50">
          {HOUR_TICKS.map((h) => (
            <div key={h} className="h-[22px] pr-1 text-right text-[9px] text-gray-400">{h}</div>
          ))}
        </div>
        {days.map((d, i) => {
          // Assign each item to the column whose [midnight, +24h) contains its start.
          // Items outside the 06:00–22:00 window are dropped by placeInDay below.
          const dayItems = items.filter((it) => it.startMs >= d && it.startMs < d + MS_PER_DAY);
          const line = nowLine(nowMs, d);
          return (
            <div key={d} data-testid={`day-col-${i}`} className="relative min-h-[198px] border-l border-gray-100">
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
                <div data-testid="now-line" className="absolute left-0 right-0 h-0.5 bg-red-500" style={{ top: `${line}%` }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
