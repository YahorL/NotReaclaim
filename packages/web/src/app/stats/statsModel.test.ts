import { describe, it, expect } from 'vitest';
import type { SchedulePreview, CalendarEvent, Task } from '../../api/types';
import { startOfWeek, dayColumns } from '../planner/weekModel';
import {
  hoursByDay, summary, meetingCount, taskCompletion, donutSegments, formatHours, formatHoursNumber, axisScale,
  dayTable, donutArcs, HOUR_MS,
} from './statsModel';

const NOW = Date.parse('2026-01-07T12:00:00.000Z'); // Wednesday
const days = dayColumns(startOfWeek(NOW, 'UTC'), 7, 'UTC'); // Mon 2026-01-05 .. Sun 2026-01-11 (UTC)

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
  googleCalendarId: 'primary', googleEventId: 'g1', source: 'google', ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'x', priority: 2, sortOrder: 0, durationMs: 3_600_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: null, status: 'pending', completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('hoursByDay', () => {
  it('buckets proposed task/habit blocks and meetings into the right day (TZ=UTC)', () => {
    const perDay = hoursByDay(days, preview(), [event()], 'UTC');
    expect(perDay).toHaveLength(7);
    expect(perDay[0]).toEqual({ task: 0, meeting: 0, habit: HOUR_MS });           // Mon: 1h habit
    expect(perDay[2]).toEqual({ task: 2 * HOUR_MS, meeting: HOUR_MS / 2, habit: 0 }); // Wed: 2h task + 30m meeting
    expect(perDay.reduce((a, d) => a + d.task, 0)).toBe(2 * HOUR_MS);             // out-of-week task excluded
  });

  it('ignores blocked entries — local busy time is not work data', () => {
    const blocked = event({ id: 'e-b', title: 'Gym', kind: 'blocked', source: 'app',
      startsAt: '2026-01-07T18:00:00.000Z', endsAt: '2026-01-07T20:00:00.000Z' }); // Wed, 2h
    const perDay = hoursByDay(days, preview(), [event(), blocked], 'UTC');
    // Wed still shows only the 30m meeting — the 2h block contributes nothing.
    expect(perDay[2]).toEqual({ task: 2 * HOUR_MS, meeting: HOUR_MS / 2, habit: 0 });
    expect(summary(perDay).meetingMs).toBe(HOUR_MS / 2);
  });

  it('treats undefined preview as no blocks', () => {
    const perDay = hoursByDay(days, undefined, [], 'UTC');
    expect(perDay.every((d) => d.task === 0 && d.meeting === 0 && d.habit === 0)).toBe(true);
  });
});

describe('summary', () => {
  it('sums each kind and the total', () => {
    const s = summary(hoursByDay(days, preview(), [event()], 'UTC'));
    expect(s.taskMs).toBe(2 * HOUR_MS);
    expect(s.habitMs).toBe(HOUR_MS);
    expect(s.meetingMs).toBe(HOUR_MS / 2);
    expect(s.totalMs).toBe(2 * HOUR_MS + HOUR_MS + HOUR_MS / 2);
  });
});

describe('meetingCount', () => {
  it('counts events whose start falls in the week', () => {
    expect(meetingCount(days, [event(), event({ id: 'e2', startsAt: '2026-02-01T10:00:00.000Z' })], 'UTC')).toBe(1);
  });

  it('does not count blocked entries as meetings', () => {
    const blocked = event({ id: 'e-b', title: 'Gym', kind: 'blocked', source: 'app' });
    expect(meetingCount(days, [blocked], 'UTC')).toBe(0);
    expect(meetingCount(days, [event(), blocked], 'UTC')).toBe(1);
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
  it('produces cumulative percentages in meeting,habit,task order (the chart stack and legend order)', () => {
    expect(donutSegments({ taskMs: 2 * HOUR_MS, meetingMs: HOUR_MS, habitMs: HOUR_MS })).toEqual([
      { kind: 'meeting', ms: HOUR_MS, fromPct: 0, toPct: 25 },
      { kind: 'habit', ms: HOUR_MS, fromPct: 25, toPct: 50 },
      { kind: 'task', ms: 2 * HOUR_MS, fromPct: 50, toPct: 100 },
    ]);
  });
  it('omits zero-ms kinds and returns [] when total is 0', () => {
    expect(donutSegments({ taskMs: HOUR_MS, meetingMs: 0, habitMs: HOUR_MS })).toEqual([
      { kind: 'habit', ms: HOUR_MS, fromPct: 0, toPct: 50 },
      { kind: 'task', ms: HOUR_MS, fromPct: 50, toPct: 100 },
    ]);
    expect(donutSegments({ taskMs: 0, meetingMs: 0, habitMs: 0 })).toEqual([]);
  });
});

describe('donutArcs', () => {
  const C = 100;
  it('a single slice is the full ring with no gap', () => {
    expect(donutArcs([{ kind: 'habit', ms: HOUR_MS, fromPct: 0, toPct: 100 }], C, 10)).toEqual([
      { kind: 'habit', dashArray: '100 100', dashOffset: -0 },
    ]);
  });
  it('several slices each lose the gap and start at their cumulative offset', () => {
    const arcs = donutArcs([
      { kind: 'meeting', ms: 3, fromPct: 0, toPct: 60 },
      { kind: 'habit', ms: 2, fromPct: 60, toPct: 100 },
    ], C, 10);
    expect(arcs).toEqual([
      { kind: 'meeting', dashArray: '50 100', dashOffset: -0 },
      { kind: 'habit', dashArray: '30 100', dashOffset: -60 },
    ]);
  });
  it('a slice smaller than the gap never gets a negative length', () => {
    const arcs = donutArcs([
      { kind: 'meeting', ms: 99, fromPct: 0, toPct: 99 },
      { kind: 'task', ms: 1, fromPct: 99, toPct: 100 },
    ], C, 10);
    expect(arcs[1]).toEqual({ kind: 'task', dashArray: '0 100', dashOffset: -99 });
  });
});

describe('dayTable', () => {
  const perDay = [
    { task: HOUR_MS, meeting: 2 * HOUR_MS, habit: 0 },
    { task: 0, meeting: 0, habit: 1.5 * HOUR_MS },
  ];
  it('gives one row per day with each series and the day total, formatted like the chart labels', () => {
    const t = dayTable(perDay, ['Mon', 'Tue'], ['Monday', 'Tuesday']);
    expect(t.rows).toEqual([
      { short: 'Mon', long: 'Monday', meetingMs: 2 * HOUR_MS, habitMs: 0, taskMs: HOUR_MS, totalMs: 3 * HOUR_MS, meeting: '2h', habit: '0h', task: '1h', total: '3h' },
      { short: 'Tue', long: 'Tuesday', meetingMs: 0, habitMs: 1.5 * HOUR_MS, taskMs: 0, totalMs: 1.5 * HOUR_MS, meeting: '0h', habit: '1.5h', task: '0h', total: '1.5h' },
    ]);
  });
  it('sums every series into a totals row', () => {
    expect(dayTable(perDay, ['Mon', 'Tue'], ['Monday', 'Tuesday']).totals).toEqual({
      meetingMs: 2 * HOUR_MS, habitMs: 1.5 * HOUR_MS, taskMs: HOUR_MS, totalMs: 4.5 * HOUR_MS,
      meeting: '2h', habit: '1.5h', task: '1h', total: '4.5h',
    });
  });
});

describe('formatHours', () => {
  it('formats hours with a trailing-zero strip', () => {
    expect(formatHours(34 * HOUR_MS)).toBe('34h');
    expect(formatHours(21.5 * HOUR_MS)).toBe('21.5h');
    expect(formatHours(0)).toBe('0h');
  });
});

describe('formatHoursNumber', () => {
  it('is formatHours without the unit (the KPI tiles set the unit smaller)', () => {
    expect(formatHoursNumber(25.7 * HOUR_MS)).toBe('25.7');
    expect(formatHoursNumber(0)).toBe('0');
  });
});

describe('axisScale', () => {
  it('picks a round step with at most 4 intervals covering the busiest day', () => {
    expect(axisScale(5.8 * HOUR_MS)).toEqual({ topMs: 6 * HOUR_MS, ticksMs: [0, 2, 4, 6].map((h) => h * HOUR_MS) });
    expect(axisScale(3.9 * HOUR_MS)).toEqual({ topMs: 4 * HOUR_MS, ticksMs: [0, 1, 2, 3, 4].map((h) => h * HOUR_MS) });
    expect(axisScale(24 * HOUR_MS).ticksMs.map((t) => t / HOUR_MS)).toEqual([0, 6, 12, 18, 24]);
  });
  it('an exact multiple stays the top, and an empty week still has a 1h axis', () => {
    expect(axisScale(4 * HOUR_MS).topMs).toBe(4 * HOUR_MS);
    expect(axisScale(0)).toEqual({ topMs: HOUR_MS, ticksMs: [0, HOUR_MS] });
  });
  it('falls back to the largest step past the candidate list', () => {
    expect(axisScale(100 * HOUR_MS).topMs).toBe(108 * HOUR_MS); // 12h steps, 9 intervals
  });
});

describe('stats bucketing by settings-zone days', () => {
  const NY = 'America/New_York';
  const blk = (id: string, startIso: string, hours: number) => ({
    id, sourceType: 'habit' as const, sourceId: 'h', title: id, start: Date.parse(startIso), end: Date.parse(startIso) + hours * HOUR_MS,
  });

  it('buckets by New York days, not UTC days', () => {
    const nyDays = dayColumns(startOfWeek(NOW, NY), 7, NY); // Mon Jan 5 .. Sun Jan 11, New York
    // 03:00Z Jan 6 is Mon Jan 5 22:00 in New York.
    const perDay = hoursByDay(nyDays, { blocks: [blk('late-mon', '2026-01-06T03:00:00.000Z', 1)], unscheduled: [] }, [], NY);
    expect(perDay[0]!.habit).toBe(HOUR_MS);
    expect(perDay[1]!.habit).toBe(0);
  });

  it('a 25h fall-back Sunday keeps its last hour (New York, Nov 1 2026)', () => {
    const weekStart = startOfWeek(Date.parse('2026-10-28T12:00:00.000Z'), NY); // Mon Oct 26
    const nyDays = dayColumns(weekStart, 7, NY);
    // Sun Nov 1 23:30 EST = 04:30Z Nov 2 — still Sunday, but past a naive 24h day end.
    const preview = { blocks: [blk('sun-late', '2026-11-02T04:30:00.000Z', 0.5)], unscheduled: [] };
    const sunMeeting = event({ startsAt: '2026-11-02T04:30:00.000Z', endsAt: '2026-11-02T04:45:00.000Z' });
    const perDay = hoursByDay(nyDays, preview, [sunMeeting], NY);
    expect(perDay[6]!.habit).toBe(HOUR_MS / 2);
    expect(perDay[6]!.meeting).toBe(HOUR_MS / 4);
    expect(meetingCount(nyDays, [sunMeeting], NY)).toBe(1);
  });

  it('a 23h spring-forward Sunday does not swallow next Monday (New York, Mar 8 2026)', () => {
    const nyDays = dayColumns(startOfWeek(Date.parse('2026-03-04T12:00:00.000Z'), NY), 7, NY); // Mon Mar 2
    // Mon Mar 9 00:30 EDT = 04:30Z — next week, but inside a naive 24h Sunday.
    const preview = { blocks: [blk('next-mon', '2026-03-09T04:30:00.000Z', 1)], unscheduled: [] };
    const monMeeting = event({ startsAt: '2026-03-09T04:30:00.000Z', endsAt: '2026-03-09T05:00:00.000Z' });
    expect(hoursByDay(nyDays, preview, [monMeeting], NY)[6]).toEqual({ task: 0, meeting: 0, habit: 0 });
    expect(meetingCount(nyDays, [monMeeting], NY)).toBe(0);
  });
});
