import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarBlock, type CalendarBlockProps } from './CalendarBlock';

const ACCENT = '#5b62e3';

function renderBlock(over: Partial<CalendarBlockProps> = {}) {
  const props: CalendarBlockProps = {
    title: 'Standup', kind: 'meeting', source: 'google', startLabel: '10:00 AM', whenLabel: 'Wed 10:00 AM – 11:00 AM',
    durationMin: 60, style: { top: '10%', height: '5%', left: 'calc(0% + 5px)', width: 'calc(100% - 10px)' },
    ...over,
  };
  return render(<CalendarBlock {...props} />);
}

describe('CalendarBlock', () => {
  it('renders title, start label and position on the wrapper', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    expect(el).toHaveTextContent('Standup');
    expect(el).toHaveTextContent('10:00 AM');
    expect(el.style.top).toBe('10%');
    expect(el.style.height).toBe('5%');
    expect(el.style.left).toBe('calc(0% + 5px)');
  });

  it('keeps the 11px time label at full strength on the meeting fill (contrast), dimmed elsewhere', () => {
    const { unmount } = renderBlock();
    // Contrast guarantee: white @ .8 on the violet fill is 3.9:1.
    expect(screen.getByTestId('block-time')).not.toHaveAttribute('data-dimmed');
    unmount();
    renderBlock({ kind: 'task', source: null });
    expect(screen.getByTestId('block-time')).toHaveAttribute('data-dimmed', 'true');
  });

  it('a Google meeting is locked: data-locked, lock icon, no pin, no resize handle', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'meeting');
    expect(el).toHaveAttribute('data-locked', 'true');
    expect(el).toHaveAttribute('data-source', 'google');
    expect(el.querySelector('[data-icon="lock"]')).not.toBeNull();
    expect(el.querySelector('[data-icon="pin"]')).toBeNull();
    expect(screen.queryByTestId('resize-handle')).toBeNull();
  });

  it('an app event is movable: no lock icon', () => {
    renderBlock({ source: 'app' });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-locked', 'false');
    expect(el).toHaveAttribute('data-source', 'app');
    expect(el.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('blocked time carries data-kind=blocked and no lock', () => {
    renderBlock({ kind: 'blocked', source: 'app', title: 'Gym' });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'blocked');
    expect(el).toHaveAttribute('data-locked', 'false');
    expect(el.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('a pinned task shows a pin; with onUnpin the pin is an Unpin button', () => {
    const onUnpin = vi.fn();
    renderBlock({ kind: 'task', source: null, pinned: true, onUnpin });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'true');
    expect(el).toHaveAttribute('data-locked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it('a pinned task without onUnpin shows a decorative pin, never a lock', () => {
    renderBlock({ kind: 'task', source: null, pinned: true });
    const el = screen.getByTestId('event-block');
    expect(el.querySelector('[data-icon="pin"]')).not.toBeNull();
    expect(el.querySelector('[data-icon="lock"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unpin' })).toBeNull();
  });

  it('an auto task has neither pin nor lock', () => {
    renderBlock({ kind: 'task', source: null });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(el.querySelector('[data-icon]')).toBeNull();
  });

  it('marks a started task and draws its accent bar', () => {
    renderBlock({ kind: 'task', source: null, pinned: true, started: true });
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-started', 'true');
    expect(screen.getByTestId('started-bar')).toBeInTheDocument();
  });

  it('a slow write in flight (pending): aria-busy, data-pending, a decorative spinner and "saving" in the name', () => {
    renderBlock({ kind: 'task', source: null, title: 'Write spec', pending: true });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('data-pending', 'true');
    const spinner = screen.getByTestId('block-pending');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    // Takes no pointer events (the resize handle and drag underneath keep working) and no layout.
    expect(spinner.className).toContain('pointer-events-none');
    expect(spinner.className).toContain('absolute');
    expect(screen.getByTestId('block-body')).toHaveAccessibleName(/^Write spec, .*, saving$/);
  });

  it('nothing pending: no busy state, no spinner', () => {
    renderBlock({ kind: 'task', source: null });
    const el = screen.getByTestId('event-block');
    expect(el).not.toHaveAttribute('aria-busy');
    expect(el).not.toHaveAttribute('data-pending');
    expect(screen.queryByTestId('block-pending')).toBeNull();
  });

  it('a running piece that was never Started gets the same accent bar, marked data-running (not data-started)', () => {
    renderBlock({ kind: 'task', source: null, running: true });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-running', 'true');
    expect(el).toHaveAttribute('data-started', 'false');
    expect(screen.getByTestId('started-bar')).toBeInTheDocument();
  });

  it('the body is a focusable button named with title, time and state', () => {
    renderBlock();
    const body = screen.getByTestId('block-body');
    expect(body.tagName).toBe('BUTTON');
    expect(body).toHaveAccessibleName('Standup, Wed 10:00 AM – 11:00 AM, locked, synced from Google');
  });

  it('movable tiles say so in their accessible name', () => {
    renderBlock({ kind: 'task', source: null, title: 'Write spec' });
    expect(screen.getByTestId('block-body')).toHaveAccessibleName(/^Write spec, .*movable/);
  });

  it('action buttons are siblings of the body, never nested in it', () => {
    renderBlock({ kind: 'task', source: null, pinned: true, onUnpin: vi.fn(), onDelete: vi.fn() });
    const body = screen.getByTestId('block-body');
    expect(body.querySelector('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete block/i, hidden: true })).toBeInTheDocument();
  });

  it('the delete × is the rightmost action, so a narrow lane never pushes it out of the tile', () => {
    renderBlock({ kind: 'task', source: null, pinned: true, onUnpin: vi.fn(), onDelete: vi.fn() });
    const unpin = screen.getByRole('button', { name: 'Unpin' });
    const del = screen.getByRole('button', { name: /delete block/i, hidden: true });
    expect(unpin.parentElement).toBe(del.parentElement);
    expect(del.parentElement!.lastElementChild).toBe(del);
  });

  it('body click calls onBodyClick', () => {
    const onBodyClick = vi.fn();
    renderBlock({ onBodyClick });
    fireEvent.click(screen.getByTestId('block-body'));
    expect(onBodyClick).toHaveBeenCalledTimes(1);
  });

  it('delete × calls onDelete and does not bubble to the body', () => {
    const onDelete = vi.fn();
    const onBodyClick = vi.fn();
    renderBlock({ onDelete, onBodyClick, deleteLabel: 'Delete event' });
    fireEvent.click(screen.getByRole('button', { name: /delete event/i, hidden: true }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onBodyClick).not.toHaveBeenCalled();
  });

  it('shows the delete button without a hover on a coarse pointer', () => {
    renderBlock({ onDelete: vi.fn(), coarse: true });
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    expect(btn).toHaveAttribute('data-always-visible', 'true');
    expect(btn.className).not.toContain('group-hover:flex');
  });

  it('hides the delete button until hover on a fine pointer', () => {
    renderBlock({ onDelete: vi.fn() });
    expect(screen.getByRole('button', { name: /delete block/i, hidden: true })).toHaveAttribute('data-always-visible', 'false');
  });

  it('renders the resize handle only when given one', () => {
    const onPointerDown = vi.fn();
    renderBlock({ kind: 'task', source: null, resize: { onPointerDown, className: 'h-1.5' } });
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('selection is exposed as data-selected', () => {
    const { rerender } = renderBlock();
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-selected', 'false');
    rerender(<CalendarBlock title="Standup" kind="meeting" source="google" startLabel="10:00 AM" durationMin={60} style={{}} selected />);
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-selected', 'true');
  });

  it('uses the one-row layout below 45 minutes (title before time)', () => {
    renderBlock({ durationMin: 30, title: 'Apps', startLabel: '08:00 PM' });
    expect(screen.getByTestId('block-body').textContent).toBe('Apps08:00 PM');
  });

  it('stacks time over title from 45 minutes', () => {
    renderBlock({ durationMin: 45, title: 'Apps', startLabel: '08:00 PM' });
    expect(screen.getByTestId('block-body').textContent).toBe('08:00 PMApps');
  });
});

describe('CalendarBlock category accent', () => {
  it('a movable task takes the accent as border + text colour', () => {
    renderBlock({ kind: 'task', source: null, accent: ACCENT });
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('rgb(91, 98, 227)');
    expect(el.style.color).toBe('rgb(91, 98, 227)');
  });

  it('a pinned task keeps the same border + text tint, no fill colour', () => {
    renderBlock({ kind: 'task', source: null, pinned: true, accent: ACCENT });
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('rgb(91, 98, 227)');
    expect(el.style.backgroundColor).toBe('');
  });

  it('a meeting ignores the accent', () => {
    renderBlock({ accent: ACCENT });
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('');
    expect(el.style.color).toBe('');
    expect(el.style.backgroundColor).toBe('');
  });
});
