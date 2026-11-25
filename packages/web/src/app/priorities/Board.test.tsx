import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DndContext, useDndContext } from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { Board, type BoardColumn } from './Board';
import { Column } from './Column';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Only card', priority: 2, sortOrder: 0, durationMs: 3_600_000,
  dueBy: null, minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending',
  completedAt: null, createdAt: '', updatedAt: '', ...over,
});

const noop = () => {};
const handlers = {
  onComplete: noop, onEdit: noop, onDelete: noop, onToggleSubtask: noop, onReorderSubtask: noop,
};
/** The redesigned Column's own props (Board lifts collapse state and the empty copy). */
const columnProps = { index: 0, collapsed: false, onToggleCollapsed: noop, emptyText: 'Drop tasks here' };

// jsdom has no layout, so these pin the wiring a live drag relies on: the element that is the
// column's droppable is the full column element, and the row lets every column stretch to the
// board's height (and the board to the pane's), so the space below a short column's last card
// lies inside that droppable's rect.
describe('Board columns as drop targets', () => {
  it('registers the whole column element (header to bottom) as the column droppable', () => {
    let droppableNode: HTMLElement | null | undefined;
    function Probe() {
      droppableNode = useDndContext().droppableContainers.get('col:high')?.node.current;
      return null;
    }
    render(
      <DndContext>
        <Column columnKey="high" tasks={[task()]} now={0} zone="UTC" nextMsFor={() => null} isTarget={false} {...columnProps} {...handlers} />
        <Probe />
      </DndContext>,
    );
    expect(droppableNode).toBe(screen.getByTestId('column-high'));
  });

  it('stretches every column to the full height of the board, and the board to its pane', () => {
    const columns: BoardColumn[] = [
      { key: 'critical', tasks: [] },
      { key: 'high', tasks: [task()] },
    ];
    render(<Board columns={columns} now={0} zone="UTC" nextMsFor={() => null} onMove={vi.fn()} {...handlers} />);
    const row = screen.getByTestId('column-high').parentElement!;
    expect(row).toBe(screen.getByTestId('column-critical').parentElement);
    // `items-start` shrank each column (and its droppable) to its own content.
    expect(row).not.toHaveClass('items-start');
    // The redesign's board is a grid of column cells (stretched by the grid's default alignment).
    expect(row).toHaveClass('grid');
    // min-, not fixed, height: a column taller than the pane still grows and the pane scrolls.
    expect(row).toHaveClass('min-h-full');
    expect(row).not.toHaveClass('h-full');
    // In the redesign the grid sits in a wrapper whose own height is auto, so its percentage
    // min-height alone resolves to nothing: the wrapper is a min-h-full flex column and the grid
    // grows into it (verified in headless Chrome: grid 100px → pane height).
    expect(row).toHaveClass('flex-1');
    expect(row.parentElement).toHaveClass('flex', 'flex-col', 'min-h-full');
  });

  it('a collapsed column keeps to its header height (self-start), an expanded one stretches; Completed still rejects drops', () => {
    let completedDisabled: boolean | undefined;
    function Probe() {
      completedDisabled = useDndContext().droppableContainers.get('col:completed')?.disabled;
      return null;
    }
    const columns: BoardColumn[] = [
      { key: 'high', tasks: [task()] },
      { key: 'completed', tasks: [] },
    ];
    render(<Board columns={columns} now={0} zone="UTC" nextMsFor={() => null} onMove={vi.fn()} {...handlers} />);
    const high = screen.getByTestId('column-high');
    const completed = screen.getByTestId('column-completed');
    expect(high).not.toHaveClass('self-start');
    expect(completed).not.toHaveClass('self-start');

    // Collapsed, a column renders only its header: stretched, its droppable would cover the whole
    // board height below that header with nothing to show it.
    fireEvent.click(within(high).getByRole('button', { name: /^Collapse / }));
    expect(high).toHaveClass('self-start');
    fireEvent.click(within(completed).getByRole('button', { name: /^Collapse / }));
    expect(completed).toHaveClass('self-start');

    fireEvent.click(within(high).getByRole('button', { name: /^Expand / }));
    expect(high).not.toHaveClass('self-start');

    render(
      <DndContext>
        <Column columnKey="completed" tasks={[]} now={0} zone="UTC" nextMsFor={() => null} isTarget={false} {...columnProps} {...handlers} />
        <Probe />
      </DndContext>,
    );
    expect(completedDisabled).toBe(true);
  });
});
