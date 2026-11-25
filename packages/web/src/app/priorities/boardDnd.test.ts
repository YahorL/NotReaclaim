import { describe, it, expect } from 'vitest';
import type { Task, UpdateTaskInput } from '../../api/types';
import { applyBoardDrop, boardDropTargetName, columnDroppableId, dropPosition, keyboardMove, moveAnnouncement, overColumnKey, resolveBoardDrop, taskMovePatch, type BoardArrowKey, type BoardDropColumn } from './boardDnd';

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
  completedAt: null, createdAt: '', updatedAt: '', ...over,
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

describe('boardDropTargetName', () => {
  const titleOf = (id: string) => ({ a: 'Write spec', b: 'Ship it' }[id] ?? null);

  it('names a card by its own title, never by the column that holds it', () => {
    // Load-bearing: dnd-kit's live region is useState-backed and aria-atomic, so an announcement
    // byte-identical to the previous one mutates no DOM and is never spoken. Resolving card ids
    // through `overColumnKey` gave every card in a column the same sentence, which made a
    // within-column keyboard reorder — the main keyboard flow — silent from the second step on.
    expect(boardDropTargetName(cols, 'a', titleOf)).toBe('Write spec');
    expect(boardDropTargetName(cols, 'b', titleOf)).toBe('Ship it');
  });

  it('names a container droppable by its column', () => {
    expect(boardDropTargetName(cols, 'col:high', titleOf)).toBe('the High priority column');
    expect(boardDropTargetName(cols, 'col:backlog', titleOf)).toBe('the Backlog column');
  });

  it('is null when neither lookup knows the id, so the caller can fall back to it', () => {
    expect(boardDropTargetName(cols, 'ghost', titleOf)).toBeNull();
    expect(boardDropTargetName(cols, 'col:ghost', titleOf)).toBeNull();
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

  it('is null when a card is dropped on itself — no movement, no replan', () => {
    expect(resolveBoardDrop(cols, 'b', 'b')).toBeNull();
  });

  it('is null when a card is dropped on its own column and is already last', () => {
    expect(resolveBoardDrop(cols, 'c', 'col:high')).toBeNull();
    // Still a real move for any card that is not already at the bottom.
    expect(resolveBoardDrop(cols, 'a', 'col:high')).toEqual({ taskId: 'a', to: 'high', index: 3 });
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

  it('a drop on the column area below the last card lands at the end — same patch as dropping after the last card', () => {
    // Same column: dropping on the last card (downward) inserts after it; the column area appends.
    expect(move(board, 'a', 'col:high')).toEqual(move(board, 'a', 'c'));
    expect(move(board, 'a', 'col:high')).toEqual({ sortOrder: 4 });
    // From another column: the bottom of a non-empty column, past its last card (sortOrder 7).
    expect(move(board, 'c1', 'col:low')).toEqual({ priority: 4, sortOrder: 8 });
  });

  it('dropping a pending task onto the backlog sets status without priority', () => {
    const patch = move(board, 'l1', 'col:backlog');
    expect(patch).toEqual({ status: 'backlog', sortOrder: 0 });
  });

  it('dropping onto the completed column produces no patch', () => {
    expect(move(board, 'l1', 'col:completed')).toBeNull();
  });
});

describe('keyboardMove (grip arrow keys)', () => {
  // critical: c1 · high: a, b, c · low: l1 · backlog: (empty) · completed: d1
  it('ArrowUp steps a card above its neighbour', () => {
    expect(keyboardMove(cols, 'b', 'ArrowUp')).toEqual({ taskId: 'b', to: 'high', index: 0 });
  });

  it('ArrowUp on the FIRST card of a column does nothing (never wraps to the bottom)', () => {
    expect(keyboardMove(cols, 'a', 'ArrowUp')).toBeNull();
  });

  it('ArrowDown steps a card below its neighbour, in the rendered-column index contract', () => {
    // Insert after 'b' = index 2 in [a, b, c] as rendered (the dragged card still counted).
    const drop = keyboardMove(cols, 'a', 'ArrowDown');
    expect(drop).toEqual({ taskId: 'a', to: 'high', index: 2 });
  });

  it('ArrowDown on the LAST card does nothing', () => {
    expect(keyboardMove(cols, 'c', 'ArrowDown')).toBeNull();
  });

  it('ArrowLeft moves to the neighbouring column at the same position, clamped to its length', () => {
    // 'c' is third in High; Critical holds one card, so it lands last there.
    expect(keyboardMove(cols, 'c', 'ArrowLeft')).toEqual({ taskId: 'c', to: 'critical', index: 1 });
    expect(keyboardMove(cols, 'a', 'ArrowLeft')).toEqual({ taskId: 'a', to: 'critical', index: 0 });
  });

  it('ArrowRight moves to the next RENDERED column (hidden columns are skipped by construction)', () => {
    // There is no Medium column in `cols`, so High → Low.
    expect(keyboardMove(cols, 'b', 'ArrowRight')).toEqual({ taskId: 'b', to: 'low', index: 1 });
  });

  it('reaches an EMPTY column (Low → Backlog), which a pointer-less drag could not', () => {
    expect(keyboardMove(cols, 'l1', 'ArrowRight')).toEqual({ taskId: 'l1', to: 'backlog', index: 0 });
  });

  it('stops at the edges: ArrowLeft from the first column, ArrowRight before Completed', () => {
    expect(keyboardMove(cols, 'c1', 'ArrowLeft')).toBeNull();
    // Backlog is the last droppable column: Completed rejects drops.
    const withBacklogCard: BoardDropColumn[] = cols.map((c) => (c.key === 'backlog' ? { ...c, tasks: [{ id: 'k1' }] } : c));
    expect(keyboardMove(withBacklogCard, 'k1', 'ArrowRight')).toBeNull();
  });

  it('never moves a card out of the Completed column, nor an unknown id', () => {
    expect(keyboardMove(cols, 'd1', 'ArrowLeft')).toBeNull();
    expect(keyboardMove(cols, 'ghost', 'ArrowUp')).toBeNull();
  });

  it('feeds taskMovePatch the same way a pointer drop does', () => {
    const board = [
      { key: 'critical' as const, tasks: [task({ id: 'c1', priority: 1, sortOrder: 0 })] },
      { key: 'high' as const, tasks: [task({ id: 'a', sortOrder: 0 }), task({ id: 'b', sortOrder: 10 }), task({ id: 'c', sortOrder: 20 })] },
    ];
    const patchFor = (id: string, key: BoardArrowKey) => {
      const drop = keyboardMove(board, id, key)!;
      const t = board.flatMap((c) => c.tasks).find((x) => x.id === id)!;
      return taskMovePatch({ taskId: id, task: t, to: drop.to, index: drop.index, columnTasks: board.find((c) => c.key === drop.to)!.tasks });
    };
    expect(patchFor('a', 'ArrowDown')).toEqual({ sortOrder: 15 });         // between b and c
    expect(patchFor('c', 'ArrowUp')).toEqual({ sortOrder: 5 });            // between a and b
    expect(patchFor('b', 'ArrowLeft')).toEqual({ priority: 1, sortOrder: 1 }); // after c1
  });
});

describe('dropPosition / moveAnnouncement', () => {
  it('is the 1-based slot the card ends up in, accounting for its own old slot in the same column', () => {
    // a ↓ (index 2 in [a,b,c] as rendered) ends up second.
    expect(dropPosition(cols, { taskId: 'a', to: 'high', index: 2 })).toBe(2);
    // c ↑ to index 1 ends up second; upward moves need no adjustment.
    expect(dropPosition(cols, { taskId: 'c', to: 'high', index: 1 })).toBe(2);
    // Appending a's own column via the container (index 3) ends up third, not fourth.
    expect(dropPosition(cols, { taskId: 'a', to: 'high', index: 3 })).toBe(3);
    // Cross-column: the index is already the slot.
    expect(dropPosition(cols, { taskId: 'a', to: 'critical', index: 1 })).toBe(2);
  });

  it('reads "Moved X to <column>, position N"', () => {
    expect(moveAnnouncement('Write spec', 'high', 2)).toBe('Moved Write spec to High priority, position 2.');
    expect(moveAnnouncement('Write spec', 'backlog', 1)).toBe('Moved Write spec to Backlog, position 1.');
  });
});

describe('applyBoardDrop (the arrangement held until the refetch lands)', () => {
  const ids = (columns: BoardDropColumn[], key: string) => columns.find((c) => c.key === key)!.tasks.map((t) => t.id);

  it('reorders within a column', () => {
    const next = applyBoardDrop(cols, { taskId: 'a', to: 'high', index: 2 });
    expect(ids(next, 'high')).toEqual(['b', 'a', 'c']);
  });

  it('moves across columns at the given slot and leaves the others untouched', () => {
    const next = applyBoardDrop(cols, { taskId: 'b', to: 'critical', index: 0 });
    expect(ids(next, 'critical')).toEqual(['b', 'c1']);
    expect(ids(next, 'high')).toEqual(['a', 'c']);
    expect(next.find((c) => c.key === 'low')).toBe(cols.find((c) => c.key === 'low'));
  });

  it('appends into an empty column', () => {
    expect(ids(applyBoardDrop(cols, { taskId: 'l1', to: 'backlog', index: 0 }), 'backlog')).toEqual(['l1']);
  });

  it('returns the columns unchanged for an unknown task', () => {
    expect(applyBoardDrop(cols, { taskId: 'ghost', to: 'high', index: 0 })).toBe(cols);
  });
});
