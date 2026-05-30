import { describe, it, expect, vi } from 'vitest';
import { runPollCycle } from '../src/scheduler.js';

describe('runPollCycle', () => {
  it('calls pollAndReplan once per connected id, in order', async () => {
    const pollAndReplan = vi.fn(async () => {});

    await runPollCycle({ listConnectedIds: async () => ['u1', 'u2'], pollAndReplan });

    expect(pollAndReplan.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
  });

  it('isolates a per-user failure and continues to the next user', async () => {
    const seen: string[] = [];
    const pollAndReplan = vi.fn(async (id: string) => {
      seen.push(id);
      if (id === 'u1') throw new Error('boom');
    });
    const log = vi.fn();

    await runPollCycle({ listConnectedIds: async () => ['u1', 'u2'], pollAndReplan, log });

    expect(seen).toEqual(['u1', 'u2']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(new Error('boom'));
  });
});
