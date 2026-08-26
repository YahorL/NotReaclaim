import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import {
  useMediaQuery, usePointerCoarse, useCompactWidth,
  COARSE_POINTER_QUERY, COMPACT_WIDTH_QUERY,
} from './useMediaQuery';

let mm: FakeMatchMedia | null = null;
afterEach(() => { mm?.restore(); mm = null; });

describe('useMediaQuery', () => {
  it('returns false when the environment has no matchMedia (jsdom default)', () => {
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);
  });

  it('reads the initial match', () => {
    mm = installMatchMedia({ '(min-width: 900px)': true });
    const { result } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    expect(result.current).toBe(true);
  });

  it('reacts when the query flips', () => {
    mm = installMatchMedia({ '(min-width: 900px)': false });
    const { result } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    expect(result.current).toBe(false);
    act(() => { mm!.set('(min-width: 900px)', true); });
    expect(result.current).toBe(true);
  });

  it('stops listening after unmount', () => {
    mm = installMatchMedia({ '(min-width: 900px)': false });
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 900px)'));
    unmount();
    act(() => { mm!.set('(min-width: 900px)', true); });
    expect(result.current).toBe(false); // no post-unmount state update
  });

  it('usePointerCoarse asks the coarse-pointer query', () => {
    mm = installMatchMedia({ [COARSE_POINTER_QUERY]: true });
    const { result } = renderHook(() => usePointerCoarse());
    expect(result.current).toBe(true);
    expect(mm.queries()).toContain('(pointer: coarse)');
  });

  it('useCompactWidth asks the below-md width query', () => {
    mm = installMatchMedia({ [COMPACT_WIDTH_QUERY]: true });
    const { result } = renderHook(() => useCompactWidth());
    expect(result.current).toBe(true);
    expect(mm.queries()).toContain('(max-width: 767.98px)');
  });
});
