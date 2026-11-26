import { describe, it, expect } from 'vitest';
import type { Settings, Task } from '@notreclaim/db';
import { buildTestApp, tokenFor } from './fakes.js';

// A time zone saved before PUT /settings validated it must not turn schedule reads into 500s:
// core plans such a row in UTC until the user picks a valid zone.
const settings = (timezone: string): Settings => ({
  id: 's1', userId: 'u1', timezone,
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as unknown as Settings['workingHours'],
  horizonDays: 1, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 1800000,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, requireStartSince: null, dayStartMinute: 0,
  createdAt: new Date(0), updatedAt: new Date(0),
});
const task: Task = {
  id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1800000,
  dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1800000, maxChunkMs: 1800000,
  sortOrder: 0, notBefore: null, categoryId: null, status: 'pending', completedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0),
} as Task;

async function preview(timezone: string) {
  const { app } = buildTestApp({ settings: settings(timezone), tasks: [task] });
  const token = await tokenFor(app);
  return app.inject({ method: 'GET', url: '/schedule/preview', headers: { authorization: `Bearer ${token}` } });
}

describe('a stored invalid time zone', () => {
  it('GET /schedule/preview answers 200 with the same plan as UTC', async () => {
    const bad = await preview('Not/AZone');
    expect(bad.statusCode).toBe(200);
    const utc = await preview('UTC');
    expect(bad.json()).toEqual(utc.json());
    expect(bad.json().blocks.length).toBeGreaterThan(0);
  });
});
