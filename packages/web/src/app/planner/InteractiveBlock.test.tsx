import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, createEvent } from '@testing-library/react';
import { InteractiveBlock, KEY_COMMIT_DEBOUNCE_MS, EDGE_HINT } from './InteractiveBlock';
import { ToastProvider } from '../shell/ToastProvider';
import { minutesToPx, minuteToPct } from './weekModel';
import { blockLeftCss, blockWidthCss } from './blockLayout';
import { LONG_PRESS_MS } from './longPress';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight (TZ=UTC)
const START = Date.parse('2026-01-05T09:00:00.000Z');
const END = Date.parse('2026-01-05T10:00:00.000Z');
const PX_PER_60MIN = minutesToPx(60); // one hour row (HOUR_ROW_PX)

function renderBlock(onCommitOrOver: Parameters<typeof InteractiveBlock>[0]['onCommit'] | Partial<Parameters<typeof InteractiveBlock>[0]> = vi.fn()) {
  const defaults = {
    dayStartMs: DAY, dayIndex: 0, startMs: START, endMs: END,
    topPct: 10, heightPct: 5, startLabel: '09:00', title: 'Write spec', kind: 'task' as const, pinned: false,
    onCommit: vi.fn(),
  };
  const overrides: Partial<Parameters<typeof InteractiveBlock>[0]> =
    typeof onCommitOrOver === 'function' ? { onCommit: onCommitOrOver } : onCommitOrOver;
  const props = { ...defaults, ...overrides };
  render(<InteractiveBlock {...props} />);
  return props.onCommit;
}

/** jsdom has no TransitionEvent, so an init `propertyName` is dropped; define it on the event. */
function fireTransitionEnd(el: Element, propertyName: string) {
  const ev = createEvent.transitionEnd(el);
  Object.defineProperty(ev, 'propertyName', { value: propertyName });
  fireEvent(el, ev);
}

/** The value a browser (and jsdom) serialises a `calc()` string back as — percentages are rounded. */
function cssCalc(value: string): string {
  const el = document.createElement('div');
  el.style.left = value;
  return el.style.left;
}

/** A fake block layer spanning `dayCount` columns of `colWidth` px (the layer, not the block's parent column, is measured). */
function mockLayerWidth(layer: HTMLElement, width: number) {
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ width, height: 1440, top: 0, left: 0, right: width, bottom: 1440, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

function renderBlockInColumn(onCommit = vi.fn(), dayIndex = 0, colWidth = 120, dayCount = 7) {
  render(
    <div data-testid="block-layer">
      <div>
        <InteractiveBlock
          dayStartMs={DAY} dayIndex={dayIndex} startMs={START} endMs={END}
          topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
          onCommit={onCommit} dayCount={dayCount}
        />
      </div>
    </div>,
  );
  mockLayerWidth(screen.getByTestId('block-layer'), colWidth * dayCount);
  return onCommit;
}

describe('InteractiveBlock', () => {
  it('renders an event-block with kind/pinned and a resize handle', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-kind', 'task');
    expect(el).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
  });

  it('moving the body down by 60 min commits a new start/end and pins', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('resizing the bottom handle down by 60 min extends the end and pins, start unchanged', () => {
    const onCommit = renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('a zero-delta click commits nothing', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });


  it('under the 5px threshold a mouse press is still a click: no lift, no ghost', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 52, clientY: 102, pointerId: 1 });
    expect(el).not.toHaveAttribute('data-dragging');
    expect(el.style.transform).toBe('');
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
  });

  it('while dragging the tile follows the raw pointer, lifted and tilted, transitions off', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 107, pointerId: 1 }); // 7px: past the threshold, under a slot
    expect(el).toHaveAttribute('data-dragging', 'true');
    expect(el.style.transform).toBe('translate(0px, 7px) scale(1.05) rotate(-0.8deg)');
    expect(el.className).not.toContain('[transition:');
    // 7 minutes snaps to no change: the ghost sits on the original slot.
    expect(screen.getByTestId('drag-ghost').style.top).toBe(`${minuteToPct(9 * 60)}%`);
  });

  it('the ghost sits at the snapped target with a "<day> · <start>" pill; the tile shows the snapped time', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 }); // 20px ≈ 20min → snaps to 15
    expect(el.style.transform).toBe('translate(0px, 20px) scale(1.05) rotate(-0.8deg)');
    const ghost = screen.getByTestId('drag-ghost');
    expect(ghost.style.top).toBe(`${minuteToPct(9 * 60 + 15)}%`);
    expect(ghost.style.height).toBe('5%');
    expect(screen.getByTestId('drag-label').textContent).toMatch(/^Mon · 9:15\sAM$/);
    expect(el.textContent).toMatch(/9:15\sAM/);
  });

  it('resize: the height follows the pointer exactly, the ghost shows the snapped end', () => {
    renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + minutesToPx(70), pointerId: 1 });
    const el = screen.getByTestId('event-block');
    expect(el).toHaveAttribute('data-resizing', 'true');
    expect(el.style.height).toBe(`${(5 / 100) * 1440 + minutesToPx(70)}px`); // raw, unsnapped
    const ghost = screen.getByTestId('drag-ghost');
    expect(ghost.style.top).toBe('10%');
    expect(Number.parseFloat(ghost.style.height)).toBeCloseTo(minuteToPct(9 * 60 + 135) - minuteToPct(9 * 60), 6); // 60 + 70 → 135 min
    expect(screen.getByTestId('drag-label').textContent).toMatch(/^2h 15m · ends 11:15\sAM$/);
  });

  it('a resize commits at least one 15-minute slot', () => {
    const onCommit = renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 500 - 3 * PX_PER_60MIN, pointerId: 1 });
    expect(screen.getByTestId('drag-label').textContent).toMatch(/^15m · ends 9:15\sAM$/);
    fireEvent.pointerUp(handle, { clientY: 500 - 3 * PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T09:15:00.000Z', pinned: true });
  });

  it('a resize never runs past the end of the column', () => {
    const onCommit = renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 100 + 30 * PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-06T00:00:00.000Z', pinned: true });
  });

  it('a zero-delta resize commits nothing and never selects', () => {
    const onClick = vi.fn();
    const onCommit = renderBlock({ onClick });
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 105, pointerId: 1 }); // 5 min → snaps to 0
    fireEvent.pointerUp(handle, { clientY: 105, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the grip widens while resizing (22 → 30px pill, via the wrapper\'s data-resizing)', () => {
    renderBlock();
    const handle = screen.getByTestId('resize-handle');
    expect(handle.className).toContain('after:w-[22px]');
    expect(handle.className).toContain('group-data-[resizing=true]:after:w-[30px]');
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 });
    expect(screen.getByTestId('event-block')).toHaveAttribute('data-resizing', 'true');
  });

  it('resize never shrinks the raw height below 12px', () => {
    renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
    expect(screen.getByTestId('event-block').style.height).toBe('12px');
  });

  it('a second pointer landing mid-drag is ignored — the first pointer keeps the gesture', () => {
    const onCommit = renderBlock();
    const handle = screen.getByTestId('resize-handle');
    const el = screen.getByTestId('event-block');
    // Pointer 1 grabs the resize handle: `resize` never defers, so the capture is live at once.
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    // Pointer 2 lands on the tile body 4h lower. jsdom does not implement pointer capture, so it
    // cannot retarget this event the way a browser would — what we CAN assert is the thing the
    // capture would otherwise hide: the drag refs (mode / startY) are single-slot, and a second
    // `begin()` would re-seed them to 'move' from y=432. So we read the *committed geometry*:
    // measured from pointer 1's origin (200) it is a +5h resize; measured from pointer 2's it
    // would be a +1h move. One is proof of ownership, the other of the bug.
    fireEvent.pointerDown(el, { clientY: 200 + 4 * PX_PER_60MIN, pointerId: 2 });
    fireEvent.pointerMove(el, { clientY: 200 + 5 * PX_PER_60MIN, pointerId: 2 });
    fireEvent.pointerUp(el, { clientY: 200 + 5 * PX_PER_60MIN, pointerId: 2 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T09:00:00.000Z', // start untouched → still a resize, i.e. pointer 1's
      endsAt: '2026-01-05T15:00:00.000Z',   // 10:00 + 5h, delta measured from y=200
      pinned: true,
    });
  });

  it('ghost and label disappear after release', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });

  it('a drag released back where it started commits nothing and is not a click', () => {
    const onClick = vi.fn();
    const onCommit = renderBlock({ onClick });
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 160, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 101, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 101, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores a secondary-button press', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1, button: 2 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('InteractiveBlock cross-day move', () => {
  it('previews a one-column shift and commits +1 day', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 230, clientY: 100, pointerId: 1 }); // dx=130 → round(130/120)=1
    expect(el.style.transform).toBe('translate(130px, 0px) scale(1.05) rotate(-0.8deg)'); // raw pointer
    const ghost = screen.getByTestId('drag-ghost');
    expect(ghost.style.left).toBe(cssCalc(blockLeftCss((1 / 7) * 100, 0, 1))); // snapped to Tuesday
    expect(ghost.style.width).toBe(cssCalc(blockWidthCss(100 / 7, 0, 1)));
    expect(screen.getByTestId('drag-label').textContent).toMatch(/^Tue · 9:00\sAM$/);
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true,
    });
  });

  it('measures one column as the layer width over the day count (3-day window)', () => {
    const onCommit = renderBlockInColumn(vi.fn(), 0, 200, 3);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 310, clientY: 100, pointerId: 1 }); // dx=210 → round(210/200)=1
    expect(screen.getByTestId('drag-ghost').style.left).toBe(cssCalc(blockLeftCss((1 / 3) * 100, 0, 1)));
    fireEvent.pointerUp(el, { clientX: 310, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true,
    });
  });

  it('combines a day shift with a snapped vertical move', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-06T10:00:00.000Z', endsAt: '2026-01-06T11:00:00.000Z', pinned: true,
    });
  });

  it('clamps the day delta at the week edge (Sunday cannot go right)', () => {
    const onCommit = renderBlockInColumn(vi.fn(), 6);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(screen.getByTestId('drag-ghost').style.left).toBe(cssCalc(blockLeftCss((6 / 7) * 100, 0, 1))); // stays on Sunday
    fireEvent.pointerUp(el, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled(); // day clamped to 0 + no vertical delta = no-op
  });

  it('a pure day shift with zero vertical delta still no-ops when clamped (Monday cannot go left)', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 100 - 130, clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('InteractiveBlock cross-day move across a DST transition', () => {
  it('keeps the wall-clock time when dragging onto the spring-forward day', () => {
    // America/New_York, planner day start 03:00 → column anchors are 08:00Z (EST) then 07:00Z (EDT)
    const onCommit = vi.fn();
    render(
      <div data-testid="block-layer">
        <InteractiveBlock
          dayStartMs={Date.parse('2026-03-07T08:00:00.000Z')} dayIndex={0}
          startMs={Date.parse('2026-03-07T14:00:00.000Z')} endMs={Date.parse('2026-03-07T15:00:00.000Z')}
          topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
          zone="America/New_York" onCommit={onCommit} dayCount={2}
        />
      </div>,
    );
    mockLayerWidth(screen.getByTestId('block-layer'), 240); // 2 columns × 120px
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100, pointerId: 1 }); // +1 column
    // 09:00 EST → 09:00 EDT (13:00Z), not a blind +24h (which would land at 10:00 EDT)
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-03-08T13:00:00.000Z', endsAt: '2026-03-08T14:00:00.000Z', pinned: true,
    });
  });
});

describe('InteractiveBlock release (spring into the slot, no jump)', () => {
  const props = {
    dayStartMs: DAY, dayIndex: 0, startMs: START, endMs: END,
    topPct: 10, heightPct: 5, startLabel: '09:00', title: 'Write spec', kind: 'task' as const, pinned: false,
  };

  it('in the release render the transform is gone and the spring transition is back on', () => {
    // The caller (WeekGrid) moves the target geometry in on this same render; the transform and
    // top/left then transition together, so the tile springs from the drop point into the slot.
    render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(el.className).not.toContain('[transition:');
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(el.style.transform).toBe('');
    expect(el).not.toHaveAttribute('data-dragging');
    expect(el.className).toContain('[transition:top_var(--dur-move)_var(--ease-spring)');
  });

  it('after props update the wrapper has no transform and carries data-settling until transitionend', () => {
    const { rerender } = render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    rerender(<InteractiveBlock {...props} startMs={START + 15 * 60_000} endMs={END + 15 * 60_000} topPct={11.5} onCommit={vi.fn()} />);
    expect(el.style.transform).toBe('');
    expect(el.style.top).toBe('11.5%');
    expect(el).toHaveAttribute('data-settling', 'true');
    // A child's transitionend (the grip pill) bubbles up and must not count.
    fireTransitionEnd(screen.getByTestId('resize-handle'), 'top');
    expect(el).toHaveAttribute('data-settling', 'true');
    fireTransitionEnd(el, 'opacity'); // not a geometry property
    expect(el).toHaveAttribute('data-settling', 'true');
    fireTransitionEnd(el, 'top');
    expect(el).not.toHaveAttribute('data-settling');
  });

  it('data-settling falls back to a timeout when no transitionend arrives', () => {
    vi.useFakeTimers();
    try {
      render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
      const el = screen.getByTestId('event-block');
      fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
      expect(el).toHaveAttribute('data-settling', 'true');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(el).not.toHaveAttribute('data-settling');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a click (no drag) never settles and never carries a transform', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(el.style.transform).toBe('');
    expect(el).not.toHaveAttribute('data-settling');
  });

  it('an idle block glides on a data change (replan) — the spring is always on when not dragging', () => {
    const { rerender } = render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
    const el = screen.getByTestId('event-block');
    rerender(<InteractiveBlock {...props} startMs={START + 60 * 60_000} endMs={END + 60 * 60_000} topPct={20} onCommit={vi.fn()} />);
    expect(el.className).toContain('[transition:top_var(--dur-move)_var(--ease-spring)');
    expect(el.style.transform).toBe('');
  });

  it('a resize release drops the raw height for the target in one render (spring-strong settle)', () => {
    render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
    const handle = screen.getByTestId('resize-handle');
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    expect(el.style.height).toBe('5%');
    expect(el.className).toContain('height_var(--dur-resize)_var(--ease-spring-strong)');
  });
});

describe('InteractiveBlock delete button', () => {
  function renderWithDelete(onDelete = vi.fn()) {
    render(
      <InteractiveBlock
        dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()} onDelete={onDelete}
      />,
    );
    return onDelete;
  }

  it('renders a delete button when onDelete is given', () => {
    renderWithDelete();
    // hidden:true — the button is display:none until group-hover (jsdom can't hover)
    expect(screen.getByRole('button', { name: /delete block/i, hidden: true })).toBeInTheDocument();
  });

  it('clicking delete calls onDelete and does not start a drag/commit', () => {
    const onCommit = vi.fn();
    const onDelete = vi.fn();
    render(
      <InteractiveBlock
        dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={onCommit} onDelete={onDelete}
      />,
    );
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    fireEvent.pointerDown(btn, { clientY: 100, pointerId: 1 });
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('no delete button when onDelete is omitted', () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: /delete block/i, hidden: true })).toBeNull();
  });
});

describe('InteractiveBlock unpin button', () => {
  function renderPinnedBlock(onCommit = vi.fn(), onUnpin = vi.fn()) {
    render(
      <InteractiveBlock
        dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={true}
        onCommit={onCommit} onUnpin={onUnpin}
      />,
    );
    return { onCommit, onUnpin };
  }

  it('renders an unpin button with aria-label when pinned', () => {
    renderPinnedBlock();
    expect(screen.getByRole('button', { name: /unpin/i })).toBeInTheDocument();
  });

  it('clicking the unpin button calls onUnpin and not onCommit', () => {
    const { onCommit, onUnpin } = renderPinnedBlock();
    fireEvent.click(screen.getByRole('button', { name: /unpin/i }));
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('pointerDown on unpin button does not start a drag', () => {
    const { onCommit } = renderPinnedBlock();
    const btn = screen.getByRole('button', { name: /unpin/i });
    fireEvent.pointerDown(btn, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId('event-block'), { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId('event-block'), { clientY: 200, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('no unpin button when not pinned', () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: /unpin/i })).not.toBeInTheDocument();
  });
});

describe('InteractiveBlock click (drag/click discrimination)', () => {
  it('a zero-delta press calls onClick and commits nothing', () => {
    const onClick = vi.fn();
    const onCommit = renderBlock({ onClick });
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a real drag commits and does NOT call onClick', () => {
    const onClick = vi.fn();
    const onCommit = renderBlock({ onClick });
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clicking the delete button does not trigger onClick', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    renderBlock({ onClick, onDelete });
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    fireEvent.pointerDown(btn, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(btn, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('deleteLabel renames the delete button', () => {
    renderBlock({ onDelete: vi.fn(), deleteLabel: 'Delete event' });
    expect(screen.getByRole('button', { name: /delete event/i, hidden: true })).toBeInTheDocument();
  });
});

describe('InteractiveBlock accent tinting', () => {
  const ACCENT = '#5b62e3';
  const renderAccent = (pinned: boolean) => render(
    <InteractiveBlock
      dayStartMs={Date.parse('2026-01-05T00:00:00.000Z')} dayIndex={0}
      startMs={Date.parse('2026-01-05T09:00:00.000Z')} endMs={Date.parse('2026-01-05T10:00:00.000Z')}
      topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={pinned}
      onCommit={vi.fn()} accent={ACCENT}
    />,
  );

  it('movable task with accent: borderColor + color inline styles', () => {
    renderAccent(false);
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('rgb(91, 98, 227)');
    expect(el.style.color).toBe('rgb(91, 98, 227)');
    expect(el).toHaveAttribute('data-pinned', 'false');
  });

  it('pinned task with accent: same border + text tint, no fill colour (pinned stays dashed)', () => {
    renderAccent(true);
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('rgb(91, 98, 227)');
    expect(el.style.backgroundColor).toBe('');
    expect(el).toHaveAttribute('data-pinned', 'true');
  });
});

describe('InteractiveBlock keyboard activation', () => {
  it('a keyboard click on the body (detail 0) calls onClick', () => {
    const onClick = vi.fn();
    renderBlock({ onClick });
    fireEvent.click(screen.getByTestId('block-body'), { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a pointer click on the body (detail ≥ 1) is left to the drag machinery', () => {
    // A native click can follow a short drag that ended over the tile; it must not select.
    const onClick = vi.fn();
    renderBlock({ onClick });
    fireEvent.click(screen.getByTestId('block-body'), { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('InteractiveBlock on a coarse pointer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const coarseProps = {
    dayStartMs: DAY, dayIndex: 0, startMs: START, endMs: END,
    topPct: 10, heightPct: 5, startLabel: '09:00', title: 'Write spec',
    kind: 'task' as const, pinned: false, coarse: true,
  };

  it('a press released before the long press is a tap, not a drag', () => {
    const onCommit = vi.fn();
    const onClick = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} onClick={onClick} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('moving before the timer disarms the press — the gesture stays a scroll', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('after the long press the drag arms and commits the snapped move', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(screen.getByTestId('drag-label')).toBeInTheDocument();
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('an armed coarse block lifts at once, before any travel', () => {
    render(<InteractiveBlock {...coarseProps} onCommit={vi.fn()} />);
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('touch-pan-y');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(el).toHaveAttribute('data-dragging', 'true');
    expect(el.className).toContain('shadow-lift');
    expect(el.style.transform).toContain('scale(1.05)');
  });

  it('a long press lifted in place and released is a tap, not a commit', () => {
    const onCommit = vi.fn();
    const onClick = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} onClick={onClick} />);
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(el, { clientX: 51, clientY: 101, pointerId: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  // jsdom has no PointerEvent, so a `pointerType` passed in fireEvent's init is dropped (the
  // handler sees null — which is why every other test here is treated as touch). Defining it on
  // the event object is what actually reaches React's synthetic event.
  function firePointer(kind: 'pointerDown' | 'pointerMove' | 'pointerUp', el: Element, init: Record<string, unknown>, pointerType: string) {
    const ev = createEvent[kind](el, init);
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    fireEvent(el, ev);
  }

  it('a mouse on a coarse-primary device (iPad + trackpad) drags immediately', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    // No advanceTimersByTime anywhere: a mouse never waits, whatever the primary pointer is.
    firePointer('pointerDown', el, { clientX: 50, clientY: 100, pointerId: 1 }, 'mouse');
    firePointer('pointerMove', el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 }, 'mouse');
    firePointer('pointerUp', el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 }, 'mouse');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a fine pointer keeps dragging immediately (no long press, no lift)', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} coarse={false} onCommit={onCommit} />);
    const el = screen.getByTestId('event-block');
    expect(el.className).not.toContain('touch-pan-y');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(el.style.transform).toContain('scale(1.05)'); // past the threshold at once — no long press
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('gives a tall tile a 16px, scroll-proof resize target', () => {
    render(<InteractiveBlock {...coarseProps} heightPct={4.1667} onCommit={vi.fn()} />); // 60 min
    const handle = screen.getByTestId('resize-handle');
    expect(handle.className).toContain('h-4');
    expect(handle.className).toContain('touch-none');
  });

  it('shows the grip without a hover on touch', () => {
    render(<InteractiveBlock {...coarseProps} heightPct={4.1667} onCommit={vi.fn()} />);
    expect(screen.getByTestId('resize-handle')).toHaveAttribute('data-grip-visible', 'true');
  });

  it('keeps the small target on a 15-minute tile', () => {
    render(<InteractiveBlock {...coarseProps} heightPct={1.0417} onCommit={vi.fn()} />); // 15 min
    expect(screen.getByTestId('resize-handle').className).toContain('h-1.5');
  });

  it('keeps the unpin button above the enlarged resize hit area', () => {
    // A 30-min tile is 29px tall and the coarse handle covers its bottom 24px; without a
    // stacking context of its own the in-flow 🔒 would sit under it and swallow the tap.
    const onUnpin = vi.fn();
    render(<InteractiveBlock {...coarseProps} heightPct={2.0833} pinned onUnpin={onUnpin} onCommit={vi.fn()} />);
    const unpin = screen.getByRole('button', { name: /unpin/i });
    expect(unpin.className).toContain('relative');
    expect(unpin.className).toContain('z-10');
    fireEvent.click(unpin);
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it('resize drags immediately on touch — no long press', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...coarseProps} onCommit={onCommit} />);
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('shows the delete button without a hover on touch', () => {
    render(<InteractiveBlock {...coarseProps} onCommit={vi.fn()} onDelete={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    expect(btn).toHaveAttribute('data-always-visible', 'true');
    expect(btn.className).not.toContain('hidden');
  });
});

describe('InteractiveBlock scroll compensation', () => {
  /** The component only reads scrollTop / getBoundingClientRect, so a plain object is enough. */
  function fakeScroller(): HTMLElement {
    return {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 300, width: 300, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
    } as unknown as HTMLElement;
  }


  it('folds the container scroll during a drag into the committed move', () => {
    const onCommit = vi.fn();
    const scroller = fakeScroller();
    render(
      <InteractiveBlock
        dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={onCommit} getScrollContainer={() => scroller}
      />,
    );
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    // The finger stays put; the auto-scroll moved the grid one hour's worth underneath it.
    scroller.scrollTop = PX_PER_60MIN;
    fireEvent.pointerMove(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({
      startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z', pinned: true,
    });
  });

  it('is a no-op without a container (every existing caller before this task)', () => {
    const onCommit = renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a stationary finger in the edge zone keeps the preview in step with the auto-scroll', () => {
    // The whole point of edge auto-scroll is a finger that rests near the edge: no pointermove
    // arrives, so only the rAF tick can move the preview. If it does not, the tile rides the
    // scrolling content away from the finger and pointer-up commits a jump.
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    const realCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => frames.push(cb)) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    try {
      const onCommit = vi.fn();
      const scroller = fakeScroller(); // rect top 0 / bottom 600 → bottom edge zone starts at 552
      render(
        <InteractiveBlock
          dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
          topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
          onCommit={onCommit} getScrollContainer={() => scroller}
        />,
      );
      const el = screen.getByTestId('event-block');
      fireEvent.pointerDown(el, { clientX: 50, clientY: 560, pointerId: 1 });
      fireEvent.pointerMove(el, { clientX: 50, clientY: 590, pointerId: 1 });
      // 30px of finger travel = 30 min → snapped to +30.
      expect(screen.getByTestId('drag-label').textContent).toMatch(/^Mon · 9:30\sAM$/);

      // Now the finger stops. One auto-scroll frame fires — and nothing else.
      const step = 12; // edgeScrollStep(590, 0, 600)
      act(() => { frames.splice(0).forEach((cb) => cb(0)); });
      expect(scroller.scrollTop).toBe(step);
      // 30px of finger + 12px of scroll = 42 min → snapped to +45, with no new pointermove.
      expect(screen.getByTestId('drag-label').textContent).toMatch(/^Mon · 9:45\sAM$/);
      // The tile itself rides the scroll too: 30px of finger + 12px of scroll.
      expect(screen.getByTestId('event-block').style.transform).toBe('translate(0px, 42px) scale(1.05) rotate(-0.8deg)');

      // And the commit agrees with what the preview showed — no landing jump.
      fireEvent.pointerUp(el, { clientX: 50, clientY: 590, pointerId: 1 });
      expect(onCommit).toHaveBeenCalledWith({
        startsAt: '2026-01-05T09:45:00.000Z', endsAt: '2026-01-05T10:45:00.000Z', pinned: true,
      });
    } finally {
      globalThis.requestAnimationFrame = realRaf;
      globalThis.cancelAnimationFrame = realCaf;
    }
  });
});


describe('InteractiveBlock keyboard move / resize', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const props = {
    dayStartMs: DAY, dayIndex: 0, startMs: START, endMs: END,
    topPct: 10, heightPct: 5, startLabel: '09:00', title: 'Write spec', kind: 'task' as const, pinned: false,
  };
  const body = () => screen.getByTestId('block-body');

  it('ArrowDown previews at once and commits once the keys go quiet', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} onPreview={onPreview} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    expect(onPreview).toHaveBeenCalledWith(START + 15 * 60_000, END + 15 * 60_000);
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z', pinned: true });
  });

  it('key repeat restarts the debounce: one commit for a burst', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS - 50); });
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS - 50); });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Shift+ArrowDown lengthens by 15 minutes', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown', shiftKey: true });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledWith({ startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:15:00.000Z', pinned: true });
  });

  it('ArrowRight crosses to the next day (wall-clock)', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowRight' });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledWith({ startsAt: '2026-01-06T09:00:00.000Z', endsAt: '2026-01-06T10:00:00.000Z', pinned: true });
  });

  it('blur flushes the pending commit at once — exactly one, never a second from the timer', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    fireEvent.blur(body());
    expect(onCommit).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2 * KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('unmount flushes the pending commit', () => {
    const onCommit = vi.fn();
    const { unmount } = render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2 * KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a pointer press flushes the pending keyboard commit before any drag', () => {
    const onCommit = vi.fn();
    render(<InteractiveBlock {...props} onCommit={onCommit} />);
    fireEvent.keyDown(body(), { key: 'ArrowDown' });
    fireEvent.pointerDown(screen.getByTestId('event-block'), { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({ startsAt: '2026-01-05T09:15:00.000Z', endsAt: '2026-01-05T10:15:00.000Z', pinned: true });
  });

  it('a clamped key is a no-op (no preview, no commit)', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<InteractiveBlock {...props} startMs={DAY} endMs={DAY + 60 * 60_000} topPct={0} onCommit={onCommit} onPreview={onPreview} />);
    fireEvent.keyDown(body(), { key: 'ArrowUp' });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS); });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('at the edge of the rendered days, toasts the paging hint and commits nothing', () => {
    const onCommit = vi.fn();
    render(<ToastProvider><InteractiveBlock {...props} onCommit={onCommit} /></ToastProvider>);
    fireEvent.keyDown(body(), { key: 'ArrowLeft' });
    act(() => { vi.advanceTimersByTime(KEY_COMMIT_DEBOUNCE_MS); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast-region')).toHaveTextContent(EDGE_HINT);
  });

  it('arrows are prevented (they would scroll the hours); other keys are left alone', () => {
    render(<InteractiveBlock {...props} onCommit={vi.fn()} />);
    const down = createEvent.keyDown(body(), { key: 'ArrowDown' });
    fireEvent(body(), down);
    expect(down.defaultPrevented).toBe(true);
    const tab = createEvent.keyDown(body(), { key: 'Tab' });
    fireEvent(body(), tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('Delete removes the block', () => {
    const onDelete = vi.fn();
    render(<InteractiveBlock {...props} onCommit={vi.fn()} onDelete={onDelete} />);
    fireEvent.keyDown(body(), { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('the accessible name mentions the arrow keys and points at the shared instructions', () => {
    render(<InteractiveBlock {...props} onCommit={vi.fn()} describedBy="planner-block-keys" />);
    expect(body()).toHaveAccessibleName(/movable: drag or use arrow keys, Shift\+arrows to resize$/);
    expect(body()).toHaveAttribute('aria-describedby', 'planner-block-keys');
  });
});

describe('InteractiveBlock vs. stray text selections', () => {
  it('a press clears a selection that would otherwise become a native drag of that text', () => {
    renderBlock();
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId('block-body'));
    window.getSelection()!.addRange(range);
    expect(window.getSelection()!.isCollapsed).toBe(false);
    fireEvent.pointerDown(screen.getByTestId('event-block'), { clientX: 50, clientY: 100, pointerId: 1 });
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it('a tile is never a native drag source', () => {
    renderBlock();
    const ev = createEvent.dragStart(screen.getByTestId('event-block'));
    fireEvent(screen.getByTestId('event-block'), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId('event-block').className).toContain('select-none');
  });
});
