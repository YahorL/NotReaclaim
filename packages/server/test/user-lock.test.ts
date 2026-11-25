import { describe, it, expect } from 'vitest';
import { createUserLock } from '../src/user-lock.js';

/** A promise the test resolves by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createUserLock', () => {
  it('runs one section at a time per user, in arrival order', async () => {
    const lock = createUserLock();
    const log: string[] = [];
    const first = deferred();
    const a = lock('u1', async () => { log.push('a:start'); await first.promise; log.push('a:end'); return 'a'; });
    const b = lock('u1', async () => { log.push('b'); return 'b'; });
    const c = lock('u1', async () => { log.push('c'); return 'c'; });
    await flush();
    expect(log).toEqual(['a:start']);
    first.resolve();
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b', 'c']);
  });

  it('never makes one user wait for another', async () => {
    const lock = createUserLock();
    const held = deferred();
    const u1 = lock('u1', () => held.promise);
    let u2Ran = false;
    await lock('u2', async () => { u2Ran = true; });
    expect(u2Ran).toBe(true);
    held.resolve();
    await u1;
  });

  it('a section that throws rejects only its caller and releases the lock', async () => {
    const lock = createUserLock();
    const boom = new Error('boom');
    const failed = lock('u1', async () => { throw boom; });
    const next = lock('u1', async () => 'next');
    await expect(failed).rejects.toBe(boom);
    expect(await next).toBe('next');
  });

  it('a section that throws synchronously still releases the lock', async () => {
    const lock = createUserLock();
    const boom = new Error('sync boom');
    const failed = lock('u1', (() => { throw boom; }) as unknown as () => Promise<void>);
    await expect(failed).rejects.toBe(boom);
    expect(await lock('u1', async () => 'after')).toBe('after');
  });

  it('drops a user entry as soon as nothing holds or waits for it', async () => {
    const lock = createUserLock();
    expect(lock.held()).toBe(0);
    const gate = deferred();
    const a = lock('u1', () => gate.promise);
    const b = lock('u1', async () => undefined);
    const c = lock('u2', async () => undefined);
    expect(lock.held()).toBe(2);
    await c;
    expect(lock.held()).toBe(1);
    gate.resolve();
    await Promise.all([a, b]);
    expect(lock.held()).toBe(0);
    await expect(lock('u1', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(lock.held()).toBe(0);
  });
});
