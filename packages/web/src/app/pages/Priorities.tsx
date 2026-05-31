import { useMemo, useState } from 'react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useSchedulePreviewQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { Toolbar } from '../priorities/Toolbar';
import { Board, type BoardColumn } from '../priorities/Board';
import { type BucketKey, BUCKETS, priorityToBucket, bucketToPriority, nextBlockMsForTask } from '../priorities/priorityBucket';

export function Priorities({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const previewQ = useSchedulePreviewQuery();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();

  const [query, setQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [colsVisible, setColsVisible] = useState<Record<BucketKey, boolean>>({ critical: true, high: true, medium: true, low: true });
  const [editing, setEditing] = useState<Task | null>(null);
  const nowMs = now();

  const columns: BoardColumn[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (tasksQ.data ?? []).filter((t) =>
      t.status !== 'archived'
      && (!hideCompleted || t.status !== 'completed')
      && (!q || t.title.toLowerCase().includes(q)));
    return BUCKETS.filter((b) => colsVisible[b]).map((key) => ({
      key,
      tasks: visible.filter((t) => priorityToBucket(t.priority) === key),
    }));
  }, [tasksQ.data, query, hideCompleted, colsVisible]);

  const nextMsFor = (taskId: string) => nextBlockMsForTask(taskId, previewQ.data);
  const onComplete = (t: Task) => updateM.mutate({ id: t.id, patch: { status: t.status === 'completed' ? 'pending' : 'completed' } });
  const onDelete = (t: Task) => deleteM.mutate(t.id, { onSuccess: () => { if (editing?.id === t.id) setEditing(null); } });
  const onMove = (taskId: string, to: BucketKey) => {
    const t = (tasksQ.data ?? []).find((x) => x.id === taskId);
    if (!t || priorityToBucket(t.priority) === to) return;
    updateM.mutate({ id: taskId, patch: { priority: bucketToPriority(to) } });
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
            onMove={onMove} onComplete={onComplete} onEdit={setEditing} onDelete={onDelete}
          />
        )}
      </div>
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? updateM.error : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}
