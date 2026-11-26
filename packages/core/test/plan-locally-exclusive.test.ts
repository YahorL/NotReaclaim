import { describe, it, expect } from 'vitest';
import type { ScheduledBlock as DbScheduledBlock, CreateScheduledBlockInput, UpdateScheduledBlockInput } from '@notreclaim/db';
import { planLocally } from '../src/apply.js';
import { fakeRepos, makeBlock, makeSettings, makeTask } from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday
const at = (hm: string) => new Date(`2026-01-05T${hm}:00.000Z`);

class NotFoundError extends Error { override name = 'NotFoundError'; } // apply matches it by name

/**
 * A Postgres-like block store: reads return COPIES (a snapshot, like rows off the wire) and
 * every write stamps updatedAt. It has two read views of the same rows — one for assemble
 * (`repos.scheduledBlocks`) and one for apply (the `blocks` argument) — so a test can fire
 * a hook right after APPLY has taken its snapshot, i.e. a route write committing in the
 * window between apply's read and its writes.
 */
function dbLikeBlocks(seed: DbScheduledBlock[]) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  let clock = 1;
  let n = 0;
  let afterApplyRead: (() => void) | null = null;
  const copy = (r: DbScheduledBlock): DbScheduledBlock => ({ ...r });
  const list = (s: Date, e: Date) => [...rows.values()].filter((r) => r.startsAt < e && r.endsAt > s).map(copy);
  const blocks = {
    async listByUserInRange(_u: string, s: Date, e: Date) {
      const snapshot = list(s, e);
      const hook = afterApplyRead;
      afterApplyRead = null;
      hook?.();
      return snapshot;
    },
    async create(userId: string, data: CreateScheduledBlockInput) {
      const row = makeBlock({ ...data, id: `new-${++n}`, userId, updatedAt: new Date(++clock) });
      rows.set(row.id, row);
      return copy(row);
    },
    async update(_u: string, id: string, data: UpdateScheduledBlockInput) {
      const r = rows.get(id);
      if (!r) throw new NotFoundError(id);
      Object.assign(r, data, { updatedAt: new Date(++clock) });
      return copy(r);
    },
    async delete(_u: string, id: string) {
      if (!rows.delete(id)) throw new NotFoundError(id);
    },
  };
  return {
    blocks,
    assembleView: { listByUserInRange: async (_u: string, s: Date, e: Date) => list(s, e) },
    onApplyRead(fn: () => void) { afterApplyRead = fn; },
    row: (id: string) => { const r = rows.get(id); return r ? copy(r) : undefined; },
  };
}

/** The same FIFO algorithm as the server's createUserLock, bound to one user. */
function fifoLock() {
  let tail: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = tail;
    let release!: () => void;
    tail = prev.then(() => new Promise<void>((resolve) => { release = resolve; }));
    return prev.then(async () => {
      try { return await fn(); } finally { release(); }
    });
  };
}

// Exactly what PATCH /schedule/:id writes for a planner drag (InteractiveBlock sends pinned: true).
const DROP: UpdateScheduledBlockInput = { startsAt: at('14:00'), endsAt: at('15:00'), pinned: true };
// A 60-min task with 30-min max chunks: the engine emits two 30-min chunks, so chunk 0 can never
// equal this seeded 60-min row — apply always has a write to make for it.
const autoB = () => makeBlock({ id: 'b', taskId: 't1', engineKey: 'task:t1:0', startsAt: at('09:00'), endsAt: at('10:00'), title: 'Task' });

function setup() {
  const store = dbLikeBlocks([autoB()]);
  const repos = {
    ...fakeRepos({ settings: makeSettings(), tasks: [makeTask({ id: 't1', durationMs: 3_600_000 })] }),
    scheduledBlocks: store.assembleView,
  };
  return { store, repos };
}

describe('planLocally with an exclusive section (per-user lock)', () => {
  it('a drag that arrives during a local replan commits after it, not under it', async () => {
    const { store, repos } = setup();
    const lock = fifoLock();
    let route: Promise<unknown> | undefined;
    // The route takes the same lock the replan runs in, right after apply has read its rows.
    store.onApplyRead(() => { route = lock(() => store.blocks.update('u1', 'b', DROP)); });

    await planLocally(repos, store.blocks, 'u1', NOW, lock);
    expect(route).toBeDefined(); // the hook fired: apply really did read while the drag was pending
    await route;

    expect(store.row('b')).toMatchObject({ startsAt: at('14:00'), endsAt: at('15:00'), pinned: true });
  });

  it('runs the settings read, the compute read and the whole apply inside the section; nothing outside', async () => {
    const { store, repos } = setup();
    const log: string[] = [];
    const tracedRepos = {
      ...repos,
      settings: { getByUserId: async (u: string) => { log.push('settings'); return repos.settings.getByUserId(u); } },
      scheduledBlocks: { listByUserInRange: async (u: string, s: Date, e: Date) => { log.push('assemble read'); return repos.scheduledBlocks.listByUserInRange(u, s, e); } },
    };
    const blocks = {
      ...store.blocks,
      listByUserInRange: async (u: string, s: Date, e: Date) => { log.push('apply read'); return store.blocks.listByUserInRange(u, s, e); },
      update: async (u: string, id: string, d: UpdateScheduledBlockInput) => { log.push('apply write'); return store.blocks.update(u, id, d); },
      create: async (u: string, d: CreateScheduledBlockInput) => { log.push('apply write'); return store.blocks.create(u, d); },
    };
    const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
      log.push('enter');
      try { return await fn(); } finally { log.push('exit'); }
    };

    const counts = await planLocally(tracedRepos, blocks, 'u1', NOW, exclusive);

    expect(counts).toMatchObject({ created: 1, updated: 1, pinned: 0, removed: 0 });
    const enter = log.indexOf('enter');
    const exit = log.indexOf('exit');
    expect(log.slice(0, enter)).toEqual([]);
    // ONE settings read, shared by assemble and apply: the tracking mode cannot change between them.
    expect(log.slice(enter + 1, exit).filter((e) => e === 'settings')).toHaveLength(1);
    expect(log.slice(enter + 1, exit)).toContain('assemble read');
    expect(log.slice(enter + 1, exit)).toContain('apply read');
    expect(log.slice(enter + 1, exit).filter((e) => e === 'apply write')).toHaveLength(2);
    expect(log.slice(exit + 1)).toEqual([]);
  });

  it('a failing apply rejects through the section (the lock is released by its owner)', async () => {
    const { store, repos } = setup();
    const boom = new Error('db down');
    const blocks = { ...store.blocks, listByUserInRange: async () => { throw boom; } };
    let exited = false;
    const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
      try { return await fn(); } finally { exited = true; }
    };
    await expect(planLocally(repos, blocks, 'u1', NOW, exclusive)).rejects.toBe(boom);
    expect(exited).toBe(true);
  });
});

describe('planLocally reads the tracking mode once, inside the section', () => {
  // Pieces 09:00–10:00 (task:t1:0, running at 09:30) and 10:00–11:00 (task:t1:1) of a 2 h task.
  const NOW_RUNNING = Date.parse('2026-01-05T09:30:00.000Z');
  const pieces = () => [
    makeBlock({ id: 'p0', taskId: 't1', engineKey: 'task:t1:0', startsAt: at('09:00'), endsAt: at('10:00'), title: 'Task' }),
    makeBlock({ id: 'p1', taskId: 't1', engineKey: 'task:t1:1', startsAt: at('10:00'), endsAt: at('11:00'), title: 'Task' }),
  ];
  /** The setting is flipped while the replan waits for the lock (e.g. a PUT /settings landing first). */
  async function flipDuringWait(from: boolean) {
    const store = dbLikeBlocks(pieces());
    let requireStartToTrack = from;
    const settings = () => makeSettings({
      requireStartToTrack, workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] as never,
    });
    const repos = {
      ...fakeRepos({ tasks: [makeTask({ id: 't1', title: 'Task', durationMs: 7_200_000, minChunkMs: 1_800_000, maxChunkMs: 3_600_000 })] }),
      settings: { getByUserId: async () => settings() },
      scheduledBlocks: store.assembleView,
    };
    const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => { requireStartToTrack = !from; return fn(); };
    const counts = await planLocally(repos, store.blocks, 'u1', NOW_RUNNING, exclusive);
    const rows = (await store.assembleView.listByUserInRange('u1', new Date(0), new Date(8.64e15)))
      .map((r) => `${r.engineKey} ${r.startsAt.toISOString().slice(11, 16)}-${r.endsAt.toISOString().slice(11, 16)}`);
    return { counts, rows };
  }

  it('switched to automatic while waiting: the running piece is frozen whole, nothing is created over it', async () => {
    const { counts, rows } = await flipDuringWait(true);
    expect(counts).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(rows).toEqual(['task:t1:0 09:00-10:00', 'task:t1:1 10:00-11:00']);
  });

  it('switched to manual while waiting: plain manual behaviour (the un-started piece slides), no echo copy', async () => {
    const { counts, rows } = await flipDuringWait(false);
    expect(counts).toMatchObject({ created: 0, deleted: 0 });
    expect(rows).toEqual(['task:t1:0 09:30-10:30', 'task:t1:1 10:30-11:30']);
  });
});
