import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { queryKeys, useTasksQuery, useSchedulePreviewQuery, useUpdateTaskMutation, useDeleteTaskMutation, useUpdateSubtaskMutation } from '../../api/queries';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { useTimezone } from '../settings/useTimezone';
import { DrawerHost, DESKTOP_DRAWER_SLOT } from '../components/DrawerHost';
import { useCompactWidth } from '../lib/useMediaQuery';
import { Toolbar } from '../priorities/Toolbar';
import { Board, type BoardColumn } from '../priorities/Board';
import { type BoardColumnKey, BUCKETS, isActiveTask, priorityToBucket, nextBlockMsForTask, sortBucket, sortCompleted } from '../priorities/priorityBucket';
import { taskMovePatch } from '../priorities/boardDnd';
import { boardPaneClass } from '../priorities/boardPane';

export function Priorities({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const previewQ = useSchedulePreviewQuery();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();
  const subtaskM = useUpdateSubtaskMutation();
  const qc = useQueryClient();
  const compact = useCompactWidth();
  const zone = useTimezone();
  const onToggleSubtask = (subtaskId: string, done: boolean) => subtaskM.mutate({ id: subtaskId, patch: { done } });
  const onReorderSubtask = (subtaskId: string, sortOrder: number) => subtaskM.mutate({ id: subtaskId, patch: { sortOrder } });

  const [query, setQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [colsVisible, setColsVisible] = useState<Record<BoardColumnKey, boolean>>({
    critical: true, high: true, medium: true, low: true, backlog: true, completed: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Snapping fights dnd-kit's edge auto-scroll, so the pane un-snaps while a card is in the air.
  const [dragging, setDragging] = useState(false);
  const nowMs = now();

  const tasksById = useMemo(() => new Map((tasksQ.data ?? []).map((t) => [t.id, t])), [tasksQ.data]);
  const editing = editingId !== null ? tasksById.get(editingId) ?? null : null;

  const columns: BoardColumn[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (tasksQ.data ?? []).filter((t) =>
      t.status !== 'archived'
      && (!q || t.title.toLowerCase().includes(q)));

    const bucketCols: BoardColumn[] = BUCKETS
      .filter((b) => colsVisible[b])
      .map((key) => ({
        key,
        tasks: sortBucket(visible.filter((t) => isActiveTask(t) && priorityToBucket(t.priority) === key)),
      }));

    const extraCols: BoardColumn[] = [];

    if (colsVisible.backlog) {
      extraCols.push({
        key: 'backlog',
        tasks: sortBucket(visible.filter((t) => t.status === 'backlog')),
      });
    }

    if (!hideCompleted && colsVisible.completed) {
      extraCols.push({
        key: 'completed',
        tasks: sortCompleted(visible.filter((t) => t.status === 'completed')),
      });
    }

    return [...bucketCols, ...extraCols];
  }, [tasksQ.data, query, hideCompleted, colsVisible]);

  const nextMsFor = (taskId: string) => nextBlockMsForTask(taskId, previewQ.data);
  const onComplete = (t: Task) => updateM.mutate({ id: t.id, patch: { status: t.status === 'completed' ? 'pending' : 'completed' } });
  const onDelete = (t: Task) => deleteM.mutate(t.id, { onSuccess: () => { if (editingId === t.id) setEditingId(null); } });

  const onMove = (taskId: string, to: BoardColumnKey, index: number) => {
    const t = tasksById.get(taskId);
    if (!t) return;
    const patch = taskMovePatch({
      taskId, task: t, to, index,
      columnTasks: columns.find((c) => c.key === to)?.tasks ?? [],
    });
    if (!patch) return;
    // Optimistic: the board shows the move at once (Board holds it for the render in between), so a
    // second arrow press computes from the moved state and focus can follow the card. Synchronous —
    // nothing may be awaited before this write. Rolled back if the PATCH fails; the success path's
    // invalidation refetches the server's order.
    const snapshots = qc.getQueriesData<unknown>({ queryKey: queryKeys.tasksRoot });
    qc.setQueriesData<unknown>({ queryKey: queryKeys.tasksRoot }, (old: unknown) => (Array.isArray(old)
      ? (old as Task[]).map((x) => (x.id === taskId ? { ...x, ...patch } as Task : x))
      : old));
    updateM.mutate({ id: taskId, patch }, {
      onError: () => { for (const [key, data] of snapshots) qc.setQueryData(key, data); },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        query={query} setQuery={setQuery}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        colsVisible={colsVisible} setColsVisible={setColsVisible}
      />
      <div className={boardPaneClass(dragging)}>
        {tasksQ.isLoading && <p className="text-sm text-inkSoft">Loading tasks…</p>}
        {tasksQ.isError && (
          <p className="text-sm">
            <span className="text-crit">Couldn't load tasks.</span>{' '}
            <button type="button" onClick={() => void tasksQ.refetch()} className="rounded border border-line px-2">Retry</button>
          </p>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && (
          <Board
            columns={columns} now={nowMs} zone={zone} nextMsFor={nextMsFor}
            onMove={onMove} onComplete={onComplete} onEdit={(t) => setEditingId(t.id)} onDelete={onDelete}
            onToggleSubtask={onToggleSubtask} onReorderSubtask={onReorderSubtask}
            onDragActiveChange={setDragging}
            filtered={query.trim() !== ''}
          />
        )}
      </div>
      {editing && (
        <DrawerHost compact={compact} label="Edit task" onClose={() => setEditingId(null)} desktopClass={`${DESKTOP_DRAWER_SLOT} z-50`}>
          {/* Keyed by id: the drawer seeds its form once at mount — see Planner. */}
          <TaskDrawer
            key={editing.id}
            task={editing} zone={zone} compact={compact} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </DrawerHost>
      )}
    </div>
  );
}
