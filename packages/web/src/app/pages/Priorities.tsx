import { useMemo, useState } from 'react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useSchedulePreviewQuery, useUpdateTaskMutation, useMoveTaskMutation, useDeleteTaskMutation, useUpdateSubtaskMutation } from '../../api/queries';
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
  const moveM = useMoveTaskMutation();
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
    // Optimistic, so a second arrow press computes from the moved state and focus can follow the
    // card; serialized and rolled back at the mutation level (see useMoveTaskMutation). Board
    // already paints the move synchronously (its held arrangement).
    moveM.mutate({ id: taskId, patch });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        query={query} setQuery={setQuery}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        colsVisible={colsVisible} setColsVisible={setColsVisible}
      />
      <div className={boardPaneClass(dragging)}>
        {tasksQ.isLoading && <p role="status" className="px-1 py-2 text-[14px] text-fg-2">Loading tasks…</p>}
        {tasksQ.isError && (
          <div role="alert" className="glass flex flex-wrap items-center gap-3 rounded-panel px-4 py-3 text-[14px]">
            <span className="text-danger">Couldn't load tasks.</span>
            <button type="button" onClick={() => void tasksQ.refetch()} className="btn-glass h-9 rounded-pill px-4 text-[13px] font-medium">Retry</button>
          </div>
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
