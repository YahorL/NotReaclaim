import { describe, it, expect, vi, afterEach } from 'vitest';
import { serialisePerUser } from '../src/replan-queue.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A run whose every invocation is held open until the test settles it. */
function controlledRun() {
  const runs: Array<{ userId: string; now: number; d: Deferred<string> }> = [];
  let active = 0;
  let maxActive = 0;
  const run = vi.fn((userId: string, now: number) => {
    const d = deferred<string>();
    runs.push({ userId, now, d });
    active += 1;
    maxActive = Math.max(maxActive, active);
    const done = () => { active -= 1; };
    d.promise.then(done, done);
    return d.promise;
  });
  return { run, runs, maxActive: () => maxActive };
}

/** Let every queued microtask (and promise chain hop) run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
process.on('unhandledRejection', onUnhandled);
afterEach(() => { unhandled.length = 0; });

describe('serialisePerUser', () => {
  it('starts an idle user\'s run synchronously with the caller\'s now', () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 999 });
    void q('u1', 10);
    expect(c.run).toHaveBeenCalledTimes(1);
    expect(c.run).toHaveBeenCalledWith('u1', 10);
  });

  it('runs one user\'s requests one at a time', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    const a = q('u1', 1);
    const b = q('u1', 2);
    await flush();
    expect(c.runs).toHaveLength(1); // b waits

    c.runs[0]!.d.resolve('first');
    await expect(a).resolves.toBe('first');
    await flush();
    expect(c.runs).toHaveLength(2); // b's run starts only after a's settled
    c.runs[1]!.d.resolve('second');
    await expect(b).resolves.toBe('second');
    expect(c.maxActive()).toBe(1);
  });

  it('never makes one user wait for another', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    void q('u1', 1);
    const b = q('u2', 1);
    expect(c.runs.map((r) => r.userId)).toEqual(['u1', 'u2']); // both started immediately
    c.runs[1]!.d.resolve('u2 done');
    await expect(b).resolves.toBe('u2 done'); // u1 still running
    c.runs[0]!.d.resolve('u1 done');
  });

  it('coalesces N requests that arrive during a run into exactly ONE follow-up', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    const first = q('u1', 1);
    const waiters = [q('u1', 2), q('u1', 3), q('u1', 4)];

    c.runs[0]!.d.resolve('current');
    await first;
    await flush();
    expect(c.runs).toHaveLength(2);
    c.runs[1]!.d.resolve('follow-up');

    // Every waiter gets the follow-up's result — none is served by the run already in flight.
    await expect(Promise.all(waiters)).resolves.toEqual(['follow-up', 'follow-up', 'follow-up']);
    await flush();
    expect(c.runs).toHaveLength(2);
  });

  it('a request arriving during the follow-up gets a third run, not the follow-up\'s result', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    void q('u1', 1);
    const second = q('u1', 2);
    c.runs[0]!.d.resolve('r0');
    await flush();
    const third = q('u1', 3); // the follow-up (run 1) has already STARTED
    c.runs[1]!.d.resolve('r1');
    await expect(second).resolves.toBe('r1');
    await flush();
    expect(c.runs).toHaveLength(3);
    c.runs[2]!.d.resolve('r2');
    await expect(third).resolves.toBe('r2');
  });

  it('clocks a queued run when it starts, never earlier than a request it covers', async () => {
    const c = controlledRun();
    let clock = 100;
    const q = serialisePerUser(c.run, { clock: () => clock });
    void q('u1', 50);
    void q('u1', 60);
    void q('u1', 70);
    clock = 500; // time passes while the first run is in flight
    c.runs[0]!.d.resolve('a');
    await flush();
    expect(c.runs[1]!.now).toBe(500);

    // A requested now ahead of the clock (an injected test clock) is never run backwards.
    void q('u1', 900);
    c.runs[1]!.d.resolve('b');
    await flush();
    expect(c.runs[2]!.now).toBe(900);
    c.runs[2]!.d.resolve('c');
  });

  it('a failed run rejects only the callers it covered, and the queue keeps going', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    const first = q('u1', 1);
    const waiter = q('u1', 2);
    c.runs[0]!.d.reject(new Error('google down'));
    await expect(first).rejects.toThrow('google down');
    await flush();
    c.runs[1]!.d.resolve('recovered');
    await expect(waiter).resolves.toBe('recovered');

    // Failure of the follow-up reaches its waiters, and a later request still runs normally.
    const w1 = q('u1', 3);
    c.runs[2]!.d.reject(new Error('boom'));
    await expect(w1).rejects.toThrow('boom');
    const later = q('u1', 4);
    expect(c.runs).toHaveLength(4); // idle again: started synchronously
    c.runs[3]!.d.resolve('ok');
    await expect(later).resolves.toBe('ok');
  });

  it('a synchronous throw rejects the caller and does not wedge the user', async () => {
    let calls = 0;
    const q = serialisePerUser(async () => 'ok', { clock: () => 0 });
    const throwing = serialisePerUser((): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error('sync');
      return Promise.resolve('ok');
    }, { clock: () => 0 });
    await expect(throwing('u1', 1)).rejects.toThrow('sync');
    await expect(throwing('u1', 2)).resolves.toBe('ok');
    expect(throwing.activeUsers()).toBe(0);
    await expect(q('u1', 1)).resolves.toBe('ok');
  });

  it('drops a user\'s entry once idle (no unbounded growth)', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    void q('u1', 1);
    void q('u1', 2).catch(() => {});
    void q('u2', 1).catch(() => {});
    expect(q.activeUsers()).toBe(2);
    c.runs[0]!.d.resolve('a');
    c.runs[1]!.d.reject(new Error('u2 failed'));
    await flush();
    expect(q.activeUsers()).toBe(1); // u1's follow-up is running
    c.runs[2]!.d.resolve('b');
    await flush();
    expect(q.activeUsers()).toBe(0);
  });

  it('raises no unhandled rejection when a run fails', async () => {
    const c = controlledRun();
    const q = serialisePerUser(c.run, { clock: () => 0 });
    const first = q('u1', 1).catch(() => 'handled');
    const waiter = q('u1', 2).catch(() => 'handled');
    c.runs[0]!.d.reject(new Error('first failed'));
    await flush();
    c.runs[1]!.d.reject(new Error('follow-up failed'));
    await expect(Promise.all([first, waiter])).resolves.toEqual(['handled', 'handled']);
    await flush();
    expect(unhandled).toEqual([]);
  });
});
