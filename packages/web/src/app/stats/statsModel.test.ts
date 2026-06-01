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
    expect(perDay[0]).toEqual({ task: 0, meeting: 0, habit: HOUR_MS });           // Mon: 1h habit
    expect(perDay[2]).toEqual({ task: 2 * HOUR_MS, meeting: HOUR_MS / 2, habit: 0 }); // Wed: 2h task + 30m meeting
    expect(perDay.reduce((a, d) => a + d.task, 0)).toBe(2 * HOUR_MS);             // out-of-week task excluded
  });

  it('treats undefined preview as no blocks', () => {
    const perDay = hoursByDay(days, undefined, []);
    expect(perDay.every((d) => d.task === 0 && d.meeting === 0 && d.habit === 0)).toBe(true);
  });
});

describe('summary', () => {
  it('sums each kind and the total', () => {
    const s = summary(hoursByDay(days, preview(), [event()]));
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
    expect(donutSegments({ taskMs: 2 * HOUR_MS, meetingMs: HOUR_MS, habitMs: HOUR_MS })).toEqual([
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
