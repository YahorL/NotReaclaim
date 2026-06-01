import { describe, it, expect, vi } from 'vitest';
import { makeReplan } from '../src/replan-router.js';

const COUNTS = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 };
const NOW = 1_700_000_000_000;

describe('makeReplan', () => {
  it('routes to Google reconcile when the user is connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => true });
    await replan('u1', NOW);
    expect(reconcile).toHaveBeenCalledWith('u1', NOW);
    expect(planLocally).not.toHaveBeenCalled();
  });

  it('routes to local planning when the user is not connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => false });
    await replan('u1', NOW);
    expect(planLocally).toHaveBeenCalledWith('u1', NOW);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
