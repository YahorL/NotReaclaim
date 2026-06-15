import { useRef, useState } from 'react';
import type { Task, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { formatDurationShort } from '../lib/duration';
import { useClickOutside } from '../components/useClickOutside';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';
import { insertionSortOrder } from '../priorities/priorityBucket';

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
  const rootRef = useRef<HTMLElement>(null);
  useClickOutside(rootRef, onCancel);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const subtasks = task.subtasks ?? [];
  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const ctl = 'w-full bg-transparent text-[16px] font-bold text-ink outline-none';
  const errCls = 'mt-0.5 text-[11px] text-crit';

  return (
    <aside ref={rootRef} data-testid="task-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto">
      <h4 className="text-[15px] font-bold text-ink">Edit task</h4>

      {(() => {
        const spent = task.spentMs ?? 0;
        const left = Math.max(0, task.durationMs - spent);
        const pct = task.durationMs > 0 ? Math.min(100, Math.round((spent / task.durationMs) * 100)) : 0;
        return (
          <div data-testid="drawer-time" className="rounded-[10px] border border-line bg-bg px-3 py-2">
            <div className="flex items-center justify-between text-[12px] font-semibold text-inkSoft">
              <span>Time spent</span>
              <span data-testid="drawer-spent">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)} · {formatDurationShort(left)} left</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-2.5">
        {/* Title — spans both columns */}
        <div className="col-span-2">
          <FieldBox label="Title">
            <input className={ctl} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </FieldBox>
          {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
        </div>

        {/* Row: Duration | Hours */}
        <div>
          <FieldBox label="Duration">
            <DurationStepper label="duration" size={22} valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} />
          </FieldBox>
          {errors.durationMs && <p data-testid="err-durationMs" className={errCls}>{errors.durationMs}</p>}
        </div>
        <div>
          <FieldBox label="Hours">
            <select data-testid="category-select" className={`${ctl} appearance-none`} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
              <option value="">— none —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FieldBox>
        </div>

        {/* Row: Due by | Schedule after (dates together) */}
        <div>
          <FieldBox label="Due by">
            <input type="datetime-local" className={ctl} value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} />
          </FieldBox>
          {errors.dueByLocal && <p data-testid="err-dueByLocal" className={errCls}>{errors.dueByLocal}</p>}
        </div>
        <div>
          <FieldBox label="Schedule after">
            <input type="datetime-local" data-testid="schedule-after" className={ctl} value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} />
          </FieldBox>
        </div>

        {/* Row: Min chunk | Max chunk (chunk sizes together) */}
        <div>
          <FieldBox label="Min chunk">
            <DurationStepper label="min" size={22} valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} />
          </FieldBox>
          {errors.minChunkMs && <p data-testid="err-minChunkMs" className={errCls}>{errors.minChunkMs}</p>}
        </div>
        <div>
          <FieldBox label="Max chunk">
            <DurationStepper label="max" size={22} valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} />
          </FieldBox>
          {errors.maxChunkMs && <p data-testid="err-maxChunkMs" className={errCls}>{errors.maxChunkMs}</p>}
        </div>

      </div>

      <div>
        <span className="mb-1 block text-[13px] font-semibold text-inkSoft">Subtasks</span>
        <ul className="mb-1.5 space-y-1.5">
          {subtasks.map((s, i) => (
            <li
              key={s.id}
              data-testid={`subtask-li-${s.id}`}
              draggable
              onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', s.id); setDragId(s.id); }}
              onDragEnd={() => { setDragId(null); setOverIndex(null); }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                const idx = r.height > 0 && e.clientY >= r.top + r.height / 2 ? i + 1 : i;
                setOverIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId === null || overIndex === null) return;
                const srcIndex = subtasks.findIndex((x) => x.id === dragId);
                let insertIdx = overIndex;
                if (srcIndex !== -1 && srcIndex < insertIdx) insertIdx -= 1;
                const others = subtasks.filter((x) => x.id !== dragId);
                const sortOrder = insertionSortOrder(others, insertIdx);
                updateSubtaskM.mutate({ id: dragId, patch: { sortOrder } });
                setDragId(null);
                setOverIndex(null);
              }}
              className="flex flex-col"
            >
              {overIndex === i && dragId !== null && dragId !== s.id && (
                <div data-testid="subtask-insert-line" className="h-0.5 bg-indigo mb-1" />
              )}
              <div className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" data-testid={`subtask-toggle-${s.id}`} checked={s.done} onChange={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })} className="h-4 w-4 accent-indigo" />
                <span className={`flex-1 ${s.done ? 'text-inkSoft line-through' : 'text-ink'}`}>{s.title}</span>
                <button type="button" data-testid={`subtask-delete-${s.id}`} aria-label="delete subtask" onClick={() => deleteSubtaskM.mutate(s.id)} className="text-[13px] font-bold text-crit">×</button>
              </div>
            </li>
          ))}
          {overIndex === subtasks.length && dragId !== null && (
            <li><div data-testid="subtask-insert-line" className="h-0.5 bg-indigo" /></li>
          )}
        </ul>
        <div className="flex gap-1.5">
          <input data-testid="subtask-input" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask…" className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5 text-[14px] outline-none focus:border-indigo" />
          <button type="button" data-testid="subtask-add" disabled={!newSubtask.trim() || createSubtaskM.isPending}
            onClick={() => createSubtaskM.mutate({ taskId: task.id, title: newSubtask.trim() }, { onSuccess: () => setNewSubtask('') })}
            className="rounded-[20px] bg-indigo px-3 text-[13px] font-bold text-white disabled:opacity-50">Add</button>
        </div>
      </div>

      {error && <p data-testid="drawer-error" className={errCls}>{error.message}</p>}

      <div className="flex gap-2 pt-1">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}
          className="rounded-[30px] bg-indigo px-5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-[30px] border border-line px-5 py-2 text-[14px] font-bold text-inkSoft hover:bg-bg">Cancel</button>
      </div>
    </aside>
  );
}
