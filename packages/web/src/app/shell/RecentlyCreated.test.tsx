import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecentlyCreatedProvider, useRecentlyCreated, FRESH_HOLD_MS } from './RecentlyCreated';

function Probe() {
  const { freshTaskId, markCreated } = useRecentlyCreated();
  return (
    <>
      <span data-testid="fresh">{freshTaskId ?? 'none'}</span>
      <button type="button" onClick={() => markCreated('t1')}>one</button>
      <button type="button" onClick={() => markCreated('t2')}>two</button>
    </>
  );
}

describe('RecentlyCreated', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op outside a provider (pages render bare in tests)', () => {
    render(<Probe />);
    fireEvent.click(screen.getByText('one'));
    expect(screen.getByTestId('fresh')).toHaveTextContent('none');
  });

  it('holds the created id long enough for the panel refetch, then clears it', () => {
    vi.useFakeTimers();
    render(<RecentlyCreatedProvider><Probe /></RecentlyCreatedProvider>);
    fireEvent.click(screen.getByText('one'));
    expect(screen.getByTestId('fresh')).toHaveTextContent('t1');
    act(() => { vi.advanceTimersByTime(FRESH_HOLD_MS - 1); });
    expect(screen.getByTestId('fresh')).toHaveTextContent('t1');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId('fresh')).toHaveTextContent('none');
  });

  it('a newer create replaces the id and restarts the hold', () => {
    vi.useFakeTimers();
    render(<RecentlyCreatedProvider><Probe /></RecentlyCreatedProvider>);
    fireEvent.click(screen.getByText('one'));
    act(() => { vi.advanceTimersByTime(FRESH_HOLD_MS - 100); });
    fireEvent.click(screen.getByText('two'));
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('fresh')).toHaveTextContent('t2');
    act(() => { vi.advanceTimersByTime(FRESH_HOLD_MS); });
    expect(screen.getByTestId('fresh')).toHaveTextContent('none');
  });
});
