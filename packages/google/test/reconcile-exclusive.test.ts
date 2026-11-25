import { describe, it, expect } from 'vitest';
import { reconcile, type ReconcileDeps } from '../src/reconcile.js';
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
const T = (iso: string) => new Date(iso);

type Store = ReturnType<typeof fakeScheduledBlockStore>;

function buildDeps(store: Store, client: FakeGoogleClient, tasks: ReturnType<typeof makeTask>[]): ReconcileDeps {
  return {
    client,
    tokens: fakeTokenProvider(),
    users: fakeUserRepo([makeUser({ id: 'u1', autoScheduledCalendarId: 'cal-auto' })]),
    scheduledBlocks: store,
    schedulingRepos: fakeSchedulingRepos({ settings: makeSettings(), tasks, blockStore: store }),
  };
}

function googleEventsFromStore(store: Store) {
  return store.all()
    .filter((b) => b.googleEventId)
    .map((b) => ({
      id: b.googleEventId!, status: 'confirmed', summary: b.title,
      start: { dateTime: b.startsAt.toISOString() }, end: { dateTime: b.endsAt.toISOString() },
    }));
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

describe('reconcile with an exclusive section (per-user lock)', () => {
  it('a drag committed while apply pushes an earlier row survives the in-flight apply', async () => {
    // Two auto rows the engine will move (it places both tasks from 09:00): both get a PUT.
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'a', taskId: 't1', engineKey: 'task:t1:0', googleEventId: 'g-a', googleCalendarId: 'cal-auto',
        startsAt: T('2026-01-05T13:00:00Z'), endsAt: T('2026-01-05T13:30:00Z') }),
      makeScheduledBlock({ id: 'b', taskId: 't2', engineKey: 'task:t2:0', googleEventId: 'g-b', googleCalendarId: 'cal-auto',
        startsAt: T('2026-01-05T15:00:00Z'), endsAt: T('2026-01-05T15:30:00Z') }),
    ], { snapshotReads: true });
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: googleEventsFromStore(store) }]; // in sync: drift does nothing
    const lock = fifoLock();
    let route: Promise<unknown> | undefined;
    let dragged = '';
    // Fire on the FIRST PUT, whichever row it is, and drag the OTHER one: the test must not
    // depend on the order of desired.blocks (if the dragged row were pushed first, the
    // unlocked code would pass too).
    client.onUpdateEvent = (id) => {
      if (route) return;
      dragged = id === 'g-a' ? 'b' : 'a';
      route = lock(() => store.update('u1', dragged, { startsAt: T('2026-01-05T16:30:00Z'), endsAt: T('2026-01-05T17:00:00Z'), pinned: true }));
    };
    const deps = { ...buildDeps(store, client, [makeTask({ id: 't1', priority: 1 }), makeTask({ id: 't2', priority: 2 })]), exclusive: lock };

    await reconcile(deps, 'u1', NOW);
    expect(dragged).not.toBe(''); // the engine really did push a row while the drag was pending
    await route;

    expect(store.all().find((r) => r.id === dragged)).toMatchObject({ startsAt: T('2026-01-05T16:30:00Z'), endsAt: T('2026-01-05T17:00:00Z'), pinned: true });
    // Both engine moves were pushed inside the run; the drag committed AFTER it, so it is the
    // follow-up replan's pinned pass (app newer than Google) that pushes the drop outbound.
    expect(client.updatedEvents.map((u) => u.googleEventId).sort()).toEqual(['g-a', 'g-b']);
  });

  it('a second drag during the push of the first is not re-imported as a Google edit on the next cycle', async () => {
    // One fake clock stamps both sides in execution order (it cannot model host-vs-Google skew).
    let clock = NOW;
    const tick = () => ++clock;
    const store = fakeScheduledBlockStore([makeScheduledBlock({
      id: 'p', taskId: 't1', pinned: true, engineKey: null, googleEventId: 'g1', googleCalendarId: 'cal-auto',
      startsAt: T('2026-01-05T10:00:00Z'), endsAt: T('2026-01-05T10:30:00Z'), updatedAt: new Date(NOW - 60_000), // drag #1, not yet pushed
    })], { snapshotReads: true, clock: tick });
    const client = new FakeGoogleClient();
    // Google still shows the pre-drag-#1 time, edited long ago: drift keeps the app copy; observed = 09:00.
    client.listQueue = [{ events: [{ id: 'g1', status: 'confirmed', summary: 'Focus', updated: new Date(NOW - 3_600_000).toISOString(),
      start: { dateTime: '2026-01-05T09:00:00Z' }, end: { dateTime: '2026-01-05T09:30:00Z' } }] }];
    const lock = fifoLock();
    let route: Promise<unknown> | undefined;
    let pushedAt = 0;
    client.onUpdateEvent = async () => { // the pinned pass is pushing drag #1's 10:00
      route ??= lock(() => store.update('u1', 'p', { startsAt: T('2026-01-05T14:00:00Z'), endsAt: T('2026-01-05T14:30:00Z'), pinned: true })); // drag #2
      await new Promise((resolve) => setTimeout(resolve, 0)); // the push is in flight: an UNBLOCKED route commits now
      pushedAt = tick(); // Google stamps the push on arrival
    };
    // A 30-min task fully covered by p: the engine emits nothing, so cycle 1's only write is the push.
    const deps = { ...buildDeps(store, client, [makeTask({ id: 't1' })]), exclusive: lock };

    await reconcile(deps, 'u1', NOW);
    expect(route).toBeDefined();
    await route;

    // Cycle 2: Google now holds what the pinned pass pushed, stamped pushedAt.
    client.listQueue = [{ events: [{ id: 'g1', status: 'confirmed', summary: 'Focus', updated: new Date(pushedAt).toISOString(),
      start: { dateTime: '2026-01-05T10:00:00Z' }, end: { dateTime: '2026-01-05T10:30:00Z' } }] }];
    await reconcile(deps, 'u1', NOW + 10_000);

    expect(store.all().find((r) => r.id === 'p')).toMatchObject({ startsAt: T('2026-01-05T14:00:00Z'), endsAt: T('2026-01-05T14:30:00Z') });
    // …and cycle 2 pushed drag #2 outbound.
    expect(client.updatedEvents.at(-1)?.event).toMatchObject({ startDateTime: '2026-01-05T14:00:00.000Z' });
  });

  it('runs only compute + apply inside the section: token, calendar check and drift stay outside', async () => {
    const store = fakeScheduledBlockStore([], { snapshotReads: true });
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];
    const log: string[] = [];
    const deps = buildDeps(store, client, [makeTask({ id: 't1' })]);
    const tokens = { getAccessToken: async (u: string, n: number) => { log.push('token'); return deps.tokens.getAccessToken(u, n); } };
    const origList = client.listEvents.bind(client);
    client.listEvents = async (args) => { log.push('drift listing'); return origList(args); };
    const origInsert = client.insertEvent.bind(client);
    client.insertEvent = async (...args) => { log.push('insert'); return origInsert(...args); };
    const exclusive = async <R>(fn: () => Promise<R>): Promise<R> => {
      log.push('enter');
      try { return await fn(); } finally { log.push('exit'); }
    };

    const result = await reconcile({ ...deps, tokens, exclusive }, 'u1', NOW);

    expect(result.created).toBe(1);
    expect(log).toEqual(['token', 'drift listing', 'enter', 'insert', 'exit']);
  });
});
