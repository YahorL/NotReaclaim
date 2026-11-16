import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, Subtask, UpdateTaskInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { DrawerPanel } from '../components/DrawerPanel';
import { FormField } from '../components/FormField';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { FIELD_CONTROL, FIELD_ERROR, FULL_ROW } from '../components/formStyles';
import { useFormState } from '../components/useFormState';
import { formatDurationShort } from '../lib/duration';
import { type TaskFormState, toFormState, validateTaskForm, toUpdateInput } from './taskForm';
import { useCategoriesQuery, useCreateSubtaskMutation, useUpdateSubtaskMutation, useDeleteSubtaskMutation } from '../../api/queries';
import { useAppSensors, pointerFirstCollision } from '../dnd/sensors';
import { subtaskDropSortOrder } from './subtaskDnd';

function SortableSubtask({ subtask, onToggle, onDelete }: {
  subtask: Subtask;
  onToggle: () => void;
  onDelete: () => void;
}) {
  // role=listitem: dnd-kit would otherwise default the row to role="button", which drops the list
  // out of its own semantics and nests the checkbox and delete control inside a button.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: subtask.id, attributes: { role: 'listitem' } });
  return (
    <li
      // Both refs: the KeyboardSensor only ignores keys coming from descendants when the row is
      // registered as its own activator node, otherwise Space/Enter on the checkbox or the delete
      // button is preventDefault'd into a drag instead of operating the control.
      ref={(n) => { setNodeRef(n); setActivatorNodeRef(n); }}
      data-testid={`subtask-li-${subtask.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`flex flex-col ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 text-[14px]">
        {/* Negative margin cancels the padding, so a 40px touch area costs no layout on desktop. */}
        <label className="flex items-center coarse:-m-2.5 coarse:p-2.5">
          <input type="checkbox" data-testid={`subtask-toggle-${subtask.id}`} checked={subtask.done} onChange={onToggle} className="h-4 w-4 accent-indigo coarse:h-5 coarse:w-5" />
        </label>
        <span className={`flex-1 ${subtask.done ? 'text-inkSoft line-through' : 'text-ink'}`}>{subtask.title}</span>
        <button type="button" data-testid={`subtask-delete-${subtask.id}`} aria-label="delete subtask" onClick={onDelete} className="text-[13px] font-bold text-crit coarse:p-3">×</button>
      </div>
    </li>
  );
}

export interface TaskDrawerProps {
  task: Task;
  onSave: (patch: UpdateTaskInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
  /** Hosted in a full-screen Sheet below md: drop the 440px panel chrome and the self-dismiss. */
  compact?: boolean;
}

export function TaskDrawer({ task, onSave, onCancel, saving = false, error = null, compact = false }: TaskDrawerProps) {
  const [form, set] = useFormState<TaskFormState>(() => toFormState(task));
  const { ok, errors } = validateTaskForm(form);
  const categoriesQ = useCategoriesQuery();
  const categories = categoriesQ.data ?? [];
  const createSubtaskM = useCreateSubtaskMutation();
  const updateSubtaskM = useUpdateSubtaskMutation();
  const deleteSubtaskM = useDeleteSubtaskMutation();
  const [newSubtask, setNewSubtask] = useState('');
  const sensors = useAppSensors();
  const subtasks = task.subtasks ?? [];
  const onSubtaskDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const sortOrder = subtaskDropSortOrder(subtasks, String(e.active.id), String(e.over.id));
    if (sortOrder !== null) updateSubtaskM.mutate({ id: String(e.active.id), patch: { sortOrder } });
  };
  const addSubtask = () =>
    createSubtaskM.mutate({ taskId: task.id, title: newSubtask.trim() }, { onSuccess: () => setNewSubtask('') });
  const spent = task.spentMs ?? 0;
  const left = Math.max(0, task.durationMs - spent);
  const pct = task.durationMs > 0 ? Math.min(100, Math.round((spent / task.durationMs) * 100)) : 0;

  return (
    <DrawerPanel
      testId="task-drawer"
      title="Edit task"
      compact={compact}
      onDismiss={onCancel}
      error={error}
      actions={(
        <>
          <PrimaryButton data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toUpdateInput(form)); }}>Save</PrimaryButton>
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        </>
      )}
    >
      <div data-testid="drawer-time" className="rounded-[10px] border border-line bg-bg px-3 py-2">
        <div className="flex items-center justify-between text-[12px] font-semibold text-inkSoft">
          <span>Time spent</span>
          <span data-testid="drawer-spent">{formatDurationShort(spent)} / {formatDurationShort(task.durationMs)} · {formatDurationShort(left)} left</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-indigo" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <FormField className={FULL_ROW} label="Title" error={errors.title} errorTestId="err-title">
          <input className={FIELD_CONTROL} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </FormField>

        {/* Row: Duration | Hours */}
        <FormField label="Duration" error={errors.durationMs} errorTestId="err-durationMs">
          <DurationStepper label="duration" size={22} valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} />
        </FormField>
        <FormField label="Hours">
          <select data-testid="category-select" className={`${FIELD_CONTROL} appearance-none`} value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
            <option value="">— none —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>

        {/* Row: Due by | Schedule after (dates together). Due by keeps its own markup: its hint
            sits between the box and the error line. */}
        <div>
          <FieldBox label="Due by">
            <input type="datetime-local" className={FIELD_CONTROL} value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} />
          </FieldBox>
          <p className="mt-1 text-[11px] text-inkSoft">Leave empty for no deadline</p>
          {errors.dueByLocal && <p data-testid="err-dueByLocal" className={FIELD_ERROR}>{errors.dueByLocal}</p>}
        </div>
        <FormField label="Schedule after">
          <input type="datetime-local" data-testid="schedule-after" className={FIELD_CONTROL} value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} />
        </FormField>

        {/* Row: Min chunk | Max chunk (chunk sizes together) */}
        <FormField label="Min chunk" error={errors.minChunkMs} errorTestId="err-minChunkMs">
          <DurationStepper label="min" size={22} valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} />
        </FormField>
        <FormField label="Max chunk" error={errors.maxChunkMs} errorTestId="err-maxChunkMs">
          <DurationStepper label="max" size={22} valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} />
        </FormField>
      </div>

      <div>
        <span className="mb-1 block text-[13px] font-semibold text-inkSoft">Subtasks</span>
        <DndContext sensors={sensors} collisionDetection={pointerFirstCollision} onDragEnd={onSubtaskDragEnd}>
          <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="mb-1.5 space-y-1.5">
              {subtasks.map((s) => (
                <SortableSubtask
                  key={s.id}
                  subtask={s}
                  onToggle={() => updateSubtaskM.mutate({ id: s.id, patch: { done: !s.done } })}
                  onDelete={() => deleteSubtaskM.mutate(s.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="flex gap-1.5">
          <input
            data-testid="subtask-input"
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            placeholder="Add subtask…"
            className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-2.5 py-1.5 text-[14px] outline-none focus:border-indigo"
          />
          <button
            type="button"
            data-testid="subtask-add"
            disabled={!newSubtask.trim() || createSubtaskM.isPending}
            onClick={addSubtask}
            className="rounded-[20px] bg-indigo px-3 text-[13px] font-bold text-white disabled:opacity-50"
          >Add</button>
        </div>
      </div>
    </DrawerPanel>
  );
}
