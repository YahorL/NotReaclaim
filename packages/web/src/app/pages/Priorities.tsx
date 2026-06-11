import { useMemo, useState } from 'react';
import type { Task, UpdateTaskInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useSchedulePreviewQuery, useUpdateTaskMutation, useDeleteTaskMutation, useUpdateSubtaskMutation } from '../../api/queries';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { Toolbar } from '../priorities/Toolbar';
import { Board, type BoardColumn } from '../priorities/Board';
import { type BucketKey, type BoardColumnKey, BUCKETS, priorityToBucket, bucketToPriority, nextBlockMsForTask, sortBucket, sortCompleted, insertionSortOrder } from '../priorities/priorityBucket';

export function Priorities({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const previewQ = useSchedulePreviewQuery();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();
  const subtaskM = useUpdateSubtaskMutation();
  const onToggleSubtask = (subtaskId: string, done: boolean) => subtaskM.mutate({ id: subtaskId, patch: { done } });
  const onReorderSubtask = (subtaskId: string, sortOrder: number) => subtaskM.mutate({ id: subtaskId, patch: { sortOrder } });

  const [query, setQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [colsVisible, setColsVisible] = useState<Record<BoardColumnKey, boolean>>({
    critical: true, high: true, medium: true, low: true, backlog: true, completed: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const nowMs = now();

  const editing = (tasksQ.data ?? []).find((t) => t.id === editingId) ?? null;

  const columns: BoardColumn[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (tasksQ.data ?? []).filter((t) =>
      t.status !== 'archived'
      && (!q || t.title.toLowerCase().includes(q)));

    const bucketCols: BoardColumn[] = BUCKETS
      .filter((b) => colsVisible[b])
      .map((key) => ({
        key,
        tasks: sortBucket(visible.filter((t) => (t.status === 'pending' || t.status === 'scheduled') && priorityToBucket(t.priority) === key)),
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
    const all = tasksQ.data ?? [];
    const t = all.find((x) => x.id === taskId);
    if (!t) return;

    if (to === 'completed') return; // completed column rejects drops

    const column = columns.find((c) => c.key === to);
    const colTasks = column?.tasks ?? [];
    const sourceIndex = colTasks.findIndex((x) => x.id === taskId);
    const adjustedIndex = sourceIndex !== -1 && sourceIndex < index ? index - 1 : index;
    const neighbors = colTasks.filter((x) => x.id !== taskId);
    const sortOrder = insertionSortOrder(neighbors, adjustedIndex);

    if (to === 'backlog') {
      updateM.mutate({ id: taskId, patch: { status: 'backlog', sortOrder } });
    } else {
      // Dropping on a bucket column
      const targetBucket = to as BucketKey;
      const patch: UpdateTaskInput = { sortOrder };
      if (priorityToBucket(t.priority) !== targetBucket) patch.priority = bucketToPriority(targetBucket);
      // If task was backlog or completed, reactivate it
      if (t.status === 'backlog' || t.status === 'completed') patch.status = 'pending';
      updateM.mutate({ id: taskId, patch });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        query={query} setQuery={setQuery}
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        colsVisible={colsVisible} setColsVisible={setColsVisible}
      />
      <div className="min-h-0 flex-1 overflow-auto px-[30px] pb-10">
        {tasksQ.isLoading && <p className="text-sm text-inkSoft">Loading tasks…</p>}
        {tasksQ.isError && (
          <p className="text-sm">
            <span className="text-crit">Couldn't load tasks.</span>{' '}
            <button type="button" onClick={() => void tasksQ.refetch()} className="rounded border border-line px-2">Retry</button>
          </p>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && (
          <Board
            columns={columns} now={nowMs} nextMsFor={nextMsFor}
            onMove={onMove} onComplete={onComplete} onEdit={(t) => setEditingId(t.id)} onDelete={onDelete}
            onToggleSubtask={onToggleSubtask} onReorderSubtask={onReorderSubtask}
          />
        )}
      </div>
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  );
}
