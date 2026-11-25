import type { SchedulePreview, CalendarEvent, Task } from '../../api/types';
import { shiftDays } from '../planner/weekModel';

export const HOUR_MS = 3_600_000;

export interface KindMs { task: number; meeting: number; habit: number }

/**
 * Blocked entries are the user's own local busy time (relax/personal), not work: they are
 * excluded from every meeting aggregation rather than given a bucket of their own, so the
 * hours bars, the donut and the meeting count all report work data only.
 */
const isMeeting = (e: CalendarEvent): boolean => e.kind !== 'blocked';

/** End of the day starting at `dayStartMs`: the next zone midnight (a DST day is 23h or 25h). */
const dayEnd = (dayStartMs: number, zone: string): number => shiftDays(dayStartMs, 1, zone);

/** Per-day totals for the zone-day starts in `days`; a block or event counts on the day it starts. */
export function hoursByDay(days: number[], preview: SchedulePreview | undefined, events: CalendarEvent[], zone: string): KindMs[] {
  const blocks = preview?.blocks ?? [];
  return days.map((d) => {
    const end = dayEnd(d, zone);
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
      if (!isMeeting(e)) continue;
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

export function meetingCount(days: number[], events: CalendarEvent[], zone: string): number {
  const first = days[0] ?? 0;
  const last = dayEnd(days[days.length - 1] ?? 0, zone);
  return events.filter((e) => {
    if (!isMeeting(e)) return false;
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

/** Kind → chart swatch background. Literal class strings so Tailwind can see them. */
export const KIND_BAR_BG: Record<DonutKind, string> = {
  task: 'bg-chart-task',
  meeting: 'bg-chart-meet',
  habit: 'bg-chart-habit',
};
/** Kind → SVG stroke (the donut arcs). */
export const KIND_STROKE: Record<DonutKind, string> = {
  task: 'stroke-chart-task',
  meeting: 'stroke-chart-meet',
  habit: 'stroke-chart-habit',
};
export const KIND_LABEL: Record<DonutKind, string> = { meeting: 'Meetings', habit: 'Habits', task: 'Tasks' };
/** One order everywhere: chart stack (top → bottom), legend, table columns, donut. */
export const KIND_ORDER: DonutKind[] = ['meeting', 'habit', 'task'];

export interface DonutSegment { kind: DonutKind; ms: number; fromPct: number; toPct: number }

export function donutSegments(s: { taskMs: number; meetingMs: number; habitMs: number }): DonutSegment[] {
  const total = s.taskMs + s.meetingMs + s.habitMs;
  if (total <= 0) return [];
  const msOf: Record<DonutKind, number> = { meeting: s.meetingMs, habit: s.habitMs, task: s.taskMs };
  const out: DonutSegment[] = [];
  let acc = 0;
  for (const kind of KIND_ORDER) {
    const ms = msOf[kind];
    if (ms <= 0) continue;
    const fromPct = (acc / total) * 100;
    acc += ms;
    out.push({ kind, ms, fromPct, toPct: (acc / total) * 100 });
  }
  return out;
}

export interface DonutArc { kind: DonutKind; dashArray: string; dashOffset: number }

/**
 * SVG stroke-dash geometry for each segment on a circle of circumference `c`: every arc loses
 * `gap` (the round caps then meet), never going below zero length; a lone segment is the full
 * ring. Pair with `animate-donut-draw` + `--donut-c: c` (spec §10 P1 contract).
 */
export function donutArcs(segments: DonutSegment[], c: number, gap: number): DonutArc[] {
  const g = segments.length > 1 ? gap : 0;
  return segments.map((s) => {
    const len = Math.max(0, (c * (s.toPct - s.fromPct)) / 100 - g);
    return { kind: s.kind, dashArray: `${round1(len)} ${round1(c)}`, dashOffset: -round1((c * s.fromPct) / 100) };
  });
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function formatHoursNumber(ms: number): string {
  return String(Math.round(ms / (HOUR_MS / 10)) / 10); // 1-decimal hours
}

export function formatHours(ms: number): string {
  return `${formatHoursNumber(ms)}h`;
}

const STEPS_H = [1, 2, 3, 4, 6, 8, 12];
const MAX_INTERVALS = 4;

/** Y axis for the busiest day: the smallest round step with ≤ 4 intervals (12h past that). */
export function axisScale(maxMs: number): { topMs: number; ticksMs: number[] } {
  const hours = Math.max(0, maxMs) / HOUR_MS;
  const step = STEPS_H.find((st) => Math.ceil(hours / st) <= MAX_INTERVALS) ?? STEPS_H[STEPS_H.length - 1]!;
  const intervals = Math.max(1, Math.ceil(hours / step));
  const ticksMs = Array.from({ length: intervals + 1 }, (_, i) => i * step * HOUR_MS);
  return { topMs: intervals * step * HOUR_MS, ticksMs };
}

export interface SeriesMs { meetingMs: number; habitMs: number; taskMs: number; totalMs: number }
export interface SeriesLabels { meeting: string; habit: string; task: string; total: string }
export type DayRow = { short: string; long: string } & SeriesMs & SeriesLabels;

function withLabels(v: SeriesMs): SeriesMs & SeriesLabels {
  return { ...v, meeting: formatHours(v.meetingMs), habit: formatHours(v.habitMs), task: formatHours(v.taskMs), total: formatHours(v.totalMs) };
}

/** The chart's data as rows — the chart labels and the Table view both read this, so they cannot diverge. */
export function dayTable(perDay: KindMs[], shortLabels: string[], longLabels: string[]): { rows: DayRow[]; totals: SeriesMs & SeriesLabels } {
  const rows = perDay.map((d, i) => ({
    short: shortLabels[i] ?? '',
    long: longLabels[i] ?? '',
    ...withLabels({ meetingMs: d.meeting, habitMs: d.habit, taskMs: d.task, totalMs: d.meeting + d.habit + d.task }),
  }));
  const sum = (k: keyof SeriesMs) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, totals: withLabels({ meetingMs: sum('meetingMs'), habitMs: sum('habitMs'), taskMs: sum('taskMs'), totalMs: sum('totalMs') }) };
}
