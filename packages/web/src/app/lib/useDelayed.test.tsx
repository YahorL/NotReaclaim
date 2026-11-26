import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDelayedFlag, useDelayedKeys, PENDING_DELAY_MS } from './useDelayed';

describe('useDelayedKeys / useDelayedFlag (pending shows only once a request is slow)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the delay is ~400ms', () => {
    expect(PENDING_DELAY_MS).toBe(400);
  });

  it('a key shows only after it has been present for the delay', () => {
    const { result, rerender } = renderHook(({ keys }) => useDelayedKeys(keys), { initialProps: { keys: [] as string[] } });
    expect(result.current.size).toBe(0);
    rerender({ keys: ['b:1'] });
    act(() => { vi.advanceTimersByTime(399); });
    expect(result.current.has('b:1')).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.has('b:1')).toBe(true);
  });

  it('a fast request never shows, and a key leaves at once when it is no longer pending', () => {
    const { result, rerender } = renderHook(({ keys }) => useDelayedKeys(keys), { initialProps: { keys: ['b:1'] } });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ keys: [] });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.size).toBe(0);
    rerender({ keys: ['b:1'] });
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current.has('b:1')).toBe(true);
    rerender({ keys: [] });
    expect(result.current.size).toBe(0);
  });

  it('each key keeps its own clock: a later key does not restart an earlier one', () => {
    const { result, rerender } = renderHook(({ keys }) => useDelayedKeys(keys), { initialProps: { keys: ['a'] } });
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ keys: ['a', 'b'] });
    act(() => { vi.advanceTimersByTime(100); });
    expect([...result.current]).toEqual(['a']);
    act(() => { vi.advanceTimersByTime(300); });
    expect([...result.current].sort()).toEqual(['a', 'b']);
  });

  it('useDelayedFlag is the one-key form', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on), { initialProps: { on: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
