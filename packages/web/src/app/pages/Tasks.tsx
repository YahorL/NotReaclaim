import { useMemo, useState } from 'react';
import type { Task, TaskStatus } from '../../api/types';
import { ApiError } from '../../api/client';
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { QuickAdd } from '../components/QuickAdd';
import { TaskRow } from '../tasks/TaskRow';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { defaultQuickAddInput } from '../tasks/taskForm';

type Tab = 'active' | 'completed' | 'archived' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];
function matchesTab(status: TaskStatus, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'active') return status === 'pending' || status === 'scheduled';
  return status === tab;
}

export function Tasks({ now = () => Date.now() }: { now?: () => number }) {
  const tasksQ = useTasksQuery();
  const createM = useCreateTaskMutation();
  const updateM = useUpdateTaskMutation();
  const deleteM = useDeleteTaskMutation();
  const [tab, setTab] = useState<Tab>('active');
  const [editing, setEditing] = useState<Task | null>(null);

  const visible = useMemo(
    () => (tasksQ.data ?? []).filter((t) => matchesTab(t.status, tab)),
    [tasksQ.data, tab],
  );

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        <h2 className="mb-3 text-lg font-semibold">Tasks</h2>
        <QuickAdd placeholder="+ Add a task…" onAdd={(title) => createM.mutate(defaultQuickAddInput(title, now()))} />
        <div className="mb-2 flex gap-1 text-xs">
          {TABS.map((t) => (
            <button key={t.key} data-testid={`tab-${t.key}`} onClick={() => setTab(t.key)}
              className={`rounded-full border px-2 py-0.5 ${tab === t.key ? 'border-blue-200 bg-blue-100 font-medium text-blue-700' : 'border-gray-200 text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {tasksQ.isLoading && <div className="text-sm text-gray-500">Loading tasks…</div>}
        {tasksQ.isError && (
          <div className="text-sm">
            <span className="text-red-600">Couldn't load tasks.</span>{' '}
            <button onClick={() => void tasksQ.refetch()} className="rounded border border-gray-300 px-2">Retry</button>
          </div>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && visible.length === 0 && (
          <p className="text-sm text-gray-500">No tasks here — add one above.</p>
        )}
        <div>
          {visible.map((t) => (
            <TaskRow key={t.id} task={t}
              onEdit={setEditing}
              onComplete={(task) => updateM.mutate({ id: task.id, patch: { status: 'completed' } })}
              onDelete={(task) => deleteM.mutate(task.id)} />
          ))}
        </div>
      </div>
      {editing && (
        <TaskDrawer task={editing} saving={updateM.isPending}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
          onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
