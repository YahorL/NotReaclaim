import { useState, useEffect, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useSettingsQuery, useCategoriesQuery, useCreateCategoryMutation } from '../../api/queries';
import { msToHM } from '../lib/duration';
import { Icons } from './icons';
import {
  type NewTaskFormState, defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput,
} from './newTaskForm';

function durationLabel(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${minutes} mins`;
}
const STEP = 15 * 60_000;
const FALLBACK_WORKING_HOURS = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];

function Stepper({ valueMs, onChange, disabled = false, label }: { valueMs: number; onChange: (ms: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[18px] font-bold">{durationLabel(valueMs)}</span>
      <div className="flex gap-2 text-indigo">
        <button type="button" aria-label={`decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(STEP, valueMs - STEP))} className="disabled:opacity-40"><Icons.minusCircle size={26} /></button>
        <button type="button" aria-label={`increase ${label}`} disabled={disabled} onClick={() => onChange(valueMs + STEP)} className="disabled:opacity-40"><Icons.plusCircle size={26} /></button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
      <span className="text-[13px] font-semibold text-inkSoft">{label}</span>
      {children}
    </div>
  );
}

export function NewTaskModal({ onClose, now = () => Date.now() }: { onClose: () => void; now?: () => number }) {
  const settingsQ = useSettingsQuery();
  const createM = useCreateTaskMutation();
  const chunkDefaults = settingsQ.data
    ? { defaultMinChunkMs: settingsQ.data.defaultMinChunkMs, defaultMaxChunkMs: settingsQ.data.defaultMaxChunkMs }
    : undefined;
  const [form, setForm] = useState<NewTaskFormState>(() => defaultNewTaskForm(now(), chunkDefaults));
  const set = <K extends keyof NewTaskFormState>(k: K, v: NewTaskFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const categoriesQ = useCategoriesQuery();
  const createCategoryM = useCreateCategoryMutation();
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const categories = categoriesQ.data ?? [];

  useEffect(() => {
    if (form.categoryId === null && categories.length > 0) {
      const def = categories.find((c) => c.isDefault) ?? categories[0]!;
      set('categoryId', def.id);
    }
  }, [categories, form.categoryId]);

  const { ok } = validateNewTaskForm(form);
  const error = createM.error instanceof ApiError ? createM.error : null;

  const submit = () => {
    if (!ok) return;
    createM.mutate(toCreateTaskInput(form), { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-[rgba(24,26,42,.35)] pt-[70px]" onClick={onClose}>
      <div className="w-[500px] animate-pop rounded-[18px] bg-card px-[22px] pb-[22px] pt-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-inkSoft"><Icons.close size={22} /></button>
        </div>

        <div className="mb-[18px] mt-0.5 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2.5 rounded-[11px] border-2 border-indigo px-3.5 py-3 ring-[3px] ring-indigoSoft">
            <Icons.emoji size={22} className="text-indigo" />
            <input autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Task name…" className="flex-1 text-[18px] font-semibold text-ink outline-none" />
          </div>
        </div>

        <div className="mb-3.5 flex items-center gap-4">
          <div className="basis-[250px]">
            <Field label="Duration"><Stepper label="duration" valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} /></Field>
          </div>
          <button type="button" onClick={() => set('split', !form.split)} className="flex items-center gap-2.5">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md ${form.split ? 'bg-indigo text-white' : 'border-2 border-[#c7cad6]'}`}>{form.split && <Icons.check size={17} />}</span>
            <span className="text-[18px] font-bold text-ink">Split up</span>
          </button>
        </div>

        <div className="mb-3.5 flex gap-4">
          <Field label="Min duration"><Stepper label="min" disabled={!form.split} valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} /></Field>
          <Field label="Max duration"><Stepper label="max" disabled={!form.split} valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} /></Field>
        </div>

        <div className="mb-2 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-inkSoft">Hours</span>
          <div className="flex items-center gap-2">
            <Icons.info size={19} className="text-indigo" />
            <select
              data-testid="category-select"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value || null)}
              className="flex-1 bg-transparent text-[18px] font-bold text-ink outline-none"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" aria-label="Add new category" data-testid="new-category-btn" onClick={() => setCreatingCat(true)} className="text-[13px] font-bold text-indigo">+ New</button>
          </div>
          {creatingCat && (
            <div className="mt-2 flex items-center gap-2">
              <input data-testid="new-category-name" autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Category name…" className="flex-1 rounded border border-line px-2 py-1 text-[14px] outline-none" />
              <button
                type="button"
                data-testid="new-category-confirm"
                disabled={!newCatName.trim() || createCategoryM.isPending}
                onClick={() => {
                  const windows = settingsQ.data?.workingHours ?? FALLBACK_WORKING_HOURS;
                  createCategoryM.mutate({ name: newCatName.trim(), windows }, {
                    onSuccess: (cat) => { set('categoryId', cat.id); setCreatingCat(false); setNewCatName(''); },
                  });
                }}
                className="rounded bg-indigo px-2.5 py-1 text-[13px] font-bold text-white disabled:opacity-50"
              >Add</button>
            </div>
          )}
        </div>

        <div className="mb-4 flex gap-4">
          <Field label="Schedule after">
            <input type="datetime-local" data-testid="schedule-after" value={form.notBeforeLocal} onChange={(e) => set('notBeforeLocal', e.target.value)} className="text-[16px] font-bold text-ink outline-none" />
          </Field>
          <Field label="Due date">
            <input type="datetime-local" value={form.dueByLocal} onChange={(e) => set('dueByLocal', e.target.value)} className="text-[16px] font-bold text-ink outline-none" />
          </Field>
        </div>

        {error && <p data-testid="modal-error" className="mb-2 text-[12px] text-crit">{error.message}</p>}

        <div className="flex items-center justify-end">
          <button type="button" disabled={!ok || createM.isPending} onClick={submit} className="rounded-[30px] bg-indigo px-[34px] py-3 text-[17px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
