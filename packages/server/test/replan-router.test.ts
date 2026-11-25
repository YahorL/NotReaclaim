import { describe, it, expect, vi } from 'vitest';
import { makeReplan } from '../src/replan-router.js';

const COUNTS = { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0, pinnedSynced: 0, pinnedFailed: 0 };
const NOW = 1_700_000_000_000;

describe('makeReplan', () => {
  it('routes to Google reconcile when the user is connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => true });
    await replan('u1', NOW);
    expect(reconcile).toHaveBeenCalledWith('u1', NOW, expect.any(Function)); // + the row-failure reporter
    expect(planLocally).not.toHaveBeenCalled();
  });

  it('routes to local planning when the user is not connected', async () => {
    const reconcile = vi.fn(async () => COUNTS);
    const planLocally = vi.fn(async () => COUNTS);
    const replan = makeReplan({ reconcile, planLocally, isConnected: async () => false });
    await replan('u1', NOW);
    expect(planLocally).toHaveBeenCalledWith('u1', NOW, expect.any(Function));
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('makeReplan logs the rows a replan skipped', () => {
  type Report = Parameters<NonNullable<Parameters<Parameters<typeof makeReplan>[0]['reconcile']>[2]>>[0];

  function setup(run: (report: (f: Report) => void) => Record<string, number>, connected = true) {
    const warn = vi.fn();
    const impl = async (_u: string, _n: number, report: (f: Report) => void) => ({ ...COUNTS, ...run(report) });
    const replan = makeReplan({ reconcile: impl, planLocally: impl, isConnected: async () => connected, warn });
    return { replan, warn };
  }

  it('warns ONCE per replan with the user, the failed counts and the first error of each kind (name, message, status)', async () => {
    const googleError = Object.assign(new Error('Google API error 403: forbidden'), { name: 'GoogleApiError', status: 403 });
    const dbError = Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' });
    const { replan, warn } = setup((report) => {
      report({ kind: 'update', blockId: 'b1', engineKey: 'task:t1:0', error: googleError });
      report({ kind: 'update', blockId: 'b2', engineKey: 'task:t2:0', error: new Error('second update failure, not logged') });
      report({ kind: 'create', blockId: null, engineKey: 'task:t3:0', error: dbError });
      return { updateFailed: 2, createFailed: 1 };
    });

    const result = await replan('u1', NOW);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      userId: 'u1',
      failed: { updateFailed: 2, createFailed: 1 },
      failures: [
        { kind: 'update', blockId: 'b1', engineKey: 'task:t1:0', error: { name: 'GoogleApiError', message: 'Google API error 403: forbidden', status: 403 } },
        { kind: 'create', blockId: null, engineKey: 'task:t3:0', error: { name: 'Error', message: 'Foreign key constraint violated', code: 'P2003' } },
      ],
    }, 'replan skipped blocks that failed to save (retried next cycle)');
    // The result (sent to clients as-is) carries counts only.
    expect(result).toEqual({ ...COUNTS, updateFailed: 2, createFailed: 1 });
  });

  it('warns on the local path too, and for a failure that was counted without an error (an orphaned event)', async () => {
    const { replan, warn } = setup(() => ({ attachFailed: 1, pinnedFailed: 0 }), false);
    await replan('u1', NOW);
    expect(warn).toHaveBeenCalledWith({ userId: 'u1', failed: { attachFailed: 1 }, failures: [] }, expect.any(String));
  });

  it('caps a long error message', async () => {
    const { replan, warn } = setup((report) => {
      report({ kind: 'delete', blockId: 'b1', engineKey: null, error: new Error('x'.repeat(1000)) });
      return { deleteFailed: 1 };
    });
    await replan('u1', NOW);
    const logged = warn.mock.calls[0]![0] as { failures: Array<{ error: { message: string } }> };
    expect(logged.failures[0]!.error.message.length).toBeLessThanOrEqual(301);
  });

  it('stays silent on a clean run', async () => {
    const { replan, warn } = setup(() => ({ attachFailed: 0 }));
    await replan('u1', NOW);
    expect(warn).not.toHaveBeenCalled();
  });
});
