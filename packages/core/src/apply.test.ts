import { describe, it, expect, vi } from 'vitest';
import type { ScheduledBlock as DbScheduledBlock } from '@notreclaim/db';
import type { ScheduleResult } from '@notreclaim/scheduler';
import { applyDesiredSchedule, type ScheduleMirror } from './apply.js';

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
});

describe('planLocally', () => {
  const settings = {
    id: 's1', userId: 'u1', timezone: 'utc',
    workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
    horizonDays: 1, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 1_800_000,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const task = {
    id: 't1', userId: 'u1', title: 'T', priority: 1, durationMs: 1_800_000,
    dueBy: new Date('2026-01-05T17:00:00.000Z'), minChunkMs: 1_800_000, maxChunkMs: 1_800_000,
    category: null, status: 'pending', timeLoggedMs: 0, createdAt: new Date(0), updatedAt: new Date(0),
  };
  function repos(over: Record<string, unknown> = {}) {
    return {
      settings: { getByUserId: async () => settings },
      calendarEvents: { listByUserInRange: async () => [] },
      tasks: { listByUser: async () => [task] },
      habits: { listByUser: async () => [] },
      scheduledBlocks: { listByUserInRange: async () => [] },
      ...over,
    } as never;
  }

  it('persists the computed schedule with no mirror and returns the {…,pinned:0,removed:0} shape', async () => {
    const { planLocally } = await import('./apply.js');
    const blocks = fakeRepo([]);
    const res = await planLocally(repos(), blocks, 'u1', NOW);
    expect(res.pinned).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.created).toBeGreaterThan(0);
    expect(blocks.rows().every((b) => b.googleEventId === null)).toBe(true);
  });

  it('throws SettingsRequiredError when settings are missing', async () => {
    const { planLocally } = await import('./apply.js');
    const { SettingsRequiredError } = await import('./errors.js');
    const blocks = fakeRepo([]);
    await expect(planLocally(repos({ settings: { getByUserId: async () => null } }), blocks, 'u1', NOW))
      .rejects.toBeInstanceOf(SettingsRequiredError);
  });
});
