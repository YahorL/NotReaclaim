import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, createEvent, within } from '@testing-library/react';
import type { CalendarEvent } from '../../api/types';
import { ToastProvider } from '../shell/ToastProvider';
import { installMatchMedia, type FakeMatchMedia } from '../../test/matchMedia';
import { REDUCED_MOTION_QUERY } from '../../theme/usePrefersReducedMotion';
import { WeekGrid } from './WeekGrid';
import { dayColumns, startOfWeek, minutesToPx } from './weekModel';
import { LOCKED_TOAST } from './LockedBlock';
import { SHAKE_MS } from './useShake';
import { LONG_PRESS_MS } from './longPress';

const days = dayColumns(startOfWeek(Date.parse('2026-01-05T12:00:00.000Z'), 'UTC'), 7, 'UTC');
const meeting = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1', source: 'google', ...over,
});

function renderGrid(over: { onCommitEvent?: ReturnType<typeof vi.fn>; onSelect?: ReturnType<typeof vi.fn> } = {}) {
  return render(
    <ToastProvider>
      <WeekGrid
        days={days} nowMs={Date.parse('2026-01-07T12:00:00.000Z')} weekLabel="Jan 5 – 11"
        blocks={[]} events={[meeting()]}
        onPrev={vi.fn()} onToday={vi.fn()} onNext={vi.fn()} onCommit={vi.fn()}
        onCommitEvent={over.onCommitEvent} onSelect={over.onSelect}
      />
    </ToastProvider>,
  );
}

describe('Locked Google tiles', () => {
  let mm: FakeMatchMedia | null = null;
  afterEach(() => { mm?.restore(); mm = null; vi.useRealTimers(); });

  it('a press shakes the tile once and toasts why — no drag, no commit', () => {
    vi.useFakeTimers();
    const onCommitEvent = vi.fn();
    renderGrid({ onCommitEvent });
    const tile = screen.getByTestId('event-block');
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(tile).toHaveAttribute('data-shake', 'true');
    expect(tile.className).toContain('animate-shake');
    expect(screen.getByTestId('toast-region')).toHaveTextContent(LOCKED_TOAST);
    fireEvent.pointerMove(tile, { clientX: 50, clientY: 100 + minutesToPx(60), pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100 + minutesToPx(60), pointerId: 1 });
    expect(onCommitEvent).not.toHaveBeenCalled();
    expect(tile.style.transform).toBe('');
    expect(screen.queryByTestId('drag-ghost')).toBeNull();
    act(() => { vi.advanceTimersByTime(SHAKE_MS + 30); });
    expect(tile).not.toHaveAttribute('data-shake');
  });

  it('arrow keys shake + toast too (and do not scroll the hours)', () => {
    renderGrid();
    const body = screen.getByTestId('block-body');
    const ev = createEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent(body, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-shake', 'true');
    expect(screen.getByTestId('toast-region')).toHaveTextContent(LOCKED_TOAST);
  });

  it('other keys leave a locked tile alone', () => {
    renderGrid();
    fireEvent.keyDown(screen.getByTestId('block-body'), { key: 'Tab' });
    expect(screen.getByTestId('event-block')).not.toHaveAttribute('data-shake');
  });

  it('a click still selects it', () => {
    const onSelect = vi.fn();
    renderGrid({ onSelect });
    const tile = screen.getByTestId('event-block');
    fireEvent.pointerDown(tile, { pointerId: 1 });
    fireEvent.click(screen.getByTestId('block-body'), { detail: 1 });
    expect(onSelect).toHaveBeenCalledWith('e:e1', { keyboard: false });
  });

  it('the toast pill is anchored inside the calendar panel (the live region stays in the shell)', () => {
    renderGrid();
    fireEvent.pointerDown(screen.getByTestId('event-block'), { pointerId: 1 });
    const anchor = screen.getByTestId('planner-toast-anchor');
    expect(within(anchor).getByTestId('toast')).toHaveTextContent(LOCKED_TOAST);
    expect(within(anchor).getByTestId('toast')).toHaveAttribute('data-icon', 'lock');
  });

  it('under reduced motion the tile does not shake, but the toast still says why', () => {
    mm = installMatchMedia({ [REDUCED_MOTION_QUERY]: true });
    renderGrid();
    fireEvent.pointerDown(screen.getByTestId('event-block'), { pointerId: 1 });
    expect(screen.getByTestId('event-block')).not.toHaveAttribute('data-shake');
    expect(screen.getByTestId('toast-region')).toHaveTextContent(LOCKED_TOAST);
  });

  /** jsdom drops `pointerType` from the init; define it on the event. */
  const touchEvent = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', el: Element, init: Record<string, unknown>) => {
    const ev = createEvent[kind](el, init);
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    fireEvent(el, ev);
  };

  it('touch: a finger that scrolls away from the tile never shakes it', () => {
    vi.useFakeTimers();
    renderGrid();
    const tile = screen.getByTestId('event-block');
    touchEvent('pointerDown', tile, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(tile).not.toHaveAttribute('data-shake');
    touchEvent('pointerMove', tile, { clientX: 50, clientY: 140, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
    expect(tile).not.toHaveAttribute('data-shake');
    expect(screen.getByTestId('toast-region')).not.toHaveTextContent(LOCKED_TOAST);
  });

  it('touch: a long press on the tile is the move attempt that shakes', () => {
    vi.useFakeTimers();
    renderGrid();
    const tile = screen.getByTestId('event-block');
    touchEvent('pointerDown', tile, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(tile).toHaveAttribute('data-shake', 'true');
    expect(screen.getByTestId('toast-region')).toHaveTextContent(LOCKED_TOAST);
  });

  it('a press while it is still shaking restarts the shake', () => {
    vi.useFakeTimers();
    renderGrid();
    const tile = screen.getByTestId('event-block');
    fireEvent.pointerDown(tile, { pointerId: 1 });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerDown(tile, { pointerId: 1 });
    expect(tile).not.toHaveAttribute('data-shake'); // off for a painted frame…
    act(() => { vi.advanceTimersByTime(50); });
    expect(tile).toHaveAttribute('data-shake', 'true'); // …then a fresh run
    act(() => { vi.advanceTimersByTime(SHAKE_MS); });
    expect(tile).toHaveAttribute('data-shake', 'true');
    act(() => { vi.advanceTimersByTime(60); });
    expect(tile).not.toHaveAttribute('data-shake');
  });
});
