import { describe, it, expect } from 'vitest';
import { detectDrift } from '../src/detect-drift.js';
import { FakeGoogleClient, fakeScheduledBlockStore, makeScheduledBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const HORIZON_END = NOW + 24 * 60 * 60 * 1000;

const gEvent = (id: string, start: string, end: string, status = 'confirmed', updated?: string) => ({
  id, status, summary: id, start: { dateTime: start }, end: { dateTime: end }, updated,
});

describe('detectDrift', () => {
  it('pins a block when the user moved its Google event', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0',
        startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T11:00:00.000Z', '2026-01-05T11:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 1, removed: 0 });
    const b = store.all()[0]!;
    expect(b.pinned).toBe(true);
    expect(b.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
    expect(b.engineKey).toBeNull();
  });

  it('removes a block when its Google event is gone', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0' }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 1 });
    expect(store.all()).toHaveLength(0);
  });

  it('leaves an unchanged block alone', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0',
        startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.pinned).toBe(false);
  });

  it('removes a block when its Google event is cancelled', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0' }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z', 'cancelled')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 1 });
    expect(store.all()).toHaveLength(0);
  });

  it('skips all-day events (no dateTime) without pinning', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0',
        startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [{ id: 'g1', status: 'confirmed', summary: 'all day', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.pinned).toBe(false);
  });

  it('reports what Google currently holds so the caller can push app-side changes', async () => {
    const store = fakeScheduledBlockStore([]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result.observed.get('g1')).toEqual({
      start: Date.parse('2026-01-05T09:00:00.000Z'),
      end: Date.parse('2026-01-05T09:30:00.000Z'),
      title: 'g1',
    });
  });

  it('does not revert a PINNED block whose app-side move is newer than the Google event', async () => {
    // App-wins for pinned rows: the user dragged the block in the planner at 12:00,
    // Google still holds the pre-drag 09:00 slot. Reverting here would undo the drag.
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: null, pinned: true,
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
        updatedAt: new Date('2026-01-05T00:00:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z', 'confirmed', '2026-01-04T00:00:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('still pulls a PINNED block when the Google event was edited more recently', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: null, pinned: true,
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z', 'confirmed', '2026-01-04T12:00:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 1, removed: 0 });
    expect(store.all()[0]!.startsAt.toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });

  it('keeps the app copy of a pinned block when Google reports no edit timestamp', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: null, pinned: true,
        startsAt: new Date('2026-01-05T11:00:00.000Z'), endsAt: new Date('2026-01-05T11:30:00.000Z') }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [gEvent('g1', '2026-01-05T09:00:00.000Z', '2026-01-05T09:30:00.000Z')] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('skips blocks without a googleEventId', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: null, engineKey: 'task:t:0' }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toMatchObject({ pinned: 0, removed: 0 });
    expect(store.all()).toHaveLength(1);
  });
});
