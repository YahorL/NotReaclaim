import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DndContext, useDndContext } from '@dnd-kit/core';
import type { Task } from '../../api/types';
import { Board, type BoardColumn } from './Board';
import { Column } from './Column';
import { resolveBoardDrop } from './boardDnd';

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

  // Spec (P6 "Pointer DnD"): the column droppable is the whole grid cell, which stretches to the
  // row height, so its empty area is a "drop at end" target — including on a collapsed column,
  // which then expands (live-verified in P8, with the header card highlighted via data-drop-target
  // while a card hovers anywhere in the cell). jsdom has no layout: that the pointer over the cell
  // below a collapsed header resolves to `col:<key>` is verified live; these pin the rest.
  it('a collapsed column still stretches and stays the column droppable; a drop on it lands at the end and expands it; Completed still rejects drops', () => {
    const probed: Record<string, { node: HTMLElement | null | undefined; disabled: boolean | undefined }> = {};
    function Probe() {
      const { droppableContainers } = useDndContext();
      for (const id of ['col:high', 'col:completed']) {
        const c = droppableContainers.get(id);
        probed[id] = { node: c?.node.current, disabled: c?.disabled };
      }
      return null;
    }
    render(
      <DndContext>
        <Column columnKey="high" tasks={[task()]} now={0} zone="UTC" nextMsFor={() => null} isTarget={false} {...columnProps} collapsed {...handlers} />
        <Column columnKey="completed" tasks={[]} now={0} zone="UTC" nextMsFor={() => null} isTarget={false} {...columnProps} collapsed {...handlers} />
        <Probe />
      </DndContext>,
    );
    const high = screen.getByTestId('column-high');
    // Collapsed renders the header only, but the cell keeps the grid's default stretch.
    expect(within(high).queryByTestId('task-row')).toBeNull();
    expect(high).not.toHaveClass('self-start');
    expect(probed['col:high']).toEqual({ node: high, disabled: false });
    expect(probed['col:completed']).toEqual({ node: screen.getByTestId('column-completed'), disabled: true });

    // A drop "on the column" (its cell, not a card) appends after the last card.
    const cols = [
      { key: 'critical' as const, tasks: [{ id: 'c1' }] },
      { key: 'high' as const, tasks: [{ id: 'h1' }, { id: 'h2' }] },
    ];
    expect(resolveBoardDrop(cols, 'c1', 'col:high')).toEqual({ taskId: 'c1', to: 'high', index: 2 });
  });

  it('a move into a collapsed column (through the same commit a pointer drop uses) expands it', () => {
    const onMove = vi.fn();
    const columns: BoardColumn[] = [
      { key: 'critical', tasks: [task({ id: 'c1', title: 'Mover', priority: 1 })] },
      { key: 'high', tasks: [task({ id: 'h1', title: 'Stayer' })] },
    ];
    render(<Board columns={columns} now={0} zone="UTC" nextMsFor={() => null} onMove={onMove} {...handlers} />);
    const high = screen.getByTestId('column-high');
    fireEvent.click(within(high).getByRole('button', { name: 'Collapse High priority' }));
    expect(high).not.toHaveClass('self-start');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Mover' }), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledWith('c1', 'high', 0);
    expect(within(high).getByRole('button', { name: 'Collapse High priority' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(high).getByText('Mover')).toBeInTheDocument();
  });
});
