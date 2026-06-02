import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { assembleScheduleInput } from '../src/assemble.js';
import { SettingsRequiredError } from '../src/errors.js';
import { fakeRepos, makeSettings, makeTask, makeHabit, makeEvent, makeBlock, makeCategory } from './fakes.js';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();

describe('assembleScheduleInput', () => {
  it('throws SettingsRequiredError when there are no settings', async () => {
    await expect(assembleScheduleInput(fakeRepos({ settings: null }), 'u1', 0))
      .rejects.toThrow(SettingsRequiredError);
  });

  it('includes only active habits and pending/scheduled tasks', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [
          makeTask({ id: 't1', status: 'pending' }),
          makeTask({ id: 't2', status: 'completed' }),
          makeTask({ id: 't3', status: 'scheduled' }),
        ],
        habits: [
          makeHabit({ id: 'h1', status: 'active', eligibleDays: [1] }),
          makeHabit({ id: 'h2', status: 'paused', eligibleDays: [1] }),
        ],
      }),
      'u1', now,
    );
    expect(input.tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
    expect(input.habits.map((h) => h.id)).toEqual(['h1']);
    expect(input.workingWindows.length).toBeGreaterThan(0);
  });

  it('maps fixed events and keeps only pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        events: [makeEvent({
          id: 'e1',
          startsAt: new Date(utc('2026-01-05T10:00:00')),
          endsAt: new Date(utc('2026-01-05T11:00:00')),
        })],
        blocks: [
          makeBlock({ id: 'b1', pinned: true, taskId: 't1' }),
          makeBlock({ id: 'b2', pinned: false, taskId: 't1' }),
        ],
      }),
      'u1', now,
    );
    expect(input.fixedEvents).toEqual([
      { id: 'e1', start: utc('2026-01-05T10:00:00'), end: utc('2026-01-05T11:00:00') },
    ]);
    expect(input.pinnedBlocks.map((b) => b.id)).toEqual(['b1']);
  });

  it('reduces a task duration by pinned-block coverage', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 3600000, minChunkMs: 1800000, maxChunkMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1800000);
  });

  it('drops a task fully covered by pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('does not reduce a task for non-pinned blocks', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        tasks: [makeTask({ id: 't1', durationMs: 1800000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date(utc('2026-01-05T09:00:00')), endsAt: new Date(utc('2026-01-05T09:30:00')),
        })],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1800000);
  });

  it('reduces a habit period target by pinned occurrences in that period', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [makeBlock({
          id: 'b1', taskId: null, habitId: 'h1', pinned: true,
          startsAt: new Date(utc('2026-01-06T09:00:00')), endsAt: new Date(utc('2026-01-06T09:30:00')),
        })],
      }),
      'u1', now,
    );
    const h1 = input.habits.find((h) => h.id === 'h1')!;
    expect(h1.periodTargets).toBeDefined();
    expect(h1.periodTargets![0]).toBe(2);
  });

  it('leaves habit periodTargets undefined when there is no pinned coverage', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
      }),
      'u1', now,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toBeUndefined();
  });
});

describe('assembleScheduleInput categories', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  const settings = makeSettings({ workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as never });

  it('builds the envelope as the union of all category windows', async () => {
    const evening = makeCategory({ id: 'cat-eve', name: 'Personal', isDefault: false, windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] as never });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory(), evening], tasks: [], habits: [] }),
      'u1',
      NOW,
    );
    const mon18 = Date.parse('2026-01-05T18:00:00.000Z');
    expect(input.workingWindows.some((w) => w.start <= mon18 && w.end >= mon18 + 60 * 60_000)).toBe(true);
  });

  it('tags a task with its category windows and the default with settings hours', async () => {
    const evening = makeCategory({ id: 'cat-eve', name: 'Personal', isDefault: false, windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] as never });
    const t1 = makeTask({ id: 't1', categoryId: 'cat-eve' });
    const t2 = makeTask({ id: 't2', categoryId: null });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory(), evening], tasks: [t1, t2], habits: [] }),
      'u1',
      NOW,
    );
    const eveStart = Date.parse('2026-01-05T18:00:00.000Z');
    const workStart = Date.parse('2026-01-05T09:00:00.000Z');
    const a1 = input.tasks.find((t) => t.id === 't1')!.allowedWindows!;
    const a2 = input.tasks.find((t) => t.id === 't2')!.allowedWindows!;
    expect(a1.some((w) => w.start === eveStart)).toBe(true);
    expect(a2.some((w) => w.start === workStart)).toBe(true);
    expect(a2.some((w) => w.start === eveStart)).toBe(false);
  });

  it('falls back to the default windows when the task has a stale/deleted categoryId', async () => {
    const t = makeTask({ id: 't-stale', categoryId: 'deleted-cat' });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }),
      'u1',
      NOW,
    );
    const workStart = Date.parse('2026-01-05T09:00:00.000Z');
    const a = input.tasks.find((x) => x.id === 't-stale')!.allowedWindows!;
    expect(a.some((w) => w.start === workStart)).toBe(true);
  });
});
