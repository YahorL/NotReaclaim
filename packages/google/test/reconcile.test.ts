import { describe, it, expect } from 'vitest';
import { planLocally } from '@notreclaim/core';
import { reconcile } from '../src/reconcile.js';
import { GoogleApiError, GoogleAuthError, GoogleGrantRevokedError, GoogleTimeoutError } from '../src/errors.js';
import type { GoogleEventWrite } from '../src/client.js';
import {
  FakeGoogleClient,
  fakeUserRepo,
  fakeScheduledBlockStore,
  fakeSchedulingRepos,
  fakeTokenProvider,
  makeUser,
  makeSettings,
  makeTask,
  makeScheduledBlock,
} from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z'); // Monday

function buildDeps(opts: {
  store: ReturnType<typeof fakeScheduledBlockStore>;
  tasks?: ReturnType<typeof makeTask>[];
  client: FakeGoogleClient;
  user?: ReturnType<typeof makeUser>;
}) {
  const users = fakeUserRepo([opts.user ?? makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-auto' })]);
  return {
    client: opts.client,
    tokens: fakeTokenProvider(),
    users,
    scheduledBlocks: opts.store,
    schedulingRepos: fakeSchedulingRepos({ settings: makeSettings(), tasks: opts.tasks, blockStore: opts.store }),
  };
}

function googleEventsFromStore(store: ReturnType<typeof fakeScheduledBlockStore>) {
  return store.all()
    .filter((b) => b.googleEventId)
    .map((b) => ({
      id: b.googleEventId!, status: 'confirmed', summary: b.title,
      start: { dateTime: b.startsAt.toISOString() }, end: { dateTime: b.endsAt.toISOString() },
    }));
}

describe('reconcile', () => {
  it('inserts a Google event and creates a DB block for a new desired placement', async () => {
    const store = fakeScheduledBlockStore();
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.created).toBe(1);
    expect(client.insertedEvents).toHaveLength(1);
    const block = store.all()[0]!;
    expect(block.engineKey).toBe('task:t1:0');
    expect(block.googleEventId).toBe('g-evt-1');
    expect(block.googleCalendarId).toBe('cal-auto');
  });

  it('is idempotent: a second identical run makes zero Google writes', async () => {
    const store = fakeScheduledBlockStore();
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    await reconcile(deps, 'u1', NOW);

    client.listQueue = [{ events: googleEventsFromStore(store) }];
    client.insertedEvents = [];
    client.updatedEvents = [];
    client.deletedEvents = [];

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
  });

  it('deletes the Google event and DB block for a placement no longer desired', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', engineKey: 'task:gone:0', googleEventId: 'g1', googleCalendarId: 'cal-auto', pinned: false }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const deps = buildDeps({ store, tasks: [], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.deleted).toBe(1);
    expect(client.deletedEvents).toEqual([{ calendarId: 'cal-auto', googleEventId: 'g1' }]);
    expect(store.all()).toHaveLength(0);
  });

  it('leaves a pinned block alone (no delete, still present)', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', engineKey: null, googleEventId: 'g1', googleCalendarId: 'cal-auto', pinned: true }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const deps = buildDeps({ store, tasks: [], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.deleted).toBe(0);
    expect(client.deletedEvents).toHaveLength(0);
    expect(store.all().some((b) => b.id === 'b1')).toBe(true);
  });

  it('does not duplicate or crash when a pinned block fully covers a still-pending task', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: 'g1', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }]; // drift: pinned event present, unchanged
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client }); // 30-min task, fully covered

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, deleted: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(store.all().some((b) => b.id === 'b1')).toBe(true);
  });

  it('updates the Google event and DB block when an engine placement moved', async () => {
    // Seed a NON-pinned block for task t1 at the WRONG time (14:00); the engine
    // will recompute task:t1:0 at 09:00 (working-hours start), so reconcile must
    // UPDATE in place (not create/delete).
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', engineKey: 'task:t1:0', googleEventId: 'g1', googleCalendarId: 'cal-auto',
        pinned: false,
        startsAt: new Date('2026-01-05T14:00:00.000Z'),
        endsAt: new Date('2026-01-05T14:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    // drift sees the event unchanged at 14:00 (so it is neither pinned nor removed)
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(client.updatedEvents).toHaveLength(1);
    expect(client.updatedEvents[0]).toMatchObject({ calendarId: 'cal-auto', googleEventId: 'g1' });
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
    const block = store.all().find((b) => b.id === 'b1')!;
    expect(block.startsAt.toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });

  it('writes a Google event for a pinned block created in the app (POST /schedule state)', async () => {
    // Regression: POST /schedule stores {pinned:true, googleEventId:null}; the engine diff
    // skips pinned rows, so the block used to be invisible to Google forever.
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: null, googleCalendarId: null, title: 'Dragged in',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client }); // 30-min task, fully covered

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, pinnedSynced: 1 });
    expect(client.insertedEvents).toHaveLength(1);
    expect(client.insertedEvents[0]).toMatchObject({
      calendarId: 'cal-auto',
      event: {
        summary: 'Dragged in',
        startDateTime: '2026-01-05T11:00:00.000Z',
        endDateTime: '2026-01-05T11:30:00.000Z',
      },
    });
    const block = store.all().find((b) => b.id === 'b1')!;
    expect(block.googleEventId).toBe('g-evt-1');
    expect(block.googleCalendarId).toBe('cal-auto');
    expect(store.all()).toHaveLength(1); // updated in place, never re-created
  });

  it('pushes an app-side move of a pinned block to Google instead of reverting it', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: 'g1', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
        updatedAt: new Date('2026-01-05T00:00:00.000Z'), // moved in the app just now
      }),
    ]);
    const client = new FakeGoogleClient();
    // Google still holds the pre-move 09:00 slot, last touched by us yesterday.
    client.listQueue = [{ events: [{
      id: 'g1', status: 'confirmed', summary: 'Focus',
      start: { dateTime: '2026-01-05T09:00:00.000Z' }, end: { dateTime: '2026-01-05T09:30:00.000Z' },
      updated: '2026-01-04T00:00:00.000Z',
    }] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ pinned: 0, pinnedSynced: 1 });
    expect(client.updatedEvents).toHaveLength(1);
    expect(client.updatedEvents[0]).toMatchObject({
      calendarId: 'cal-auto', googleEventId: 'g1',
      event: { startDateTime: '2026-01-05T11:00:00.000Z', endDateTime: '2026-01-05T11:30:00.000Z' },
    });
    expect(store.all().find((b) => b.id === 'b1')!.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('makes no Google write for a pinned block already in sync (no per-cycle churn)', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: 'g1', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.pinnedSynced).toBe(0);
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.updatedEvents).toHaveLength(0);
  });

  it('places only the remaining chunk when a pinned block partially covers a task', async () => {
    // 60-min task, 30 min already covered by a pinned block -> engine places ONE fresh 30-min chunk
    // that coexists with the pinned block (no collision, no duplicate of the covered time).
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({
        id: 'b1', taskId: 't1', habitId: null, engineKey: null, pinned: true,
        googleEventId: 'g1', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
      }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }]; // drift: pinned event unchanged
    const deps = buildDeps({
      store,
      tasks: [makeTask({ id: 't1', durationMs: 3600000, minChunkMs: 1800000, maxChunkMs: 1800000 })],
      client,
    });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result.created).toBe(1); // only the remaining 30 min
    expect(result.deleted).toBe(0);
    expect(client.insertedEvents).toHaveLength(1);
    // the pinned block survives AND a fresh keyed block now exists for the remainder
    expect(store.all().some((b) => b.id === 'b1' && b.pinned)).toBe(true);
    expect(store.all().some((b) => b.engineKey === 'task:t1:0' && !b.pinned)).toBe(true);
  });
});

/**
 * Real Google rejects a write to an event id it never issued. The client builds the URL with
 * encodeURIComponent(id), so a null id becomes `.../events/null` -> 404. The plain fake just
 * records the call, which would hide the failure, so these tests use this stricter double.
 */
class StrictIdGoogleClient extends FakeGoogleClient {
  override async updateEvent(accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void> {
    if (!googleEventId) throw new GoogleApiError(404, `PUT events/${String(googleEventId)}: Not Found`);
    return super.updateEvent(accessToken, calendarId, googleEventId, event);
  }

  override async deleteEvent(accessToken: string, calendarId: string, googleEventId: string): Promise<void> {
    if (!googleEventId) throw new GoogleApiError(404, `DELETE events/${String(googleEventId)}: Not Found`);
    return super.deleteEvent(accessToken, calendarId, googleEventId);
  }
}

describe('reconcile: blocks planned locally before Google was linked (googleEventId null)', () => {
  /** The real pre-link state: planLocally persisted the plan with no mirror -> null Google ids. */
  async function plannedLocally(tasks: ReturnType<typeof makeTask>[]) {
    const store = fakeScheduledBlockStore();
    const repos = fakeSchedulingRepos({ settings: makeSettings(), tasks, blockStore: store });
    await planLocally(repos, store, 'u1', NOW);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ engineKey: 'task:t1:0', googleEventId: null, googleCalendarId: null });
    return store;
  }

  /** Start the next cycle from Google's real state: the events the store now claims to own. */
  function nextCycle(client: FakeGoogleClient, store: ReturnType<typeof fakeScheduledBlockStore>) {
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    client.insertedEvents = [];
    client.updatedEvents = [];
    client.deletedEvents = [];
  }

  it('changed: creates the event (never PUTs events/null), stores its id, and does not duplicate it next cycle', async () => {
    const store = await plannedLocally([makeTask({ id: 't1' })]);
    const row = store.all()[0]!;
    // Knock the row off its desired slot so the engine diff sees it as changed (back to 09:00).
    row.startsAt = new Date('2026-01-05T14:00:00.000Z');
    row.endsAt = new Date('2026-01-05T14:30:00.000Z');
    const client = new StrictIdGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0 });
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.insertedEvents).toHaveLength(1);
    expect(client.insertedEvents[0]).toMatchObject({
      calendarId: 'cal-auto',
      event: { startDateTime: '2026-01-05T09:00:00.000Z', endDateTime: '2026-01-05T09:30:00.000Z' },
    });
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ id: row.id, googleEventId: 'g-evt-1', googleCalendarId: 'cal-auto' });
    expect(store.all()[0]!.startsAt.toISOString()).toBe('2026-01-05T09:00:00.000Z');

    nextCycle(client, store);
    const second = await reconcile(deps, 'u1', NOW);

    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0, removed: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
    expect(store.all()).toHaveLength(1);
  });

  it('unchanged: mirrors the block to Google once, stores the id, and does not duplicate it next cycle', async () => {
    const store = await plannedLocally([makeTask({ id: 't1' })]);
    const rowId = store.all()[0]!.id;
    const client = new StrictIdGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, deleted: 0 });
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.insertedEvents).toHaveLength(1);
    expect(client.insertedEvents[0]).toMatchObject({
      calendarId: 'cal-auto',
      event: { startDateTime: '2026-01-05T09:00:00.000Z', endDateTime: '2026-01-05T09:30:00.000Z' },
    });
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ id: rowId, googleEventId: 'g-evt-1', googleCalendarId: 'cal-auto' });

    nextCycle(client, store);
    const second = await reconcile(deps, 'u1', NOW);

    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0, removed: 0 });
    expect(client.insertedEvents).toHaveLength(0);
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
    expect(store.all()).toHaveLength(1);
  });

  it('removed: drops the row without calling Google delete on a null id', async () => {
    const store = await plannedLocally([makeTask({ id: 't1' })]);
    const client = new StrictIdGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [], client }); // the task is gone: its block is no longer desired

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 1 });
    expect(client.deletedEvents).toHaveLength(0);
    expect(client.insertedEvents).toHaveLength(0);
    expect(store.all()).toHaveLength(0);
  });
});

describe('reconcile: never-mirrored blocks when a Google insert fails or the row vanishes', () => {
  const TASKS = [
    makeTask({ id: 't1', title: 'One' }),
    makeTask({ id: 't2', title: 'Two' }),
    makeTask({ id: 't3', title: 'Three' }),
  ];

  /** Every count reconcile reports: asserting the whole object catches a key dropped on the way out. */
  const counts = (over: Partial<Awaited<ReturnType<typeof reconcile>>>) => ({
    created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0,
    pinnedSynced: 0, pinnedFailed: 0, attached: 0, attachFailed: 0, ...over,
  });

  async function plannedLocally(tasks: ReturnType<typeof makeTask>[]) {
    const store = fakeScheduledBlockStore();
    await planLocally(fakeSchedulingRepos({ settings: makeSettings(), tasks, blockStore: store }), store, 'u1', NOW);
    expect(store.all()).toHaveLength(tasks.length);
    expect(store.all().every((b) => b.googleEventId == null)).toBe(true);
    return store;
  }

  function nextCycle(client: FakeGoogleClient, store: ReturnType<typeof fakeScheduledBlockStore>) {
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    client.insertedEvents = [];
    client.updatedEvents = [];
    client.deletedEvents = [];
  }

  const rateLimited = (title: string) => (event: GoogleEventWrite) =>
    event.summary === title ? new GoogleApiError(429, 'POST events: Rate Limit Exceeded') : undefined;

  /** Mimics @notreclaim/db's NotFoundError (matched by name in core's apply). */
  class NotFoundError extends Error {
    constructor(message: string) { super(message); this.name = 'NotFoundError'; }
  }

  it('unchanged: mirroring one block counts as one attach', async () => {
    const store = await plannedLocally([makeTask({ id: 't1' })]);
    const client = new StrictIdGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: [makeTask({ id: 't1' })], client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toEqual(counts({ attached: 1 }));
  });

  it('unchanged: one rejected insert does not abort the cycle; the block is mirrored exactly once next cycle', async () => {
    const store = await plannedLocally(TASKS);
    const client = new StrictIdGoogleClient();
    client.insertFailure = rateLimited('Two');
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: TASKS, client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toEqual(counts({ attached: 2, attachFailed: 1 }));
    expect(client.insertedEvents.map((e) => e.event.summary)).toEqual(['One', 'Three']);
    expect(store.all().find((b) => b.title === 'Two')!.googleEventId).toBeNull();
    expect(store.all().find((b) => b.title === 'Three')!.googleEventId).not.toBeNull();

    client.insertFailure = null;
    nextCycle(client, store);
    const second = await reconcile(deps, 'u1', NOW);

    expect(second).toEqual(counts({ attached: 1 }));
    expect(client.insertedEvents.map((e) => e.event.summary)).toEqual(['Two']);
    expect(client.updatedEvents).toHaveLength(0);
    expect(client.deletedEvents).toHaveLength(0);
    const ids = store.all().map((b) => b.googleEventId);
    expect(ids.every((id) => id != null)).toBe(true);
    expect(new Set(ids).size).toBe(3); // one event per block, none duplicated
  });

  it('changed: a rejected insert still moves the block; it is mirrored next cycle as an unchanged block', async () => {
    const store = await plannedLocally(TASKS);
    const two = store.all().find((b) => b.title === 'Two')!;
    const desiredStart = two.startsAt.toISOString();
    two.startsAt = new Date('2026-01-05T14:00:00.000Z');
    two.endsAt = new Date('2026-01-05T14:30:00.000Z');
    const client = new StrictIdGoogleClient();
    client.insertFailure = rateLimited('Two');
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: TASKS, client });

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toEqual(counts({ updated: 1, attached: 2, attachFailed: 1 }));
    const moved = store.all().find((b) => b.id === two.id)!;
    expect(moved.startsAt.toISOString()).toBe(desiredStart);
    expect(moved.googleEventId).toBeNull();

    client.insertFailure = null;
    nextCycle(client, store);
    const second = await reconcile(deps, 'u1', NOW);

    expect(second).toEqual(counts({ attached: 1 }));
    expect(client.insertedEvents).toHaveLength(1);
    expect(client.insertedEvents[0]).toMatchObject({ event: { summary: 'Two', startDateTime: desiredStart } });
    expect(new Set(store.all().map((b) => b.googleEventId)).size).toBe(3);
  });

  it('a block deleted while its event is being inserted gets that event deleted from Google', async () => {
    const store = await plannedLocally(TASKS);
    const twoId = store.all().find((b) => b.title === 'Two')!.id;
    const realUpdate = store.update;
    store.update = async (userId, id, data) => {
      if (id === twoId) { // DELETE /schedule/:id landed between the insert and the id write
        await store.delete(userId, id);
        throw new NotFoundError(`ScheduledBlock ${id} not found for user`);
      }
      return realUpdate(userId, id, data);
    };
    const client = new StrictIdGoogleClient();
    client.listQueue = [{ events: [] }];
    const deps = buildDeps({ store, tasks: TASKS, client });

    const result = await reconcile(deps, 'u1', NOW);

    const twoEvent = `g-evt-${client.insertedEvents.findIndex((e) => e.event.summary === 'Two') + 1}`;
    expect(client.deletedEvents).toEqual([{ calendarId: 'cal-auto', googleEventId: twoEvent }]);
    expect(result).toEqual(counts({ attached: 2 }));
    expect(store.all().map((b) => b.title).sort()).toEqual(['One', 'Three']);
  });
});

describe('reconcile: one failing row does not abort the cycle, a dead connection does', () => {
  // Three mirrored auto rows the engine moves (it places the tasks from 09:00): three PUTs.
  function seeded() {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'a', taskId: 't1', engineKey: 'task:t1:0', googleEventId: 'g-a', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T13:00:00Z'), endsAt: new Date('2026-01-05T13:30:00Z') }),
      makeScheduledBlock({ id: 'b', taskId: 't2', engineKey: 'task:t2:0', googleEventId: 'g-b', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T14:00:00Z'), endsAt: new Date('2026-01-05T14:30:00Z') }),
      makeScheduledBlock({ id: 'c', taskId: 't3', engineKey: 'task:t3:0', googleEventId: 'g-c', googleCalendarId: 'cal-auto',
        startsAt: new Date('2026-01-05T15:00:00Z'), endsAt: new Date('2026-01-05T15:30:00Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }];
    const tasks = [makeTask({ id: 't1', priority: 1 }), makeTask({ id: 't2', priority: 2 }), makeTask({ id: 't3', priority: 3 })];
    return { store, client, deps: buildDeps({ store, tasks, client }) };
  }
  const failOn = (client: FakeGoogleClient, googleEventId: string, err: Error) => {
    client.onUpdateEvent = (id) => { if (id === googleEventId) throw err; };
  };
  const startOf = (store: ReturnType<typeof fakeScheduledBlockStore>, id: string) => store.all().find((b) => b.id === id)!.startsAt.toISOString();

  it('a Google error on one row is isolated: the other rows move, the failure is counted in the result', async () => {
    const { store, client, deps } = seeded();
    failOn(client, 'g-b', new GoogleApiError(500, 'backend error'));

    const result = await reconcile(deps, 'u1', NOW);

    expect(result).toMatchObject({ updated: 2, updateFailed: 1 });
    expect(client.updatedEvents.map((u) => u.googleEventId)).toEqual(['g-a', 'g-c']);
    expect(startOf(store, 'b')).toBe('2026-01-05T14:00:00.000Z'); // untouched: Google first, then DB
    expect(startOf(store, 'c')).not.toBe('2026-01-05T15:00:00.000Z');
  });

  it.each([
    ['a request timeout (Google unreachable: every later call would wait 15 s too)', new GoogleTimeoutError(15000)],
    ['a 401 (the access token itself was rejected)', new GoogleApiError(401, 'invalid credentials')],
    ['a revoked grant', new GoogleGrantRevokedError()],
    ['any other auth failure', new GoogleAuthError('token endpoint down')],
  ])('%s still aborts the whole cycle', async (_name, err) => {
    const { store, client, deps } = seeded();
    failOn(client, 'g-b', err);

    await expect(reconcile(deps, 'u1', NOW)).rejects.toBe(err);
    expect(client.updatedEvents.map((u) => u.googleEventId)).toEqual(['g-a']);
    expect(startOf(store, 'c')).toBe('2026-01-05T15:00:00.000Z'); // nothing after the fatal row
  });
});
