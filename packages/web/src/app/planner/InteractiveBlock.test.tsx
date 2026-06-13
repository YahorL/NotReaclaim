import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InteractiveBlock } from './InteractiveBlock';
import { GRID_COLUMN_PX } from './weekModel';
import { minutesToPx } from './weekModel';

const DAY = Date.parse('2026-01-05T00:00:00.000Z'); // local midnight (TZ=UTC)
const START = Date.parse('2026-01-05T09:00:00.000Z');
const END = Date.parse('2026-01-05T10:00:00.000Z');
const PX_PER_60MIN = (60 / 960) * GRID_COLUMN_PX; // = 58

function renderBlock(onCommit = vi.fn()) {
  render(
    <InteractiveBlock
      id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
      topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
      onCommit={onCommit}
    />,
  );
  return onCommit;
}

function renderBlockInColumn(onCommit = vi.fn(), dayIndex = 0, colWidth = 120) {
  const { container } = render(
    <div>
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={dayIndex} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={onCommit}
      />
    </div>,
  );
  const column = container.firstChild as HTMLElement;
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ width: colWidth, height: 928, top: 0, left: 0, right: colWidth, bottom: 928, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
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

  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('preview snaps to the 15-min grid while moving (sub-step drag → no offset)', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 107, pointerId: 1 }); // 7px ≈ 7.2min → snaps to 0
    expect(el.style.transform).toBe('translate(0px, 0px)');
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });

  it('preview ticks one 15-min step and shows the live time label', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 }); // 20px ≈ 20.7min → snaps to 15 → 14.5px
    expect(el.style.transform).toBe('translate(0px, 14.5px)');
    expect(screen.getByTestId('drag-label')).toHaveTextContent(
      `${fmt(START + 15 * 60_000)} – ${fmt(END + 15 * 60_000)}`,
    );
  });

  it('resize preview snaps and shows the live label with the start unchanged', () => {
    renderBlock();
    const handle = screen.getByTestId('resize-handle');
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200 + PX_PER_60MIN, pointerId: 1 });
    const el = screen.getByTestId('event-block');
    expect(el.style.height).toBe('calc(5% + 58px)');
    expect(screen.getByTestId('drag-label')).toHaveTextContent(
      `${fmt(START)} – ${fmt(END + 60 * 60_000)}`,
    );
  });

  it('label disappears after release', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });
});

describe('InteractiveBlock cross-day move', () => {
  it('previews a one-column shift and commits +1 day', () => {
    const onCommit = renderBlockInColumn();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 230, clientY: 100, pointerId: 1 }); // dx=130 → round(130/120)=1
    expect(el.style.transform).toBe('translate(120px, 0px)');
    fireEvent.pointerUp(el, { clientX: 230, clientY: 100, pointerId: 1 });
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
    expect(el.style.transform).toBe('translate(0px, 0px)');
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

describe('InteractiveBlock held preview (flicker fix)', () => {
  it('after pointerUp with a 15-min move, the transform STILL shows the moved offset (held)', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    // Move down by ~20px which snaps to 15 min
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 }); // snaps to 15 min
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    // After release, the transform should still reflect the held preview (not reset to 0)
    expect(el.style.transform).toBe(`translate(0px, ${minutesToPx(15)}px)`);
  });

  it('after rerendering with new startMs/endMs props, the transform resets to 0 (cleared)', () => {
    const { rerender } = render(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 }); // snaps to 15 min
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    // Held preview is active
    expect(el.style.transform).toBe(`translate(0px, ${minutesToPx(15)}px)`);
    // Rerender with new props (simulating optimistic update landing)
    const NEW_START = START + 15 * 60_000;
    const NEW_END = END + 15 * 60_000;
    rerender(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={NEW_START} endMs={NEW_END}
        topPct={10} heightPct={5} startLabel="09:15" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    // After props change, held preview should clear → transform back to 0
    expect(el.style.transform).toBe('translate(0px, 0px)');
  });

  it('zero-delta click still resets immediately (no held preview on no-op)', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 100, pointerId: 1 });
    // No-op move — no held preview
    expect(el.style.transform).toBe('translate(0px, 0px)');
  });

  it('drag label disappears on release even with held preview', () => {
    renderBlock();
    const el = screen.getByTestId('event-block');
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(screen.getByTestId('drag-label')).toBeInTheDocument();
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    expect(screen.queryByTestId('drag-label')).not.toBeInTheDocument();
  });

  // The "jump from initial to final" fix. The drag preview lives in `transform` while the
  // committed position arrives in `top`. If the replan transition (transition-[top,height])
  // were active on the render that moves top to its new value, the browser would animate top
  // old→new while transform snaps to 0 — the block jumps back to the start then glides to the
  // end. So the block must stay transition-none through the *landed paint* (held → landing).
  it('stays transition-none through the held preview AND the landed commit (no jump)', () => {
    const { rerender } = render(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    const el = screen.getByTestId('event-block');
    expect(el.className).toContain('transition-[top,height]'); // idle replan glide
    fireEvent.pointerDown(el, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 120, pointerId: 1 });
    // Held: no transition
    expect(el.className).toContain('transition-none');
    // Commit lands (new props after a drag) → `landing` keeps the transition off for the
    // painted frame, so top jumps to newTop with transform 0 and nothing animates.
    rerender(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START + 15 * 60_000} endMs={END + 15 * 60_000}
        topPct={11.5} heightPct={5} startLabel="09:15" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    expect(el.className).toContain('transition-none');
    expect(el.className).not.toContain('transition-[top,height]');
  });

  // A replan (props change with NO preceding drag) must keep the glide — `landing` only
  // engages when a held preview was being cleared.
  it('keeps the replan glide when props change without a drag', () => {
    const { rerender } = render(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    const el = screen.getByTestId('event-block');
    rerender(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START + 60 * 60_000} endMs={END + 60 * 60_000}
        topPct={20} heightPct={5} startLabel="10:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()}
      />,
    );
    expect(el.className).toContain('transition-[top,height]');
  });
});

describe('InteractiveBlock delete button', () => {
  function renderWithDelete(onDelete = vi.fn()) {
    render(
      <InteractiveBlock
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
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
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
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
        id="b1" dayStartMs={DAY} dayIndex={0} startMs={START} endMs={END}
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

describe('InteractiveBlock accent tinting', () => {
  const ACCENT = '#5b62e3';

  it('movable task with accent: borderColor + color inline styles', () => {
    render(
      <InteractiveBlock
        id="b1" dayStartMs={Date.parse('2026-01-05T00:00:00.000Z')} dayIndex={0}
        startMs={Date.parse('2026-01-05T09:00:00.000Z')} endMs={Date.parse('2026-01-05T10:00:00.000Z')}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned={false}
        onCommit={vi.fn()} accent={ACCENT}
      />,
    );
    const el = screen.getByTestId('event-block');
    expect(el.style.borderColor).toBe('rgb(91, 98, 227)');
    expect(el.style.color).toBe('rgb(91, 98, 227)');
    expect(el.className).toContain('border-dashed');
    expect(el.className).not.toContain('border-low');
  });

  it('pinned task with accent: backgroundColor inline style, keeps white text', () => {
    render(
      <InteractiveBlock
        id="b1" dayStartMs={Date.parse('2026-01-05T00:00:00.000Z')} dayIndex={0}
        startMs={Date.parse('2026-01-05T09:00:00.000Z')} endMs={Date.parse('2026-01-05T10:00:00.000Z')}
        topPct={10} heightPct={5} startLabel="09:00" title="Write spec" kind="task" pinned
        onCommit={vi.fn()} accent={ACCENT}
      />,
    );
    const el = screen.getByTestId('event-block');
    expect(el.style.backgroundColor).toBe('rgb(91, 98, 227)');
    expect(el.className).not.toContain('bg-low');
    expect(el.className).toContain('text-white');
  });
});
