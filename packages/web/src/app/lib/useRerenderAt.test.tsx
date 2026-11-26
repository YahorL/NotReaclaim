import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useRerenderAt } from './useRerenderAt';

describe('useRerenderAt', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const useCountedRenders = (atMs: number | null, nowMs: number) => {
    const n = useRef(0);
    n.current += 1;
    useRerenderAt(atMs, nowMs);
    return n.current;
  };

  it('re-renders once the given moment has passed, so time-based state (Now / Next) catches up', () => {
    const { result } = renderHook(() => useCountedRenders(1_000 + 5_000, 1_000));
    const before = result.current;
    act(() => { vi.advanceTimersByTime(4_999); });
    expect(result.current).toBe(before);
    act(() => { vi.advanceTimersByTime(2); });
    expect(result.current).toBe(before + 1);
  });

  it('does nothing without a moment', () => {
    const { result } = renderHook(() => useCountedRenders(null, 1_000));
    const before = result.current;
    act(() => { vi.advanceTimersByTime(10 * 60 * 60 * 1000); });
    expect(result.current).toBe(before);
  });
});
