import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/reconcile.js';
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
});
