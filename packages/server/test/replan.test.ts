import { describe, it, expect, vi } from 'vitest';
import { replanAfterMutation, pollAndReplan } from '../src/replan.js';
import { createEventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';

const COUNTS = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 };
const SYNC = { upserted: 2, deleted: 0, fullResync: false };
const NOW = 1_700_000_000_000;

function capture(bus = createEventBus()) {
  const events: ServerEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return { bus, events };
}

describe('replanAfterMutation', () => {
  it('reconciles and emits schedule.updated with the counts', async () => {
    const { bus, events } = capture();
    const reconcile = vi.fn(async () => COUNTS);

    await replanAfterMutation({ reconcile, bus, now: () => NOW }, 'u1');

    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(events).toEqual([{ type: 'schedule.updated', userId: 'u1', counts: COUNTS }]);
  });

  it('swallows a reconcile failure, emits nothing, and logs', async () => {
    const { bus, events } = capture();
    const reconcile = vi.fn(async () => {
      throw new Error('google down');
    });
    const log = vi.fn();

    await expect(replanAfterMutation({ reconcile, bus, now: () => NOW, log }, 'u1')).resolves.toBeUndefined();

    expect(events).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('pollAndReplan', () => {
  it('syncs then reconciles and emits sync.completed and schedule.updated', async () => {
    const { bus, events } = capture();
    const sync = vi.fn(async () => SYNC);
    const reconcile = vi.fn(async () => COUNTS);

    await pollAndReplan({ sync, reconcile, bus, now: () => NOW }, 'u1');

    expect(sync).toHaveBeenCalledWith('u1', NOW);
    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(events).toEqual([
      { type: 'sync.completed', userId: 'u1', sync: SYNC, counts: COUNTS },
      { type: 'schedule.updated', userId: 'u1', counts: COUNTS },
    ]);
  });
});
