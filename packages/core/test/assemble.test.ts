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

describe('assembleScheduleInput horizon', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  it('sets the horizon envelope from now and settings.horizonDays', async () => {
    const now = utc('2026-01-05T12:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({ settings: makeSettings({ horizonDays: 7 }), categories: [makeCategory()], tasks: [], habits: [] }),
      'u1', now,
    );
    expect(input.horizon).toEqual({ start: now, end: now + 7 * MS_PER_DAY });
  });

  it('tracks a different horizonDays setting', async () => {
    const now = utc('2026-01-05T12:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({ settings: makeSettings({ horizonDays: 3 }), categories: [makeCategory()], tasks: [], habits: [] }),
      'u1', now,
    );
    expect(input.horizon).toEqual({ start: now, end: now + 3 * MS_PER_DAY });
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

describe('assembleScheduleInput notBefore', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  const settings = makeSettings({ workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as never }); // Mon 09:00–17:00

  it('clips a task\'s windows to start no earlier than notBefore', async () => {
    const t = makeTask({ id: 't1', notBefore: new Date('2026-01-05T13:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    const win = input.tasks.find((x) => x.id === 't1')!.allowedWindows!;
    expect(win.every((w) => w.start >= Date.parse('2026-01-05T13:00:00.000Z'))).toBe(true);
    expect(win.some((w) => w.start === Date.parse('2026-01-05T13:00:00.000Z'))).toBe(true);
  });

  it('is a no-op when notBefore is in the past', async () => {
    const t = makeTask({ id: 't2', notBefore: new Date('2026-01-01T00:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    const win = input.tasks.find((x) => x.id === 't2')!.allowedWindows!;
    expect(win.length).toBeGreaterThan(0);
    expect(win.some((w) => w.start === Date.parse('2026-01-05T09:00:00.000Z'))).toBe(true);
  });

  it('intersects notBefore with a non-default category window', async () => {
    const evening = makeCategory({ id: 'cat-eve', name: 'Personal', isDefault: false, windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] as never }); // Mon 18:00–22:00
    const t = makeTask({ id: 't4', categoryId: 'cat-eve', notBefore: new Date('2026-01-05T20:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory(), evening], tasks: [t], habits: [] }), 'u1', NOW,
    );
    const win = input.tasks.find((x) => x.id === 't4')!.allowedWindows!;
    expect(win.length).toBeGreaterThan(0);
    expect(win.every((w) => w.start >= Date.parse('2026-01-05T20:00:00.000Z') && w.end <= Date.parse('2026-01-05T22:00:00.000Z'))).toBe(true);
    expect(win.some((w) => w.start === Date.parse('2026-01-05T20:00:00.000Z'))).toBe(true);
  });

  it('yields no windows when notBefore is beyond the horizon', async () => {
    const t = makeTask({ id: 't3', notBefore: new Date('2026-02-01T00:00:00.000Z') });
    const input = await assembleScheduleInput(
      fakeRepos({ settings, categories: [makeCategory()], tasks: [t], habits: [] }), 'u1', NOW,
    );
    expect(input.tasks.find((x) => x.id === 't3')!.allowedWindows).toEqual([]);
  });
});

describe('assembleScheduleInput spent', () => {
  const NOW = Date.parse('2026-01-05T12:00:00.000Z'); // Monday noon UTC

  it('subtracts finished-block time from a task remaining (auto mode)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 3_600_000, minChunkMs: 900000, maxChunkMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'done', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'), // finished, 30m
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1_800_000); // 1h - 30m spent
  });

  it('drops a task whose finished blocks already cover its duration', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'done', taskId: 't1', habitId: null, pinned: false,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('manual mode ignores an un-started finished block (work is re-planned)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ requireStartToTrack: true, workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 1_800_000 })],
        blocks: [makeBlock({
          id: 'missed', taskId: 't1', habitId: null, pinned: false, startedAt: null,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.durationMs).toBe(1_800_000); // not reduced
  });

  it('excludes past pinned blocks from the engine pinnedBlocks input', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings(),
        blocks: [
          makeBlock({ id: 'past', pinned: true, taskId: 't1', startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
          makeBlock({ id: 'future', pinned: true, taskId: 't1', startsAt: new Date('2026-01-05T14:00:00.000Z'), endsAt: new Date('2026-01-05T14:30:00.000Z') }),
        ],
      }),
      'u1', NOW,
    );
    expect(input.pinnedBlocks.map((b) => b.id)).toEqual(['future']);
  });
});

describe('assembleScheduleInput buffers', () => {
  const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday, UTC
  const settings = (over = {}) => makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never, ...over });
  // makeEvent default: 2026-01-05T10:00–11:00Z

  it('pads meeting FixedEvents by meetingBufferMs', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings({ meetingBufferMs: 15 * 60_000 }), categories: [makeCategory()], events: [makeEvent()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.fixedEvents[0]).toMatchObject({
      start: Date.parse('2026-01-05T09:45:00.000Z'),
      end: Date.parse('2026-01-05T11:15:00.000Z'),
    });
  });

  it('does NOT pad a blocked entry — the meeting buffer is prep time around meetings', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: settings({ meetingBufferMs: 15 * 60_000 }),
        categories: [makeCategory()],
        events: [
          makeEvent({ id: 'blk', kind: 'blocked', title: 'Gym' }),
          makeEvent({
            id: 'mtg',
            startsAt: new Date('2026-01-05T14:00:00.000Z'),
            endsAt: new Date('2026-01-05T15:00:00.000Z'),
          }),
        ],
        tasks: [], habits: [],
      }),
      'u1', NOW,
    );
    // Both reach the engine as busy time; only the meeting is inflated.
    expect(input.fixedEvents).toEqual([
      { id: 'blk', start: Date.parse('2026-01-05T10:00:00.000Z'), end: Date.parse('2026-01-05T11:00:00.000Z') },
      { id: 'mtg', start: Date.parse('2026-01-05T13:45:00.000Z'), end: Date.parse('2026-01-05T15:15:00.000Z') },
    ]);
  });

  it('sets blockBufferMs from settings.taskBufferMs', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings({ taskBufferMs: 10 * 60_000 }), categories: [makeCategory()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.blockBufferMs).toBe(10 * 60_000);
  });

  it('defaults to no padding / 0 buffer (backward compatible)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({ settings: settings(), categories: [makeCategory()], events: [makeEvent()], tasks: [], habits: [] }), 'u1', NOW,
    );
    expect(input.fixedEvents[0]).toMatchObject({
      start: Date.parse('2026-01-05T10:00:00.000Z'),
      end: Date.parse('2026-01-05T11:00:00.000Z'),
    });
    expect(input.blockBufferMs).toBe(0);
  });
});

describe('assembleScheduleInput habit slots', () => {
  const NOW = Date.parse('2026-01-05T12:00:00.000Z'); // Monday noon UTC
  const at = (iso: string) => Date.parse(iso);

  it('threads non-pinned future habit blocks into the engine habit as existingSlots', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [
          // Out of order on purpose: the engine's slot selection is array-order dependent.
          makeBlock({
            id: 'auto-wed', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-07T09:00:00.000Z')), endsAt: new Date(at('2026-01-07T09:30:00.000Z')),
          }),
          makeBlock({
            id: 'auto-tue', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-06T09:00:00.000Z')), endsAt: new Date(at('2026-01-06T09:30:00.000Z')),
          }),
          // Pinned → arrives via pinnedBlocks, not existingSlots.
          makeBlock({
            id: 'pinned-thu', taskId: null, habitId: 'h1', pinned: true,
            startsAt: new Date(at('2026-01-08T09:00:00.000Z')), endsAt: new Date(at('2026-01-08T09:30:00.000Z')),
          }),
          // Past → already happened, nothing to keep stable.
          makeBlock({
            id: 'past', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-05T09:00:00.000Z')), endsAt: new Date(at('2026-01-05T09:30:00.000Z')),
          }),
          // Started → user-managed.
          makeBlock({
            id: 'started', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-05T14:00:00.000Z')), endsAt: new Date(at('2026-01-05T14:30:00.000Z')),
            startedAt: new Date(at('2026-01-05T11:55:00.000Z')),
          }),
          // Another habit's block.
          makeBlock({
            id: 'other-habit', taskId: null, habitId: 'h2', pinned: false,
            startsAt: new Date(at('2026-01-06T15:00:00.000Z')), endsAt: new Date(at('2026-01-06T15:30:00.000Z')),
          }),
          // A task block.
          makeBlock({
            id: 'task-block', taskId: 't1', habitId: null, pinned: false,
            startsAt: new Date(at('2026-01-06T16:00:00.000Z')), endsAt: new Date(at('2026-01-06T16:30:00.000Z')),
          }),
        ],
      }),
      'u1', NOW,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.existingSlots).toEqual([
      { start: at('2026-01-06T09:00:00.000Z'), end: at('2026-01-06T09:30:00.000Z') },
      { start: at('2026-01-07T09:00:00.000Z'), end: at('2026-01-07T09:30:00.000Z') },
    ]);
  });

  it('leaves existingSlots undefined when the habit has no reusable blocks', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', eligibleDays: [1, 2, 3, 4, 5] })],
      }),
      'u1', NOW,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.existingSlots).toBeUndefined();
  });

  it('threads pinned habit block start times as consumedSlotTimes', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [
          makeBlock({
            id: 'pinned-thu', taskId: null, habitId: 'h1', pinned: true,
            startsAt: new Date(at('2026-01-08T09:00:00.000Z')), endsAt: new Date(at('2026-01-08T09:30:00.000Z')),
          }),
          makeBlock({
            id: 'pinned-tue', taskId: null, habitId: 'h1', pinned: true,
            startsAt: new Date(at('2026-01-06T09:00:00.000Z')), endsAt: new Date(at('2026-01-06T09:30:00.000Z')),
          }),
          makeBlock({
            id: 'auto-wed', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-07T09:00:00.000Z')), endsAt: new Date(at('2026-01-07T09:30:00.000Z')),
          }),
        ],
      }),
      'u1', NOW,
    );
    const h1 = input.habits.find((h) => h.id === 'h1')!;
    expect(h1.consumedSlotTimes).toEqual([at('2026-01-06T09:00:00.000Z'), at('2026-01-08T09:00:00.000Z')]);
    expect(h1.periodTargets![0]).toBe(1); // 3 per period - 2 pinned
  });

  it('merges begun (started-or-past-start) habit block starts into consumedSlotTimes', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [
          // Today's occurrence has already begun: its day is history, not re-placeable.
          makeBlock({
            id: 'begun-today', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-05T09:00:00.000Z')), endsAt: new Date(at('2026-01-05T09:30:00.000Z')),
          }),
          makeBlock({
            id: 'pinned-thu', taskId: null, habitId: 'h1', pinned: true,
            startsAt: new Date(at('2026-01-08T09:00:00.000Z')), endsAt: new Date(at('2026-01-08T09:30:00.000Z')),
          }),
          // Still in the future → an existingSlot, not a consumed day.
          makeBlock({
            id: 'auto-wed', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-07T09:00:00.000Z')), endsAt: new Date(at('2026-01-07T09:30:00.000Z')),
          }),
          // Another habit's begun block must not leak in.
          makeBlock({
            id: 'other-habit', taskId: null, habitId: 'h2', pinned: false,
            startsAt: new Date(at('2026-01-05T08:00:00.000Z')), endsAt: new Date(at('2026-01-05T08:30:00.000Z')),
          }),
          // Nor a task's.
          makeBlock({
            id: 'task-block', taskId: 't1', habitId: null, pinned: false,
            startsAt: new Date(at('2026-01-05T08:00:00.000Z')), endsAt: new Date(at('2026-01-05T08:30:00.000Z')),
          }),
        ],
      }),
      'u1', NOW,
    );
    const h1 = input.habits.find((h) => h.id === 'h1')!;
    expect(h1.consumedSlotTimes).toEqual([
      at('2026-01-05T09:00:00.000Z'),
      at('2026-01-08T09:00:00.000Z'),
    ]);
    // Only PINNED occurrences reduce the weekly target: a missed one may still be
    // re-placed on another eligible day this week.
    expect(h1.periodTargets![0]).toBe(2); // 3 per period - 1 pinned
    expect(h1.existingSlots).toEqual([
      { start: at('2026-01-07T09:00:00.000Z'), end: at('2026-01-07T09:30:00.000Z') },
    ]);
  });

  it('still passes begun blocks from earlier days (harmless: those days emit no window)', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [makeBlock({
          id: 'yesterday', taskId: null, habitId: 'h1', pinned: false,
          startsAt: new Date(at('2026-01-02T09:00:00.000Z')), endsAt: new Date(at('2026-01-02T09:30:00.000Z')),
        })],
      }),
      'u1', NOW,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.consumedSlotTimes)
      .toEqual([at('2026-01-02T09:00:00.000Z')]);
  });

  it('leaves consumedSlotTimes undefined when the habit has no pinned blocks', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [makeBlock({
          id: 'auto-wed', taskId: null, habitId: 'h1', pinned: false,
          startsAt: new Date(at('2026-01-07T09:00:00.000Z')), endsAt: new Date(at('2026-01-07T09:30:00.000Z')),
        })],
      }),
      'u1', NOW,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.consumedSlotTimes).toBeUndefined();
  });
});

describe('assembleScheduleInput started tasks', () => {
  const NOW = Date.parse('2026-01-05T12:00:00.000Z'); // Monday noon UTC

  it('excludes a task that has a started block from auto-scheduling', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 7_200_000 })], // 2h, has remaining
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date('2026-01-05T12:30:00.000Z'), endsAt: new Date('2026-01-05T13:00:00.000Z'),
          startedAt: new Date('2026-01-05T12:24:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined(); // user-managed → not auto-scheduled
  });

  it('still schedules a task whose blocks are all un-started', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 3_600_000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: false, startedAt: null,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'), // finished/past
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeDefined();
  });
});
