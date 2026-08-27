import { describe, it, expect } from 'vitest';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ClientRect, DroppableContainer, UniqueIdentifier } from '@dnd-kit/core';
import type { Task, UpdateTaskInput } from '../../api/types';
import { boardKeyboardCoordinates, columnDroppableId, overColumnKey, resolveBoardDrop, taskMovePatch, type BoardDropColumn } from './boardDnd';

const cols: BoardDropColumn[] = [
  { key: 'critical', tasks: [{ id: 'c1' }] },
  { key: 'high', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { key: 'low', tasks: [{ id: 'l1' }] },
  { key: 'backlog', tasks: [] },
  { key: 'completed', tasks: [{ id: 'd1' }] },
];

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'T', priority: 2, sortOrder: 0, durationMs: 1,
  dueBy: null, minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending',
  completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '', ...over,
});

describe('columnDroppableId / overColumnKey', () => {
  it('round-trips a column key through its droppable id', () => {
    expect(columnDroppableId('backlog')).toBe('col:backlog');
    expect(overColumnKey(cols, 'col:backlog')).toBe('backlog');
  });

  it('resolves a card id to the column that holds it', () => {
    expect(overColumnKey(cols, 'b')).toBe('high');
  });

  it('is null for no target and for an unknown id', () => {
    expect(overColumnKey(cols, null)).toBeNull();
    expect(overColumnKey(cols, 'ghost')).toBeNull();
  });
});

describe('resolveBoardDrop', () => {
  it('dropping on a column container appends to it', () => {
    expect(resolveBoardDrop(cols, 'l1', 'col:critical')).toEqual({ taskId: 'l1', to: 'critical', index: 1 });
  });

  it('same-column upward move inserts at the hovered index', () => {
    expect(resolveBoardDrop(cols, 'c', 'a')).toEqual({ taskId: 'c', to: 'high', index: 0 });
  });

  it('same-column downward move inserts after the hovered index', () => {
    expect(resolveBoardDrop(cols, 'a', 'c')).toEqual({ taskId: 'a', to: 'high', index: 3 });
  });

  it('cross-column drop on a card inserts at that card', () => {
    expect(resolveBoardDrop(cols, 'l1', 'b')).toEqual({ taskId: 'l1', to: 'high', index: 1 });
  });

  it('is null when the drag is released outside every target', () => {
    expect(resolveBoardDrop(cols, 'a', null)).toBeNull();
  });

  it('is null for the completed column — it rejects drops', () => {
    expect(resolveBoardDrop(cols, 'a', 'col:completed')).toBeNull();
    expect(resolveBoardDrop(cols, 'a', 'd1')).toBeNull();
  });

  it('is null when the dragged id is not on the board', () => {
    expect(resolveBoardDrop(cols, 'ghost', 'a')).toBeNull();
  });
});

describe('taskMovePatch', () => {
  const neighbours = [{ id: 'x', sortOrder: 1 }, { id: 'y', sortOrder: 3 }];

  it('within the same bucket patches only sortOrder', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 2 }), to: 'high', index: 1, columnTasks: neighbours });
    expect(patch).toEqual({ sortOrder: 2 });
  });

  it('across buckets patches the priority too', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 2 }), to: 'critical', index: 1, columnTasks: neighbours });
    expect(patch).toEqual({ priority: 1, sortOrder: 2 });
  });

  it('into the backlog patches status without touching priority', () => {
    const patch = taskMovePatch({ taskId: 't1', task: task({ priority: 4 }), to: 'backlog', index: 0, columnTasks: [] });
    expect(patch).toEqual({ status: 'backlog', sortOrder: 0 });
    expect(patch).not.toHaveProperty('priority');
  });

  it('out of the backlog reactivates the task', () => {
    const patch = taskMovePatch({ taskId: 'b1', task: task({ priority: 4, status: 'backlog' }), to: 'critical', index: 0, columnTasks: [] });
    expect(patch).toEqual({ status: 'pending', priority: 1, sortOrder: 0 });
  });

  it('into the completed column does nothing', () => {
    expect(taskMovePatch({ taskId: 't1', task: task(), to: 'completed', index: 0, columnTasks: [] })).toBeNull();
  });
});

describe('board drop → PATCH (ported from the deleted Priorities drag tests)', () => {
  const move = (columns: { key: string; tasks: Task[] }[], activeId: string, overId: string | null): UpdateTaskInput | null => {
    const shape = columns.map((c) => ({ key: c.key, tasks: c.tasks })) as unknown as BoardDropColumn[];
    const drop = resolveBoardDrop(shape, activeId, overId);
    if (!drop) return null;
    const all = columns.flatMap((c) => c.tasks);
    const t = all.find((x) => x.id === drop.taskId)!;
    const columnTasks = columns.find((c) => c.key === drop.to)?.tasks ?? [];
    return taskMovePatch({ taskId: drop.taskId, task: t, to: drop.to, index: drop.index, columnTasks });
  };

  const board = [
    { key: 'critical', tasks: [task({ id: 'c1', priority: 1, sortOrder: 0 })] },
    { key: 'high', tasks: [task({ id: 'a', priority: 2, sortOrder: 1 }), task({ id: 'b', priority: 2, sortOrder: 2 }), task({ id: 'c', priority: 2, sortOrder: 3 })] },
    { key: 'low', tasks: [task({ id: 'l1', priority: 4, sortOrder: 0 }), task({ id: 'lonely', priority: 4, sortOrder: 7 })] },
    { key: 'backlog', tasks: [] },
    { key: 'completed', tasks: [task({ id: 'd1', priority: 4, status: 'completed' })] },
  ];

  it('reprioritizes onto an empty area of another column', () => {
    expect(move(board, 'l1', 'col:critical')).toEqual({ priority: 1, sortOrder: 1 });
  });

  it('reorders within a column upward (midpoint, same priority)', () => {
    expect(move(board, 'c', 'a')).toEqual({ sortOrder: 0 });
  });

  it('drags the first task DOWN within a column past the last one', () => {
    // Was 2.5 under HTML5 ("always insert above the hovered row"); dnd-kit lands the card where
    // the preview showed it, i.e. after Gamma(3) => 4.
    expect(move(board, 'a', 'c')).toEqual({ sortOrder: 4 });
  });

  it('cross-column drop on the container gets a bottom sortOrder', () => {
    expect(move(board, 'a', 'col:low')).toEqual({ priority: 4, sortOrder: 8 });
  });

  it('dropping a pending task onto the backlog sets status without priority', () => {
    const patch = move(board, 'l1', 'col:backlog');
    expect(patch).toEqual({ status: 'backlog', sortOrder: 0 });
  });

  it('dropping onto the completed column produces no patch', () => {
    expect(move(board, 'l1', 'col:completed')).toBeNull();
  });
});

describe('boardKeyboardCoordinates', () => {
  const rect = (top: number, height: number): ClientRect =>
    ({ top, left: 0, height, width: 300, right: 300, bottom: top + height });

  const rects = new Map<UniqueIdentifier, ClientRect>([
    ['col:high', rect(0, 600)], // a column's rect always starts ABOVE every card it holds
    ['a', rect(100, 60)],       // first card
    ['b', rect(200, 60)],       // second card
  ]);

  /**
   * A stand-in for dnd-kit's own `DroppableContainersMap`, which the package does not export as a
   * value. Same shape (a Map subclass carrying `getEnabled`), which is exactly what makes this test
   * load-bearing: `boardKeyboardCoordinates` rebuilds the filtered collection through
   * `containers.constructor`, so if it ever rebuilt through a plain `Map` instead, the delegate's
   * `getEnabled()` call would throw here rather than quietly regress.
   */
  class Containers extends Map<UniqueIdentifier, DroppableContainer> {
    getEnabled() { return Array.from(this.values()).filter((c) => !c.disabled); }
    toArray() { return Array.from(this.values()); }
    getNodeFor(id: UniqueIdentifier) { return this.get(id)?.node.current ?? undefined; }
  }

  const container = (id: UniqueIdentifier): DroppableContainer => ({
    id, key: id, disabled: false, data: { current: undefined },
    // A real node is required: the getter reads `node.current` and walks its scroll ancestors.
    node: { current: document.createElement('div') },
    rect: { current: rects.get(id)! },
  } as unknown as DroppableContainer);

  const containers = new Containers([
    ['col:high', container('col:high')], ['a', container('a')], ['b', container('b')],
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const argsFor = (activeId: string): any => ({
    active: activeId,
    currentCoordinates: { x: 0, y: rects.get(activeId)!.top },
    context: {
      active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
      collisionRect: rects.get(activeId)!,
      droppableRects: rects,
      droppableContainers: containers,
      over: null,
      scrollableAncestors: [],
    },
  });

  const arrowUp = () => new KeyboardEvent('keydown', { code: 'ArrowUp' });

  it('ArrowUp on the FIRST card of a column does nothing, where the stock getter jumps to the column', () => {
    // The defect, reproduced: no card sits above 'a', so the only survivor of the stock getter's
    // direction filter is the column container, and it returns the column's own origin — which the
    // board reads as `over = col:high`, i.e. "append to the bottom of this column".
    expect(sortableKeyboardCoordinates(arrowUp(), argsFor('a'))).toEqual({ x: 0, y: 0 });
    // With the containers filtered out there is no candidate at all, so the card stays put.
    expect(boardKeyboardCoordinates(arrowUp(), argsFor('a'))).toBeUndefined();
  });

  it('still steps onto the card above when there is one', () => {
    // Filtering containers must not cost ordinary reordering: 'b' still walks up to 'a'.
    expect(boardKeyboardCoordinates(arrowUp(), argsFor('b'))).toEqual({ x: 0, y: 100 });
  });
});
