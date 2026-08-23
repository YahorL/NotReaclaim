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

  it('keeps the full perPeriod when the period has enough eligible days', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [1, 2, 3, 4, 5] })],
      }),
      'u1', now,
    );
    // Mon-Fri are all reachable, so nothing is prorated away.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([3]);
  });

  it('prorates the target of a week already partly elapsed', async () => {
    const now = utc('2026-01-09T00:00:00'); // Friday: only Fri and Sat are left this week
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 2 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 7, eligibleDays: [0, 1, 2, 3, 4, 5, 6] })],
      }),
      'u1', now,
    );
    // Mon-Thu are history: asking for 7 would report 5 unreachable misses.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([2]);
  });

  it('prorates the target of a last week clipped by the horizon', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 10 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 7, eligibleDays: [0, 1, 2, 3, 4, 5, 6] })],
      }),
      'u1', now,
    );
    // Full first week, then Mon-Wed of the second before the horizon ends.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([7, 3]);
  });

  it('keeps warning about a perPeriod its eligible weekdays cannot reach in a full week', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 5, eligibleDays: [1, 3] })],
      }),
      'u1', now,
    );
    // Nothing is clipped here: the whole ISO week is inside the horizon. Asking for 5
    // occurrences on only Mon+Wed is a misconfiguration the user can fix (add eligible
    // days, or lower perPeriod), so the target stays 5 and 3 report as missed.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([5]);
  });

  it('silences only the clipped days when eligible weekdays are also too few', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 1 }), // horizon ends before Wednesday
        habits: [makeHabit({ id: 'h1', perPeriod: 5, eligibleDays: [1, 3] })],
      }),
      'u1', now,
    );
    // Capacity is Monday alone (1); the ineligibility shortfall (5 - 2 eligible days = 3)
    // is added back, so the target is 4: the 3 honest misconfiguration misses stay
    // visible while the out-of-horizon Wednesday is silenced.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([4]);
  });

  it('drops a day already taken by a begun occurrence from the prorated target', async () => {
    const now = utc('2026-01-09T00:00:00'); // Friday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 2 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 7, eligibleDays: [0, 1, 2, 3, 4, 5, 6] })],
        blocks: [makeBlock({
          id: 'begun-fri', taskId: null, habitId: 'h1', pinned: false,
          startsAt: new Date(utc('2026-01-09T00:00:00')), endsAt: new Date(utc('2026-01-09T00:30:00')),
        })],
      }),
      'u1', now,
    );
    // Friday is spoken for, so only Saturday is still placeable.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([1]);
  });

  it('does not prorate a habit with no eligible days, so it still reports as unscheduled', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        habits: [makeHabit({ id: 'h1', perPeriod: 3, eligibleDays: [] })],
      }),
      'u1', now,
    );
    // A misconfigured habit is actionable, unlike a day the horizon put out of reach.
    // No special case does this: capacity is 0, but the ineligibility shortfall
    // (perPeriod 3 - 0 eligible days) restores the full target.
    expect(input.habits.find((h) => h.id === 'h1')!.periodTargets).toEqual([3]);
  });

  it('gives an undated task the horizon end as its engine deadline and lists it as undated', async () => {
    const now = utc('2026-01-05T00:00:00'); // Monday
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        tasks: [
          makeTask({ id: 't1', dueBy: null }),
          makeTask({ id: 't2', dueBy: new Date(utc('2026-01-06T10:00:00')) }),
        ],
      }),
      'u1', now,
    );
    expect(input.tasks.find((t) => t.id === 't1')!.dueBy).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(input.undatedTaskIds).toEqual(['t1']);
  });

  it('reports no undated ids when every task has a due date', async () => {
    const now = utc('2026-01-05T00:00:00');
    const input = await assembleScheduleInput(
      fakeRepos({ settings: makeSettings({ horizonDays: 7 }), tasks: [makeTask({ id: 't1' })] }),
      'u1', now,
    );
    expect(input.undatedTaskIds).toEqual([]);
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

  it('consumes the day of a PINNED occurrence that has already ended', async () => {
    // `pinnedBlocks` drops rows that ended before `now`, so without this the day would
    // look free again the moment a pinned occurrence finished — and get double-booked.
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', perPeriod: 1, eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [makeBlock({
          id: 'pinned-done', taskId: null, habitId: 'h1', pinned: true,
          startsAt: new Date(at('2026-01-05T09:00:00.000Z')), endsAt: new Date(at('2026-01-05T09:30:00.000Z')),
        })],
      }),
      'u1', NOW,
    );
    expect(input.habits.find((h) => h.id === 'h1')!.consumedSlotTimes)
      .toEqual([at('2026-01-05T09:00:00.000Z')]);
  });

  it('adds a RUNNING habit block to fixedEvents as raw busy time', async () => {
    // 11:45–12:15 with `now` at 12:00: the occurrence is frozen in place, so its
    // remaining minutes must not be handed out as free time.
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ horizonDays: 7, meetingBufferMs: 15 * 60_000 }),
        categories: [makeCategory()],
        habits: [makeHabit({ id: 'h1', eligibleDays: [1, 2, 3, 4, 5] })],
        blocks: [
          makeBlock({
            id: 'running', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-05T11:45:00.000Z')), endsAt: new Date(at('2026-01-05T12:15:00.000Z')),
          }),
          // Already over → no time left to reserve.
          makeBlock({
            id: 'done', taskId: null, habitId: 'h1', pinned: false,
            startsAt: new Date(at('2026-01-05T09:00:00.000Z')), endsAt: new Date(at('2026-01-05T09:30:00.000Z')),
          }),
          // Pinned → already busy via pinnedBlocks.
          makeBlock({
            id: 'pinned-running', taskId: null, habitId: 'h1', pinned: true,
            startsAt: new Date(at('2026-01-05T11:50:00.000Z')), endsAt: new Date(at('2026-01-05T12:20:00.000Z')),
          }),
          // A running TASK block is not a frozen occurrence.
          makeBlock({
            id: 'task-running', taskId: 't1', habitId: null, pinned: false,
            startsAt: new Date(at('2026-01-05T11:45:00.000Z')), endsAt: new Date(at('2026-01-05T12:15:00.000Z')),
          }),
        ],
      }),
      'u1', NOW,
    );
    // Raw, exactly as placed: meetingBufferMs is prep time around meetings, not padding
    // for our own work blocks.
    expect(input.fixedEvents).toEqual([
      { id: 'habit-running:running', start: at('2026-01-05T11:45:00.000Z'), end: at('2026-01-05T12:15:00.000Z') },
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
