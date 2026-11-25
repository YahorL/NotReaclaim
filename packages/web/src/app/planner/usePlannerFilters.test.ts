import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlannerFilters, readFilters, isFilteredOut, FILTERS_KEY, ALL_SHOWN } from './usePlannerFilters';

describe('readFilters', () => {
  it('defaults to everything shown', () => {
    expect(readFilters({ getItem: () => null })).toEqual(ALL_SHOWN);
    expect(readFilters(null)).toEqual(ALL_SHOWN);
  });

  it('reads stored values and fills gaps / junk with "shown"', () => {
    expect(readFilters({ getItem: () => '{"meetings":false,"movable":true}' })).toEqual({ meetings: false, movable: true });
    expect(readFilters({ getItem: () => '{"movable":false}' })).toEqual({ meetings: true, movable: false });
    expect(readFilters({ getItem: () => '{"meetings":"no"}' })).toEqual(ALL_SHOWN);
    expect(readFilters({ getItem: () => 'not json' })).toEqual(ALL_SHOWN);
  });

  it('survives a throwing storage', () => {
    expect(readFilters({ getItem: () => { throw new Error('denied'); } })).toEqual(ALL_SHOWN);
  });
});

describe('isFilteredOut', () => {
  it('Meetings covers every calendar event; Movable covers task and habit blocks', () => {
    const noMeetings = { meetings: false, movable: true };
    expect(isFilteredOut('meeting', noMeetings)).toBe(true);
    expect(isFilteredOut('blocked', noMeetings)).toBe(true);
    expect(isFilteredOut('task', noMeetings)).toBe(false);
    const noMovable = { meetings: true, movable: false };
    expect(isFilteredOut('task', noMovable)).toBe(true);
    expect(isFilteredOut('habit', noMovable)).toBe(true);
    expect(isFilteredOut('meeting', noMovable)).toBe(false);
  });
});

describe('usePlannerFilters', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('toggles and persists under nr.plannerFilters', () => {
    const { result } = renderHook(() => usePlannerFilters());
    expect(result.current.filters).toEqual(ALL_SHOWN);
    act(() => result.current.toggle('meetings'));
    expect(result.current.filters).toEqual({ meetings: false, movable: true });
    expect(JSON.parse(localStorage.getItem(FILTERS_KEY)!)).toEqual({ meetings: false, movable: true });
    act(() => result.current.toggle('meetings'));
    expect(result.current.filters.meetings).toBe(true);
  });

  it('starts from the stored value', () => {
    localStorage.setItem(FILTERS_KEY, '{"meetings":true,"movable":false}');
    const { result } = renderHook(() => usePlannerFilters());
    expect(result.current.filters).toEqual({ meetings: true, movable: false });
  });

  it('keeps working when storage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => usePlannerFilters());
    expect(() => act(() => result.current.toggle('movable'))).not.toThrow();
    expect(result.current.filters.movable).toBe(false);
  });
});
