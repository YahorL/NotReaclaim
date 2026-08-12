import { describe, it, expect, vi } from 'vitest';
import type { ScheduledBlock as DbScheduledBlock } from '@notreclaim/db';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { applyDesiredSchedule, planLocally, type ScheduleMirror } from '../src/apply.js';
import { SettingsRequiredError } from '../src/errors.js';
import { fakeRepos, makeSettings, makeHabit, makeEvent } from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const HORIZON = NOW + 24 * 60 * 60 * 1000;

function dbBlock(over: Partial<DbScheduledBlock> = {}): DbScheduledBlock {
  return {
    id: 'b1', userId: 'u1', taskId: 't1', habitId: null, title: 'A',
    startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T10:00:00.000Z'),
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0',
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  } as DbScheduledBlock;
}
const desired = (blocks: ScheduleResult['blocks']): ScheduleResult => ({ blocks, unscheduled: [] });
const eBlock = (over: Partial<ScheduleResult['blocks'][number]> = {}) => ({
  id: 'task:t1:0', sourceType: 'task' as const, sourceId: 't1', title: 'A',
  start: Date.parse('2026-01-05T09:00:00.000Z'), end: Date.parse('2026-01-05T10:00:00.000Z'), ...over,
});

function fakeRepo(seed: DbScheduledBlock[] = []) {
  let rows = [...seed];
  let n = seed.length;
  return {
    rows: () => rows,
    listByUserInRange: vi.fn(async (_u: string, s: Date, e: Date) => rows.filter((b) => b.startsAt < e && b.endsAt > s)),
    create: vi.fn(async (userId: string, data: Record<string, unknown>) => {
      const row = dbBlock({ id: `new-${++n}`, userId, ...data } as Partial<DbScheduledBlock>);
      rows.push(row); return row;
    }),
    update: vi.fn(async (_u: string, id: string, data: Record<string, unknown>) => {
      const row = rows.find((r) => r.id === id)!; Object.assign(row, data); return row;
    }),
    delete: vi.fn(async (_u: string, id: string) => { rows = rows.filter((r) => r.id !== id); }),
  };
}

describe('applyDesiredSchedule (local, no mirror)', () => {
  it('creates a new block with null google fields and engineKey set', async () => {
    const repo = fakeRepo([]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({
      engineKey: 'task:t1:0', googleEventId: null, googleCalendarId: null, title: 'A',
    }));
  });

  it('updates a keyed block whose times changed', async () => {
    const repo = fakeRepo([dbBlock()]);
    const moved = eBlock({ start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z') });
    const res = await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
  });

  it('updates a keyed block whose title changed even when its times are identical', async () => {
    // e.g. renaming a habit: Review 17 made kept slots byte-identical, so times never differ
    const repo = fakeRepo([dbBlock({ title: 'Old name' })]);
    const renamed = eBlock({ title: 'New name' });
    const res = await applyDesiredSchedule(repo, 'u1', desired([renamed]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(repo.update).toHaveBeenCalledWith('u1', 'b1', expect.objectContaining({ title: 'New name' }));
    expect(repo.rows()[0].title).toBe('New name');
  });

  it('writes title and times in a single update when both changed', async () => {
    const repo = fakeRepo([dbBlock({ title: 'Old name' })]);
    const moved = eBlock({
      title: 'New name',
      start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z'),
    });
    const res = await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('u1', 'b1', {
      startsAt: new Date('2026-01-05T11:00:00.000Z'),
      endsAt: new Date('2026-01-05T12:00:00.000Z'),
      title: 'New name',
    });
  });

  it('is a complete no-op when title and times are unchanged', async () => {
    const repo = fakeRepo([dbBlock()]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deletes a keyed block no longer desired, and leaves pinned blocks untouched', async () => {
    const repo = fakeRepo([dbBlock(), dbBlock({ id: 'b2', engineKey: 'task:t9:0' }), dbBlock({ id: 'p1', pinned: true, engineKey: null })]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 1 });
    expect(repo.delete).toHaveBeenCalledWith('u1', 'b2');
    expect(repo.delete).not.toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('applyDesiredSchedule (with mirror)', () => {
  it('calls the mirror and stores the returned google ids on create', async () => {
    const repo = fakeRepo([]);
    const mirror: ScheduleMirror = {
      create: vi.fn(async () => ({ googleEventId: 'g1', googleCalendarId: 'cal1' })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(mirror.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({ googleEventId: 'g1', googleCalendarId: 'cal1' }));
  });

  it('calls mirror.update when times changed and mirror.delete for removed blocks', async () => {
    const repo = fakeRepo([dbBlock(), dbBlock({ id: 'b2', engineKey: 'task:t9:0' })]);
    const mirror: ScheduleMirror = {
      create: vi.fn(async () => ({ googleEventId: 'g1', googleCalendarId: 'cal1' })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const moved = eBlock({ start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z') });
    await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(mirror.delete).toHaveBeenCalledTimes(1);
    expect(mirror.create).not.toHaveBeenCalled();
  });

  it('calls mirror.update once with the renamed block when only the title changed', async () => {
    const repo = fakeRepo([dbBlock({ title: 'Old name' })]);
    const mirror: ScheduleMirror = {
      create: vi.fn(async () => ({ googleEventId: 'g1', googleCalendarId: 'cal1' })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const renamed = eBlock({ title: 'New name' });
    const res = await applyDesiredSchedule(repo, 'u1', desired([renamed]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(mirror.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New name' }),
      expect.objectContaining({ id: 'b1' }),
    );
    expect(mirror.create).not.toHaveBeenCalled();
    expect(mirror.delete).not.toHaveBeenCalled();
  });
});

describe('planLocally', () => {
  const settings = {
    id: 's1', userId: 'u1', timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
    horizonDays: 1, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 1_800_000,
    meetingBufferMs: 0, taskBufferMs: 0,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const task = {
    id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1_800_000,
    dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1_800_000, maxChunkMs: 1_800_000,
    categoryId: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
  function repos(over: Record<string, unknown> = {}) {
    return {
      settings: { getByUserId: async () => settings },
      calendarEvents: { listByUserInRange: async () => [] },
      tasks: { listByUser: async () => [task] },
      habits: { listByUser: async () => [] },
      scheduledBlocks: { listByUserInRange: async () => [] },
      categories: { listByUser: async () => [] },
      ...over,
    } as never;
  }

  it('persists the computed schedule with no mirror and returns the {…,pinned:0,removed:0} shape', async () => {
    const blocks = fakeRepo([]);
    const res = await planLocally(repos(), blocks, 'u1', NOW);
    expect(res.pinned).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.created).toBeGreaterThan(0);
    expect(blocks.rows().every((b) => b.googleEventId === null)).toBe(true);
  });

  it('throws SettingsRequiredError when settings are missing', async () => {
    const blocks = fakeRepo([]);
    await expect(planLocally(repos({ settings: { getByUserId: async () => null } }), blocks, 'u1', NOW))
      .rejects.toBeInstanceOf(SettingsRequiredError);
  });
});

describe('applyDesiredSchedule across time (stale past blocks)', () => {
  it('releases the engineKey from a pinned holder when the engine reissues its key', async () => {
    // e.g. a drag-pinned chunk keeps its key while the engine re-emits task:t1:0 for residual work
    const pinnedHolder = dbBlock({ id: 'p1', pinned: true });
    const repo = fakeRepo([pinnedHolder]);
    const reissued = eBlock({ start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z') });
    const res = await applyDesiredSchedule(repo, 'u1', desired([reissued]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(repo.update).toHaveBeenCalledWith('u1', 'p1', { engineKey: null });
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({ engineKey: 'task:t1:0' }));
    expect(repo.delete).not.toHaveBeenCalled(); // the pinned row itself is untouched apart from the key release
  });

  const LATER = Date.parse('2026-01-12T00:00:00.000Z'); // a week after the seeded block
  const LATER_HORIZON = LATER + 24 * 60 * 60 * 1000;

  it('moves a stale past block forward when the engine reuses its key (no unique collision)', async () => {
    const repo = fakeRepo([dbBlock()]); // task:t1:0 placed 2026-01-05, entirely in the past
    const reissued = eBlock({ start: Date.parse('2026-01-12T09:00:00.000Z'), end: Date.parse('2026-01-12T10:00:00.000Z') });
    const res = await applyDesiredSchedule(repo, 'u1', desired([reissued]), { now: LATER, horizonEnd: LATER_HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('u1', 'b1', {
      startsAt: new Date('2026-01-12T09:00:00.000Z'), endsAt: new Date('2026-01-12T10:00:00.000Z'), title: 'A',
    });
  });

  it('preserves past blocks whose keys are no longer desired (history kept)', async () => {
    const repo = fakeRepo([dbBlock()]); // key task:t1:0 not desired anymore
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: LATER, horizonEnd: LATER_HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('replan idempotence across a moving `now`', () => {
  // Regression: today's habit allowed-window used to start at `now`, and the engine keys
  // a capped occurrence by that start — so every replan (including the 5-minute poll)
  // reissued a fresh key and churned the row plus its mirrored Google event.
  it('re-planning unchanged data a few minutes later is a complete no-op', async () => {
    const T0 = Date.parse('2026-01-05T08:00:00.000Z'); // Monday, an hour before working hours
    const T1 = Date.parse('2026-01-05T08:30:00.000Z'); // same day, placement still in the future

    const blocks = fakeRepo([]);
    const repos = {
      ...fakeRepos({
        settings: makeSettings({ horizonDays: 1 }),
        habits: [makeHabit({ eligibleDays: [1], perPeriod: 1 })], // Mondays, once a week
      }),
      // The block store is the live one, so the second plan sees what the first wrote.
      scheduledBlocks: { listByUserInRange: async () => blocks.rows() },
    };

    const first = await planLocally(repos, blocks, 'u1', T0);
    expect(first).toMatchObject({ created: 1, updated: 0, deleted: 0 });

    const second = await planLocally(repos, blocks, 'u1', T1);
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(blocks.rows()).toHaveLength(1);
    // Review 18: the free timeline now spans the whole day, but the habit is still
    // placed at the working-hours start (09:00) rather than at `now` — the engine's
    // middle fallback tier. That is what keeps this replan idempotent: a placement
    // at `now` would be in the past 30 minutes later and get dragged along.
    expect(blocks.rows()[0]!.startsAt).toEqual(new Date('2026-01-05T09:00:00.000Z'));
  });

  // Review 21 replaces the Review 18 trade-off (the same occurrence chasing `now` all
  // day): once a habit block's start has passed it is history — missed or done, the app
  // has no habit-completion concept — so its day is consumed, the engine emits nothing
  // for it, and the row stays exactly where the user last saw it.
  it('freezes a preference-less habit block once its start has passed', async () => {
    const T0 = Date.parse('2026-01-05T08:00:00.000Z');
    const T1 = Date.parse('2026-01-05T08:30:00.000Z');

    const blocks = fakeRepo([]);
    const repos = {
      ...fakeRepos({
        settings: makeSettings({ horizonDays: 1 }),
        habits: [makeHabit({ eligibleDays: [1], perPeriod: 1 })], // no preferred window
        // A meeting swallowing the entire 09:00–17:00 working day.
        events: [makeEvent({
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T17:00:00.000Z'),
        })],
      }),
      scheduledBlocks: { listByUserInRange: async () => blocks.rows() },
    };

    await planLocally(repos, blocks, 'u1', T0);
    expect(blocks.rows()[0]!.startsAt).toEqual(new Date('2026-01-05T08:00:00.000Z'));

    const second = await planLocally(repos, blocks, 'u1', T1);
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(blocks.rows()).toHaveLength(1);
    expect(blocks.rows()[0]!.startsAt).toEqual(new Date('2026-01-05T08:00:00.000Z'));
  });
});
