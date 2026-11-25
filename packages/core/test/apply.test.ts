import { describe, it, expect, vi } from 'vitest';
import type { ScheduledBlock as DbScheduledBlock, CreateScheduledBlockInput, UpdateScheduledBlockInput } from '@notreclaim/db';
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
    pinned: false, googleEventId: null, googleCalendarId: null, engineKey: 'task:t1:0', startedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
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
    create: vi.fn(async (userId: string, data: CreateScheduledBlockInput) => {
      const row = dbBlock({ id: `new-${++n}`, userId, ...data });
      rows.push(row); return row;
    }),
    update: vi.fn(async (_u: string, id: string, data: UpdateScheduledBlockInput) => {
      const row = rows.find((r) => r.id === id)!; Object.assign(row, data); return row;
    }),
    delete: vi.fn(async (_u: string, id: string) => { rows = rows.filter((r) => r.id !== id); }),
  };
}

describe('applyDesiredSchedule (local, no mirror)', () => {
  it('creates a new block with null google fields and engineKey set', async () => {
    const repo = fakeRepo([]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.create).toHaveBeenCalledWith('u1', expect.objectContaining({
      engineKey: 'task:t1:0', googleEventId: null, googleCalendarId: null, title: 'A',
    }));
  });

  it('updates a keyed block whose times changed', async () => {
    const repo = fakeRepo([dbBlock()]);
    const moved = eBlock({ start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z') });
    const res = await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
  });

  it('updates a keyed block whose title changed even when its times are identical', async () => {
    // e.g. renaming a habit: Review 17 made kept slots byte-identical, so times never differ
    const repo = fakeRepo([dbBlock({ title: 'Old name' })]);
    const renamed = eBlock({ title: 'New name' });
    const res = await applyDesiredSchedule(repo, 'u1', desired([renamed]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.update).toHaveBeenCalledWith('u1', 'b1', expect.objectContaining({ title: 'New name' }));
    expect(repo.rows()[0]!.title).toBe('New name');
  });

  it('writes title and times in a single update when both changed', async () => {
    const repo = fakeRepo([dbBlock({ title: 'Old name' })]);
    const moved = eBlock({
      title: 'New name',
      start: Date.parse('2026-01-05T11:00:00.000Z'), end: Date.parse('2026-01-05T12:00:00.000Z'),
    });
    const res = await applyDesiredSchedule(repo, 'u1', desired([moved]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
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
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deletes a keyed block no longer desired, and leaves pinned blocks untouched', async () => {
    const repo = fakeRepo([dbBlock(), dbBlock({ id: 'b2', engineKey: 'task:t9:0' }), dbBlock({ id: 'p1', pinned: true, engineKey: null })]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([eBlock()]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 1, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
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
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(mirror.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New name' }),
      expect.objectContaining({ id: 'b1' }),
    );
    expect(mirror.create).not.toHaveBeenCalled();
    expect(mirror.delete).not.toHaveBeenCalled();
  });
});

describe('applyDesiredSchedule (pinned blocks are mirrored too)', () => {
  const pinned = (over: Partial<DbScheduledBlock> = {}) =>
    dbBlock({ id: 'p1', pinned: true, engineKey: null, ...over });
  const stubMirror = (): ScheduleMirror => ({
    create: vi.fn(async () => ({ googleEventId: 'g1', googleCalendarId: 'cal1' })),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  });
  const snapshot = (over: { start?: number; end?: number; title?: string | null; updatedAt?: number } = {}) =>
    new Map([['g1', {
      start: Date.parse('2026-01-05T09:00:00.000Z'),
      end: Date.parse('2026-01-05T10:00:00.000Z'),
      title: 'A' as string | null,
      ...over,
    }]]);

  it('creates the missing external event for a pinned block and stores the ids on the same row', async () => {
    // The POST /schedule state: pinned, googleEventId null — invisible to the engine diff.
    const repo = fakeRepo([pinned()]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(mirror.create).toHaveBeenCalledTimes(1);
    expect(mirror.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', sourceType: 'task', sourceId: 't1', title: 'A' }));
    expect(repo.create).not.toHaveBeenCalled(); // the row exists: update it, never re-create it
    expect(repo.update).toHaveBeenCalledWith('u1', 'p1', { googleEventId: 'g1', googleCalendarId: 'cal1' });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 1, pinnedFailed: 0, attached: 0, attachFailed: 0 });
  });

  it('does not mirror a pinned block without a mirror (local planning)', async () => {
    const repo = fakeRepo([pinned()]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('does not mirror a pinned block that has already ended', async () => {
    const repo = fakeRepo([pinned()]);
    const mirror = stubMirror();
    const later = Date.parse('2026-01-06T00:00:00.000Z');
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: later, horizonEnd: later + 1, mirror });
    expect(mirror.create).not.toHaveBeenCalled();
    expect(res.pinnedSynced).toBe(0);
  });

  it('pushes a pinned block whose stored times diverge from the mirror snapshot', async () => {
    const repo = fakeRepo([pinned({
      googleEventId: 'g1', googleCalendarId: 'cal1',
      startsAt: new Date('2026-01-05T13:00:00.000Z'), endsAt: new Date('2026-01-05T14:00:00.000Z'),
    })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror, mirrorSnapshot: snapshot(),
    });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(mirror.update).toHaveBeenCalledWith(
      expect.objectContaining({ start: Date.parse('2026-01-05T13:00:00.000Z') }),
      expect.objectContaining({ id: 'p1' }),
    );
    expect(mirror.create).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 1, pinnedFailed: 0, attached: 0, attachFailed: 0 });
  });

  it('pushes a pinned block whose title diverges from the mirror snapshot', async () => {
    const repo = fakeRepo([pinned({ googleEventId: 'g1', googleCalendarId: 'cal1', title: 'Renamed' })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror, mirrorSnapshot: snapshot(),
    });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(res.pinnedSynced).toBe(1);
  });

  it('makes no mirror call when the snapshot already matches the pinned row (no per-cycle churn)', async () => {
    const repo = fakeRepo([pinned({ googleEventId: 'g1', googleCalendarId: 'cal1' })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror, mirrorSnapshot: snapshot(),
    });
    expect(mirror.create).not.toHaveBeenCalled();
    expect(mirror.update).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
  });

  it('does not guess when the cycle observed nothing for the pinned row', async () => {
    const repo = fakeRepo([pinned({ googleEventId: 'g1', googleCalendarId: 'cal1', title: 'Renamed' })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror, mirrorSnapshot: new Map(),
    });
    expect(mirror.update).not.toHaveBeenCalled();
    expect(res.pinnedSynced).toBe(0);
  });

  it('does not push a stale title over a Google rename that is newer than the row', async () => {
    // detectDrift compares TIMES only, so a Google-side rename never reaches the row —
    // pushing it back here would silently discard the user's calendar edit.
    const repo = fakeRepo([pinned({
      googleEventId: 'g1', googleCalendarId: 'cal1', title: 'App title',
      updatedAt: new Date('2026-01-05T08:00:00.000Z'),
    })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror,
      mirrorSnapshot: snapshot({ title: 'Renamed on Google', updatedAt: Date.parse('2026-01-05T08:30:00.000Z') }),
    });
    expect(mirror.update).not.toHaveBeenCalled();
    expect(res.pinnedSynced).toBe(0);
  });

  it('pushes the title when the row was edited more recently than the Google event', async () => {
    const repo = fakeRepo([pinned({
      googleEventId: 'g1', googleCalendarId: 'cal1', title: 'Renamed in app',
      updatedAt: new Date('2026-01-05T08:30:00.000Z'),
    })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror,
      mirrorSnapshot: snapshot({ title: 'App title', updatedAt: Date.parse('2026-01-05T08:00:00.000Z') }),
    });
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(mirror.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed in app' }),
      expect.objectContaining({ id: 'p1' }),
    );
    expect(res.pinnedSynced).toBe(1);
  });

  it('isolates a failing pinned row: later rows still sync and the failure is counted', async () => {
    // A deterministically-failing row used to reject the whole pass -> the whole reconcile
    // -> no schedule.updated event, i.e. live updates dead for that user until it was fixed.
    const repo = fakeRepo([pinned({ id: 'p1' }), pinned({ id: 'p2' })]);
    const create = vi.fn(async (block: { id: string }) => {
      if (block.id === 'p1') throw new Error('google 500');
      return { googleEventId: 'g2', googleCalendarId: 'cal1' };
    });
    const mirror = { ...stubMirror(), create } as unknown as ScheduleMirror;

    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror });

    expect(create).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenCalledWith('u1', 'p2', { googleEventId: 'g2', googleCalendarId: 'cal1' });
    expect(repo.update).not.toHaveBeenCalledWith('u1', 'p1', expect.anything());
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 1, pinnedFailed: 1, attached: 0, attachFailed: 0 });
  });

  it('skips a pinned row that belongs to neither a task nor a habit', async () => {
    const repo = fakeRepo([pinned({ taskId: null, habitId: null })]);
    const mirror = stubMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(mirror.create).not.toHaveBeenCalled();
    expect(res.pinnedSynced).toBe(0);
  });
});

/**
 * Engine rows with no external event yet (planned locally before the calendar was linked).
 * The first reconcile after linking can make dozens of sequential inserts, so one rejected
 * insert must not abort the apply, and an insert whose row vanished mid-apply (DELETE
 * /schedule/:id runs outside the replan queue) must not leave an orphan event behind.
 */
describe('applyDesiredSchedule (unmirrored engine rows)', () => {
  /** Mimics @notreclaim/db's NotFoundError (core recognises it by name, see apply.ts). */
  class NotFoundError extends Error {
    constructor(message: string) { super(message); this.name = 'NotFoundError'; }
  }

  const at = (hh: number) => ({
    startsAt: new Date(`2026-01-05T${String(hh).padStart(2, '0')}:00:00.000Z`),
    endsAt: new Date(`2026-01-05T${String(hh).padStart(2, '0')}:30:00.000Z`),
  });
  const ms = (hh: number) => ({ start: at(hh).startsAt.getTime(), end: at(hh).endsAt.getTime() });
  const row = (t: string, hh: number, over: Partial<DbScheduledBlock> = {}) =>
    dbBlock({ id: `b-${t}`, taskId: t, engineKey: `task:${t}:0`, title: t, ...at(hh), ...over });
  const want = (t: string, hh: number) => eBlock({ id: `task:${t}:0`, sourceId: t, title: t, ...ms(hh) });

  /**
   * A mirror that behaves like reconcile's: `update` of a never-mirrored row inserts. Inserts
   * for the block ids in `failing` throw (Google 403/429/5xx); every insert ever attempted is
   * recorded so a test can prove nothing was inserted twice.
   */
  function insertingMirror(opts: { failing?: Set<string>; deleteFails?: boolean } = {}) {
    let n = 0;
    const inserted: string[] = [];
    const create = vi.fn(async (block: { id: string }) => {
      if (opts.failing?.has(block.id)) throw Object.assign(new Error('google 429'), { rowScoped: true });
      inserted.push(block.id);
      return { googleEventId: `g-${++n}`, googleCalendarId: 'cal1' };
    });
    const mirror = {
      create,
      update: vi.fn(async (block: { id: string }, existing: DbScheduledBlock) =>
        existing.googleEventId == null ? create(block) : undefined),
      delete: vi.fn(async (_existing: DbScheduledBlock) => {
        if (opts.deleteFails) throw new Error('google 503');
      }),
    };
    return { mirror: mirror as unknown as ScheduleMirror & typeof mirror, inserted };
  }

  /** The caller's row-scoped predicate for the errors insertingMirror throws (Google answered about one event). */
  const googleAnswered = (err: unknown) => (err as { rowScoped?: boolean }).rowScoped === true;

  /** A repo whose `update` of `goneId` finds the row deleted by a concurrent writer. */
  function vanishingRepo(seed: DbScheduledBlock[], goneId: string) {
    const repo = fakeRepo(seed);
    const real = repo.update.getMockImplementation()!;
    repo.update.mockImplementation(async (u, id, data) => {
      if (id === goneId) {
        await repo.delete(u, id);
        throw new NotFoundError(`ScheduledBlock ${id} not found for user`);
      }
      return real(u, id, data);
    });
    return repo;
  }

  it('B1 unchanged: one failing insert is isolated; the rest of the apply still runs and the row is retried once', async () => {
    const repo = fakeRepo([
      row('t1', 9), row('t2', 10), row('t3', 11),
      row('t9', 15), // stale: no longer desired -> swept
      dbBlock({ id: 'p1', pinned: true, engineKey: null, ...at(16) }),
    ]);
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11), want('t4', 12)]);
    const first = insertingMirror({ failing: new Set(['task:t2:0']) });

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror: first.mirror, isRowScoped: googleAnswered });

    expect(res).toEqual({
      created: 1, updated: 0, deleted: 1, pinnedSynced: 1, pinnedFailed: 0, attached: 2, attachFailed: 1,
    });
    const byKey = (k: string) => repo.rows().find((r) => r.engineKey === k)!;
    expect(byKey('task:t1:0').googleEventId).not.toBeNull();
    expect(byKey('task:t2:0').googleEventId).toBeNull(); // left unmirrored, to retry
    expect(byKey('task:t3:0').googleEventId).not.toBeNull(); // later rows still mirrored
    expect(byKey('task:t4:0').googleEventId).not.toBeNull(); // later desired blocks still created
    expect(repo.rows().some((r) => r.id === 'b-t9')).toBe(false); // sweep ran
    expect(repo.rows().find((r) => r.id === 'p1')!.googleEventId).not.toBeNull(); // pinned pass ran

    const second = insertingMirror();
    const again = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror: second.mirror });

    expect(again).toEqual({
      created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 1, attachFailed: 0,
    });
    expect(second.inserted).toEqual(['task:t2:0']);
    const everInserted = [...first.inserted, ...second.inserted];
    expect(new Set(everInserted).size).toBe(everInserted.length); // nothing inserted twice
    expect(repo.rows().every((r) => r.googleEventId != null)).toBe(true);
  });

  it('B1 changed: a failing insert still moves the row in the DB; it is mirrored next cycle as an unchanged row', async () => {
    const repo = fakeRepo([
      row('t1', 9), row('t2', 14), row('t3', 11), // t2 sits off its desired 10:00 slot
      row('t9', 15),
      dbBlock({ id: 'p1', pinned: true, engineKey: null, ...at(16) }),
    ]);
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11), want('t4', 12)]);
    const first = insertingMirror({ failing: new Set(['task:t2:0']) });

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror: first.mirror, isRowScoped: googleAnswered });

    expect(res).toEqual({
      created: 1, updated: 1, deleted: 1, pinnedSynced: 1, pinnedFailed: 0, attached: 2, attachFailed: 1,
    });
    const t2 = repo.rows().find((r) => r.engineKey === 'task:t2:0')!;
    expect(t2.startsAt).toEqual(at(10).startsAt); // the plan itself still applied
    expect(t2.googleEventId).toBeNull();
    expect(repo.rows().find((r) => r.engineKey === 'task:t3:0')!.googleEventId).not.toBeNull();
    expect(repo.rows().find((r) => r.engineKey === 'task:t4:0')!.googleEventId).not.toBeNull();
    expect(repo.rows().some((r) => r.id === 'b-t9')).toBe(false);
    expect(repo.rows().find((r) => r.id === 'p1')!.googleEventId).not.toBeNull();

    const second = insertingMirror();
    const again = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror: second.mirror });

    expect(again).toEqual({
      created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 1, attachFailed: 0,
    });
    expect(second.inserted).toEqual(['task:t2:0']);
    expect(repo.rows().every((r) => r.googleEventId != null)).toBe(true);
  });

  it('B1 changed: a successful insert stores the ids with the move and counts as updated AND attached', async () => {
    const repo = fakeRepo([row('t1', 14)]);
    const { mirror } = insertingMirror();
    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9)]), { now: NOW, horizonEnd: HORIZON, mirror });
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 1, attachFailed: 0 });
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.rows()[0]).toMatchObject({ googleEventId: 'g-1', googleCalendarId: 'cal1', startsAt: at(9).startsAt });
  });

  it('B2 unchanged: a row deleted after its event was inserted gets the event deleted; the apply carries on', async () => {
    const repo = vanishingRepo([row('t1', 9), row('t2', 10), row('t3', 11)], 'b-t2');
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11), want('t4', 12)]);
    const { mirror, inserted } = insertingMirror();

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror });

    expect(inserted).toContain('task:t2:0');
    expect(mirror.delete).toHaveBeenCalledTimes(1);
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-t2', googleEventId: 'g-2', googleCalendarId: 'cal1' }));
    // Gone is neither an attach nor a failure of the user's plan.
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 2, attachFailed: 0 });
    expect(repo.rows().map((r) => r.engineKey).sort()).toEqual(['task:t1:0', 'task:t3:0', 'task:t4:0']);
    expect(repo.rows().every((r) => r.googleEventId != null)).toBe(true);
  });

  it('B2 unchanged: a failing compensating delete is counted, never thrown', async () => {
    const repo = vanishingRepo([row('t1', 9), row('t2', 10), row('t3', 11)], 'b-t2');
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11)]);
    const { mirror } = insertingMirror({ deleteFails: true });

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror });

    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-t2', googleEventId: 'g-2' }));
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 2, attachFailed: 1 });
    expect(repo.rows().find((r) => r.engineKey === 'task:t3:0')!.googleEventId).not.toBeNull();
  });

  it('B2 changed: a row deleted after its event was inserted gets the event deleted and is not counted as updated', async () => {
    const repo = vanishingRepo([row('t1', 9), row('t2', 14), row('t3', 11)], 'b-t2');
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11)]);
    const { mirror } = insertingMirror();

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror });

    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-t2', googleEventId: 'g-2' }));
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 2, attachFailed: 0 });
  });

  it('B2 changed: a failing compensating delete is counted, never thrown', async () => {
    const repo = vanishingRepo([row('t1', 9), row('t2', 14), row('t3', 11)], 'b-t2');
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11)]);
    const { mirror } = insertingMirror({ deleteFails: true });

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON, mirror });

    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 2, attachFailed: 1 });
  });

  it('B2 pinned: a pinned row deleted after its event was inserted gets the event deleted (neither synced nor failed)', async () => {
    const repo = vanishingRepo([
      dbBlock({ id: 'p1', pinned: true, engineKey: null, ...at(9) }),
      dbBlock({ id: 'p2', pinned: true, engineKey: null, ...at(10) }),
    ], 'p1');
    const { mirror } = insertingMirror();

    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror });

    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', googleEventId: 'g-1' }));
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 1, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.rows()).toHaveLength(1);
    expect(repo.rows()[0]).toMatchObject({ id: 'p2', googleEventId: 'g-2' });
  });

  it('B2 pinned: a failing compensating delete counts as a pinned failure', async () => {
    const repo = vanishingRepo([dbBlock({ id: 'p1', pinned: true, engineKey: null, ...at(9) })], 'p1');
    const { mirror } = insertingMirror({ deleteFails: true });

    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror });

    expect(mirror.delete).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 1, attached: 0, attachFailed: 0 });
  });

  it('a non-NotFound DB failure after an insert is not mistaken for a vanished row', async () => {
    // Only the external insert is isolated: a DB failure propagates like every other DB
    // write in apply, and the row may still exist, so its event must never be deleted blind.
    const repo = fakeRepo([row('t1', 9), row('t2', 10)]);
    const real = repo.update.getMockImplementation()!;
    repo.update.mockImplementation(async (u, id, data) => {
      if (id === 'b-t1') throw new Error('connection reset');
      return real(u, id, data);
    });
    const { mirror } = insertingMirror();

    await expect(applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror,
    })).rejects.toThrow('connection reset');
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
    categoryId: null, status: 'pending', createdAt: new Date(0), updatedAt: new Date(0),
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
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
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
    expect(res).toEqual({ created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('u1', 'b1', {
      startsAt: new Date('2026-01-12T09:00:00.000Z'), endsAt: new Date('2026-01-12T10:00:00.000Z'), title: 'A',
    });
  });

  const MID_BLOCK = Date.parse('2026-01-05T09:30:00.000Z'); // inside the seeded 09:00–10:00 block

  it('keeps a habit row that has already begun when its key is no longer desired', async () => {
    const repo = fakeRepo([dbBlock({ taskId: null, habitId: 'h1', engineKey: 'habit:h1:day' })]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: MID_BLOCK, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('still sweeps a TASK row that has begun but is no longer desired', async () => {
    const repo = fakeRepo([dbBlock()]); // task:t1:0, 09:00–10:00, in progress at 09:30
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: MID_BLOCK, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 1, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.delete).toHaveBeenCalledWith('u1', 'b1');
  });

  it('still sweeps a habit row that has NOT begun yet', async () => {
    const repo = fakeRepo([dbBlock({ taskId: null, habitId: 'h1', engineKey: 'habit:h1:day' })]);
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 1, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
    expect(repo.delete).toHaveBeenCalledWith('u1', 'b1');
  });

  it('preserves past blocks whose keys are no longer desired (history kept)', async () => {
    const repo = fakeRepo([dbBlock()]); // key task:t1:0 not desired anymore
    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: LATER, horizonEnd: LATER_HORIZON });
    expect(res).toEqual({ created: 0, updated: 0, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0 });
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

    // Mid-block: begun but not ended, so only the habit rule keeps the row alive.
    const during = await planLocally(repos, blocks, 'u1', Date.parse('2026-01-05T08:15:00.000Z'));
    expect(during).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(blocks.rows()[0]!.startsAt).toEqual(new Date('2026-01-05T08:00:00.000Z'));

    const second = await planLocally(repos, blocks, 'u1', T1);
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(blocks.rows()).toHaveLength(1);
    expect(blocks.rows()[0]!.startsAt).toEqual(new Date('2026-01-05T08:00:00.000Z'));
  });
});

/**
 * One row that fails to save must not abort the user's whole replan — but only errors that
 * belong to ONE row are isolated: the db layer's NotFoundError / ConflictError (matched by
 * name), a foreign-key violation (Prisma P2003: the row's task/habit was deleted meanwhile),
 * and whatever the caller declares row-scoped (`isRowScoped`; Google's reconcile: an API answer
 * about one event). Anything else — the database or the network going away, an unknown error —
 * aborts the apply at that row, as before isolation existed. Write order is unchanged.
 */
describe('applyDesiredSchedule (per-row failure isolation in the diff loop)', () => {
  const at = (hh: number) => ({
    startsAt: new Date(`2026-01-05T${String(hh).padStart(2, '0')}:00:00.000Z`),
    endsAt: new Date(`2026-01-05T${String(hh).padStart(2, '0')}:30:00.000Z`),
  });
  const row = (t: string, hh: number, over: Partial<DbScheduledBlock> = {}) =>
    dbBlock({ id: `b-${t}`, taskId: t, engineKey: `task:${t}:0`, title: t, ...at(hh), ...over });
  const want = (t: string, hh: number) => eBlock({
    id: `task:${t}:0`, sourceId: t, title: t, start: at(hh).startsAt.getTime(), end: at(hh).endsAt.getTime(),
  });
  const mirrored = (t: string, hh: number) => row(t, hh, { googleEventId: `g-${t}`, googleCalendarId: 'cal1' });

  /** The db layer's domain errors, as core sees them (by name, like apply.ts does). */
  const named = (name: string) => Object.assign(new Error(name), { name });
  /** Prisma's error shape, as thrown untranslated by the repository (only P2002/P2025 are translated). */
  const prisma = (code: string, message = `Prisma ${code}`) => Object.assign(new Error(message), { code });
  /** A mirror error the test declares row-scoped through `isRowScoped` (Google: an answer about one event). */
  class RowScoped extends Error {}
  const isRowScoped = (err: unknown) => err instanceof RowScoped;

  /** A recording mirror: every call is logged; the listed block/row ids throw `err`. */
  function failingMirror(fails: { create?: string; update?: string; delete?: string }, err: unknown = new RowScoped('google 404')) {
    const calls: string[] = [];
    let n = 0;
    const mirror = {
      create: vi.fn(async (block: { id: string }) => {
        calls.push(`create ${block.id}`);
        if (block.id === fails.create) throw err;
        return { googleEventId: `g-new-${++n}`, googleCalendarId: 'cal1' };
      }),
      update: vi.fn(async (_block: { id: string }, existing: DbScheduledBlock) => {
        calls.push(`update ${existing.id}`);
        if (existing.id === fails.update) throw err;
        return undefined;
      }),
      delete: vi.fn(async (existing: DbScheduledBlock) => {
        calls.push(`delete ${existing.id}`);
        if (existing.id === fails.delete) throw err;
      }),
    };
    return { mirror: mirror as unknown as ScheduleMirror & typeof mirror, calls };
  }

  /** fakeRepo whose `method` throws `err` for one id (create: for one engineKey), recording every write. */
  function failingRepo(seed: DbScheduledBlock[], method: 'create' | 'update' | 'delete', failId: string, err: unknown) {
    const repo = fakeRepo(seed);
    const writes: string[] = [];
    const realCreate = repo.create.getMockImplementation()!;
    const realUpdate = repo.update.getMockImplementation()!;
    const realDelete = repo.delete.getMockImplementation()!;
    repo.create.mockImplementation(async (u, data) => {
      writes.push(`create ${data.engineKey}`);
      if (method === 'create' && (failId === '*' || data.engineKey === failId)) throw err;
      return realCreate(u, data);
    });
    repo.update.mockImplementation(async (u, id, data) => {
      writes.push(`update ${id}`);
      if (method === 'update' && (failId === '*' || id === failId)) throw err;
      return realUpdate(u, id, data);
    });
    repo.delete.mockImplementation(async (u, id) => {
      writes.push(`delete ${id}`);
      if (method === 'delete' && (failId === '*' || id === failId)) throw err;
      return realDelete(u, id);
    });
    return { repo, writes };
  }

  it('a create that hits a foreign key (its task was just deleted) is skipped and counted; everything else applies', async () => {
    const { repo, writes } = failingRepo([row('t1', 14), row('t9', 15)], 'create', 'task:t3:0', prisma('P2003'));
    const plan = desired([want('t1', 9), want('t2', 10), want('t3', 11), want('t4', 12)]);

    const res = await applyDesiredSchedule(repo, 'u1', plan, { now: NOW, horizonEnd: HORIZON });

    expect(res).toMatchObject({
      created: 2, updated: 1, deleted: 1, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0, createFailed: 1,
    });
    expect(writes).toEqual(['update b-t1', 'create task:t2:0', 'create task:t3:0', 'create task:t4:0', 'delete b-t9']);
    expect(repo.rows().map((r) => r.engineKey).sort()).toEqual(['task:t1:0', 'task:t2:0', 'task:t4:0']);
  });

  it.each([
    ['NotFoundError (the row went with its deleted task)', named('NotFoundError')],
    ['ConflictError', named('ConflictError')],
    ['a foreign-key violation (P2003)', prisma('P2003')],
  ])('a DB update failing with %s is isolated', async (_name, err) => {
    const { repo, writes } = failingRepo([row('t1', 14), row('t2', 15), row('t3', 16)], 'update', 'b-t2', err);

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), { now: NOW, horizonEnd: HORIZON });

    expect(res).toMatchObject({ updated: 2, updateFailed: 1 });
    expect(writes).toEqual(['update b-t1', 'update b-t2', 'update b-t3']);
  });

  it.each([
    ['the database is unreachable (P1001)', prisma('P1001', "Can't reach database server")],
    ['a connection reset', new Error('connection reset')],
    ['an unknown error', new Error('boom')],
  ])('a DB update failing because %s aborts the apply at the first row', async (_name, err) => {
    const { repo, writes } = failingRepo([row('t1', 14), row('t2', 15), row('t3', 16)], 'update', '*', err);

    await expect(applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), {
      now: NOW, horizonEnd: HORIZON, isRowScoped: () => false,
    })).rejects.toBe(err);
    expect(writes).toEqual(['update b-t1']);
  });

  it('a DB failure aborts even when the mirror declares its own errors row-scoped (no Google call for later rows)', async () => {
    const down = prisma('P1001');
    const { repo } = failingRepo([mirrored('t1', 14), mirrored('t2', 15), mirrored('t3', 16)], 'update', '*', down);
    const { mirror, calls } = failingMirror({});

    await expect(applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), {
      now: NOW, horizonEnd: HORIZON, mirror, isRowScoped,
    })).rejects.toBe(down);
    expect(calls).toEqual(['update b-t1']); // exactly one Google push, then stop
  });

  it('a row-scoped Google insert failure for a new block skips its DB create (Google first) and is counted', async () => {
    const repo = fakeRepo([]);
    const { mirror, calls } = failingMirror({ create: 'task:t2:0' });

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toMatchObject({ created: 2, createFailed: 1 });
    expect(calls).toEqual(['create task:t1:0', 'create task:t2:0', 'create task:t3:0']);
    expect(repo.rows().map((r) => r.engineKey)).toEqual(['task:t1:0', 'task:t3:0']);
  });

  it('a never-mirrored changed row whose insert AND move both fail is counted once, as updateFailed', async () => {
    // The insert failing alone counts as attachFailed (the move still lands); when the move
    // fails too, the row's plan did not apply at all — that is the one failure reported.
    const { repo } = failingRepo([row('t1', 14), row('t2', 15)], 'update', 'b-t1', named('NotFoundError'));
    const { mirror } = failingMirror({ update: 'b-t1' });

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toEqual({
      created: 0, updated: 1, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0, updateFailed: 1,
    });
  });

  it.each([
    ['a foreign-key violation (its task was just deleted)', prisma('P2003')],
    ['a unique-key conflict', named('ConflictError')],
  ])('a create rejected by %s after its Google insert deletes the just-inserted event again', async (_name, err) => {
    // The DB rejected the row outright, so nothing will ever reference the event: remove it.
    const { repo } = failingRepo([], 'create', 'task:t2:0', err);
    const { mirror, calls } = failingMirror({});

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toMatchObject({ created: 2, createFailed: 1 });
    expect(calls).toEqual(['create task:t1:0', 'create task:t2:0', 'delete ', 'create task:t3:0']);
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ googleEventId: 'g-new-2', googleCalendarId: 'cal1' }));
  });

  it('a failing compensating delete after a rejected create is swallowed: still one createFailed, the apply goes on', async () => {
    const { repo } = failingRepo([], 'create', 'task:t1:0', prisma('P2003'));
    const { mirror } = failingMirror({});
    mirror.delete.mockImplementation(async () => { throw new TypeError('fetch failed'); });

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toMatchObject({ created: 1, createFailed: 1 });
  });

  it('a create that fails for any other reason after its Google insert does NOT delete the event (the row may have committed)', async () => {
    const lost = new Error('connection reset'); // aborts the apply; the event is not touched
    const { repo } = failingRepo([], 'create', 'task:t1:0', lost);
    const { mirror } = failingMirror({});
    await expect(applyDesiredSchedule(repo, 'u1', desired([want('t1', 9)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped }))
      .rejects.toBe(lost);
    expect(mirror.delete).not.toHaveBeenCalled();
  });

  it('a mirrored row whose Google move succeeded but whose row is gone (NotFound) gets its event deleted', async () => {
    const { repo } = failingRepo([mirrored('t1', 14), mirrored('t2', 15)], 'update', 'b-t1', named('NotFoundError'));
    const { mirror, calls } = failingMirror({});

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toMatchObject({ updated: 1, updateFailed: 1 });
    expect(calls).toEqual(['update b-t1', 'delete b-t1', 'update b-t2']);
    expect(mirror.delete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-t1', googleEventId: 'g-t1' }));
  });

  it('a mirrored row whose move failed for another row-scoped reason keeps its event', async () => {
    const { repo } = failingRepo([mirrored('t1', 14)], 'update', 'b-t1', named('ConflictError'));
    const { mirror } = failingMirror({});
    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });
    expect(res).toMatchObject({ updateFailed: 1 });
    expect(mirror.delete).not.toHaveBeenCalled();
  });

  it('a row-scoped Google update failure leaves that row untouched in the DB and is counted; later rows still move', async () => {
    const repo = fakeRepo([mirrored('t1', 14), mirrored('t2', 15), mirrored('t3', 16)]);
    const { mirror, calls } = failingMirror({ update: 'b-t2' });

    const res = await applyDesiredSchedule(repo, 'u1', desired([want('t1', 9), want('t2', 10), want('t3', 11)]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toEqual({
      created: 0, updated: 2, deleted: 0, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0, updateFailed: 1,
    });
    expect(calls).toEqual(['update b-t1', 'update b-t2', 'update b-t3']);
    expect(repo.update.mock.calls.map((c) => c[1])).toEqual(['b-t1', 'b-t3']);
    expect(repo.rows().find((r) => r.id === 'b-t2')!.startsAt).toEqual(at(15).startsAt);
  });

  it('a row-scoped Google delete failure in the sweep keeps that row (and its event) and is counted', async () => {
    const repo = fakeRepo([mirrored('t7', 13), mirrored('t8', 14), mirrored('t9', 15)]);
    const { mirror, calls } = failingMirror({ delete: 'b-t8' });

    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON, mirror, isRowScoped });

    expect(res).toEqual({
      created: 0, updated: 0, deleted: 2, pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0, deleteFailed: 1,
    });
    expect(calls).toEqual(['delete b-t7', 'delete b-t8', 'delete b-t9']);
    expect(repo.rows().map((r) => r.id)).toEqual(['b-t8']);
  });

  it('a DB delete in the sweep that finds the row gone (NotFound) is counted; the other stale rows go', async () => {
    const { repo } = failingRepo([row('t7', 13), row('t8', 14), row('t9', 15)], 'delete', 'b-t8', named('NotFoundError'));

    const res = await applyDesiredSchedule(repo, 'u1', desired([]), { now: NOW, horizonEnd: HORIZON });

    expect(res).toMatchObject({ deleted: 2, deleteFailed: 1 });
  });

  it('a mirror error that is not declared row-scoped aborts: update, create, sweep delete', async () => {
    const offline = new TypeError('fetch failed');
    const upd = failingMirror({ update: 'b-t1' }, offline);
    await expect(applyDesiredSchedule(fakeRepo([mirrored('t1', 14), mirrored('t2', 15)]), 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror: upd.mirror, isRowScoped,
    })).rejects.toBe(offline);
    expect(upd.calls).toEqual(['update b-t1']);
    const create = failingMirror({ create: 'task:t1:0' }, offline);
    await expect(applyDesiredSchedule(fakeRepo([]), 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror: create.mirror, isRowScoped,
    })).rejects.toBe(offline);
    expect(create.calls).toEqual(['create task:t1:0']);
    const sweep = failingMirror({ delete: 'b-t8' }, offline);
    await expect(applyDesiredSchedule(fakeRepo([mirrored('t8', 14), mirrored('t9', 15)]), 'u1', desired([]), {
      now: NOW, horizonEnd: HORIZON, mirror: sweep.mirror, isRowScoped,
    })).rejects.toBe(offline);
    expect(sweep.calls).toEqual(['delete b-t8']);
  });

  it('a non-row-scoped error on a first insert aborts too (unchanged and changed never-mirrored rows, and storing the ids)', async () => {
    const offline = new TypeError('fetch failed');
    // Unchanged row with no event yet: the attach insert (mirror.create) throws.
    const unchanged = failingMirror({ create: 'task:t1:0' }, offline);
    await expect(applyDesiredSchedule(fakeRepo([row('t1', 9), row('t2', 10)]), 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror: unchanged.mirror, isRowScoped,
    })).rejects.toBe(offline);
    expect(unchanged.calls).toEqual(['create task:t1:0']);
    // Changed row with no event yet: the inserting mirror.update throws.
    const changed = failingMirror({ update: 'b-t1' }, offline);
    const repoB = fakeRepo([row('t1', 14), row('t2', 15)]);
    await expect(applyDesiredSchedule(repoB, 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror: changed.mirror, isRowScoped,
    })).rejects.toBe(offline);
    expect(repoB.update).not.toHaveBeenCalled(); // not even the plan's own move went through
    // Storing the inserted ids hits the database going away.
    const down = prisma('P1001');
    const repoC = fakeRepo([row('t1', 9), row('t2', 10)]);
    repoC.update.mockImplementation(async () => { throw down; });
    await expect(applyDesiredSchedule(repoC, 'u1', desired([want('t1', 9), want('t2', 10)]), {
      now: NOW, horizonEnd: HORIZON, mirror: failingMirror({}).mirror, isRowScoped,
    })).rejects.toBe(down);
  });
});
