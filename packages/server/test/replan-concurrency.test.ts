import { describe, it, expect, vi } from 'vitest';
import type { ReconcileResult } from '@notreclaim/google';
import { makeReplan } from '../src/replan-router.js';
import { pollAndReplan } from '../src/replan.js';
import { createEventBus } from '../src/events.js';
import { buildTestApp, tokenFor } from './fakes.js';

const COUNTS: ReconcileResult = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0, pinnedSynced: 0, pinnedFailed: 0 };
const SYNC = { upserted: 0, deleted: 0, fullResync: false };

/** A slow fake Google reconcile that records how many runs overlap. */
function slowReconcile() {
  let active = 0;
  let maxActive = 0;
  const calls: Array<{ userId: string; now: number }> = [];
  const reconcile = async (userId: string, now: number): Promise<ReconcileResult> => {
    calls.push({ userId, now });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 50));
    active -= 1;
    return { ...COUNTS };
  };
  return { reconcile, calls, maxActive: () => maxActive };
}

describe('replans for one user never overlap across entry points', () => {
  it('POST /schedule/replan, a task mutation and the poll run one at a time', async () => {
    const fake = slowReconcile();
    // The same wiring as server.ts: one makeReplan instance feeds the app AND the poll.
    const replan = makeReplan({
      reconcile: fake.reconcile,
      planLocally: async () => ({ ...COUNTS }),
      isConnected: async () => true,
    });
    const { app, emitted } = buildTestApp({ replan });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };

    const replanRes = app.inject({ method: 'POST', url: '/schedule/replan', headers: auth });
    const created = app.inject({
      method: 'POST', url: '/tasks', headers: auth,
      payload: { title: 'T', priority: 1, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 900000, maxChunkMs: 1800000 },
    });
    const poll = pollAndReplan(
      { sync: async () => SYNC, replan, bus: createEventBus(), now: () => 1 },
      'u1',
    );

    expect((await replanRes).statusCode).toBe(200);
    expect((await created).statusCode).toBe(201);
    await poll;
    // afterMutation's replan is fire-and-forget: wait for its schedule.updated.
    await vi.waitFor(() => expect(emitted.filter((e) => e.type === 'schedule.updated')).toHaveLength(2));

    expect(fake.maxActive()).toBe(1);
    // The first request runs at once; the two that arrive during it share ONE follow-up.
    expect(fake.calls).toHaveLength(2);
  });
});
