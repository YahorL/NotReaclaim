import { describe, it, expect } from 'vitest';
import { detectDrift } from '../src/detect-drift.js';
import { FakeGoogleClient, fakeScheduledBlockStore, makeScheduledBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');
const HORIZON_END = NOW + 24 * 60 * 60 * 1000;

const gEvent = (id: string, start: string, end: string, status = 'confirmed') => ({
  id, status, summary: id, start: { dateTime: start }, end: { dateTime: end },
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

    expect(result).toEqual({ pinned: 1, removed: 0 });
    const b = store.all()[0]!;
    expect(b.pinned).toBe(true);
    expect(b.startsAt.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('removes a block when its Google event is gone', async () => {
    const store = fakeScheduledBlockStore([
      makeScheduledBlock({ id: 'b1', googleEventId: 'g1', engineKey: 'task:t:0' }),
    ]);
    const client = new FakeGoogleClient();
    client.listQueue = [{ events: [] }];

    const result = await detectDrift({ client, scheduledBlocks: store }, 'u1', 'cal-auto', 'access', NOW, HORIZON_END);

    expect(result).toEqual({ pinned: 0, removed: 1 });
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

    expect(result).toEqual({ pinned: 0, removed: 0 });
    expect(store.all()[0]!.pinned).toBe(false);
  });
});
