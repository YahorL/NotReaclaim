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
