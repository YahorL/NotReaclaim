import { useState } from 'react';
import type { Task, TaskStatus, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';

const STATUSES: TaskStatus[] = ['pending', 'scheduled', 'completed', 'archived'];

export interface TaskDrawerProps {
  task: Task;
  onSave: (patch: UpdateTaskInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
}

export function TaskDrawer({ task, onSave, onCancel, saving = false, error = null }: TaskDrawerProps) {
  const [form, setForm] = useState<TaskFormState>(() => toFormState(task));
  const { ok, errors } = validateTaskForm(form);
  const categoriesQ = useCategoriesQuery();
  const categories = categoriesQ.data ?? [];
  const createSubtaskM = useCreateSubtaskMutation();
  const updateSubtaskM = useUpdateSubtaskMutation();
  const deleteSubtaskM = useDeleteSubtaskMutation();
  const [newSubtask, setNewSubtask] = useState('');
  const subtasks = task.subtasks ?? [];
  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'w-full rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'mt-0.5 text-[11px] text-red-600';

  return (
    <aside data-testid="task-drawer" className="w-60 shrink-0 rounded-lg border-l-2 border-blue-500 bg-gray-50 p-3">
      <h4 className="mb-2 text-sm font-semibold">Edit task</h4>

      <div className="mb-2">
        <label className={labelCls}>Title</label>
        <input className={ctlCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
        {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Duration</label>
        <DurationField valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} testid="duration" />
        {errors.durationMs && <p data-testid="err-durationMs" className={errCls}>{errors.durationMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Priority (lower = scheduled first)</label>
        <input type="number" className={ctlCls} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
      </div>

      <div className="mb-2">
        <label className={labelCls}>Due by</label>
        <input type="datetime-local" className={ctlCls} value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} />
        {errors.dueByLocal && <p data-testid="err-dueByLocal" className={errCls}>{errors.dueByLocal}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Schedule after</label>
        <input type="datetime-local" data-testid="schedule-after" className={ctlCls} value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} />
      </div>

      <div className="mb-2">
        <label className={labelCls}>Min chunk</label>
        <DurationField valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} testid="minchunk" />
        {errors.minChunkMs && <p data-testid="err-minChunkMs" className={errCls}>{errors.minChunkMs}</p>}
      </div>
      <div className="mb-2">
        <label className={labelCls}>Max chunk</label>
        <DurationField valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} testid="maxchunk" />
        {errors.maxChunkMs && <p data-testid="err-maxChunkMs" className={errCls}>{errors.maxChunkMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Category</label>
        <select data-testid="category-select" className={ctlCls} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
          <option value="">— none —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="mb-2">
        <label className={labelCls}>Subtasks</label>
        <ul className="mb-1 space-y-1">
          {subtasks.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" data-testid={`subtask-toggle-${s.id}`} checked={s.done} onChange={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })} />
              <span className={`flex-1 ${s.done ? 'text-gray-400 line-through' : ''}`}>{s.title}</span>
              <button type="button" data-testid={`subtask-delete-${s.id}`} aria-label="delete subtask" onClick={() => deleteSubtaskM.mutate(s.id)} className="text-[12px] text-red-600">×</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <input data-testid="subtask-input" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask…" className={`${ctlCls} flex-1`} />
          <button type="button" data-testid="subtask-add" disabled={!newSubtask.trim() || createSubtaskM.isPending}
            onClick={() => createSubtaskM.mutate({ taskId: task.id, title: newSubtask.trim() }, { onSuccess: () => setNewSubtask('') })}
            className="rounded bg-blue-600 px-2 text-[12px] text-white disabled:opacity-50">Add</button>
        </div>
      </div>

      <div className="mb-2">
        <label className={labelCls}>Status</label>
        <select className={ctlCls} value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <p data-testid="drawer-error" className={errCls}>{error.message}</p>}

      <div className="mt-2 flex gap-2">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-3 py-1 text-sm">Cancel</button>
      </div>
    </aside>
  );
}
