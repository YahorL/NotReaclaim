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
