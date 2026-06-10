import { describe, it, expect } from 'vitest';
import { toFixedEvent, toFlexibleTask, toScheduledBlock } from '../src/mappers.js';
import type { CalendarEvent, Task, ScheduledBlock } from '@prisma/client';

const D = (iso: string) => new Date(iso);

describe('toFixedEvent', () => {
  it('maps a calendar event to epoch-ms start/end', () => {
    const row = {
      id: 'ev1',
      userId: 'u1',
      googleCalendarId: 'cal',
      googleEventId: 'g1',
      title: 'Standup',
      startsAt: D('2026-01-01T09:00:00.000Z'),
      endsAt: D('2026-01-01T09:30:00.000Z'),
      createdAt: D('2026-01-01T00:00:00.000Z'),
      updatedAt: D('2026-01-01T00:00:00.000Z'),
    } satisfies CalendarEvent;
    expect(toFixedEvent(row)).toEqual({
      id: 'ev1',
      start: D('2026-01-01T09:00:00.000Z').getTime(),
      end: D('2026-01-01T09:30:00.000Z').getTime(),
    });
  });
});

describe('toFlexibleTask', () => {
  it('maps a task to the engine FlexibleTask with epoch-ms dueBy', () => {
    const row = {
      id: 't1',
      userId: 'u1',
      title: 'Write report',
      priority: 1,
      sortOrder: 0,
      durationMs: 3600000,
      dueBy: D('2026-01-02T17:00:00.000Z'),
      minChunkMs: 900000,
      maxChunkMs: 1800000,
      category: null,
      status: 'pending',
      timeLoggedMs: 0,
      createdAt: D('2026-01-01T00:00:00.000Z'),
      updatedAt: D('2026-01-01T00:00:00.000Z'),
    } satisfies Task;
    expect(toFlexibleTask(row)).toEqual({
      id: 't1',
      title: 'Write report',
      priority: 1,
      sortOrder: 0,
      durationMs: 3600000,
      dueBy: D('2026-01-02T17:00:00.000Z').getTime(),
      minChunkMs: 900000,
      maxChunkMs: 1800000,
    });
  });
});

describe('toScheduledBlock', () => {
  const base = {
    id: 'b1',
    userId: 'u1',
    title: 'Focus',
    startsAt: D('2026-01-01T10:00:00.000Z'),
    endsAt: D('2026-01-01T10:30:00.000Z'),
    pinned: false,
    googleEventId: null,
    googleCalendarId: null,
    createdAt: D('2026-01-01T00:00:00.000Z'),
    updatedAt: D('2026-01-01T00:00:00.000Z'),
  };

  it('derives task source from taskId', () => {
    const row = { ...base, taskId: 't1', habitId: null } satisfies ScheduledBlock;
    expect(toScheduledBlock(row)).toEqual({
      id: 'b1',
      sourceType: 'task',
      sourceId: 't1',
      title: 'Focus',
      start: D('2026-01-01T10:00:00.000Z').getTime(),
      end: D('2026-01-01T10:30:00.000Z').getTime(),
    });
  });

  it('derives habit source from habitId', () => {
    const row = { ...base, taskId: null, habitId: 'h1' } satisfies ScheduledBlock;
    expect(toScheduledBlock(row).sourceType).toBe('habit');
    expect(toScheduledBlock(row).sourceId).toBe('h1');
  });

  it('throws when neither taskId nor habitId is set', () => {
    const row = { ...base, taskId: null, habitId: null } satisfies ScheduledBlock;
    expect(() => toScheduledBlock(row)).toThrow();
  });
});
