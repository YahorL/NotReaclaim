import { useState } from 'react';
import type { Habit, HabitStatus, UpdateHabitInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import { type HabitFormState, toFormState, validateHabitForm, toUpdateInput } from './habitForm';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const STATUSES: HabitStatus[] = ['active', 'paused'];

export interface HabitDrawerProps {
  habit: Habit;
  onSave: (patch: UpdateHabitInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
}

export function HabitDrawer({ habit, onSave, onCancel, saving = false, error = null }: HabitDrawerProps) {
  const [form, setForm] = useState<HabitFormState>(() => toFormState(habit));
  const { ok, errors } = validateHabitForm(form);
  const set = <K extends keyof HabitFormState>(k: K, v: HabitFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, eligibleDays: f.eligibleDays.includes(d) ? f.eligibleDays.filter((x) => x !== d) : [...f.eligibleDays, d] }));
  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'w-full rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'mt-0.5 text-[11px] text-red-600';

  return (
    <aside data-testid="habit-drawer" className="w-60 shrink-0 rounded-lg border-l-2 border-blue-500 bg-gray-50 p-3">
      <h4 className="mb-2 text-sm font-semibold">Edit habit</h4>

      <div className="mb-2">
        <label className={labelCls}>Title</label>
        <input className={ctlCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
        {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Chunk</label>
        <DurationField valueMs={form.chunkMs} onChange={(ms) => set('chunkMs', ms)} testid="chunk" />
        {errors.chunkMs && <p data-testid="err-chunkMs" className={errCls}>{errors.chunkMs}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Times per week</label>
        <input type="number" min={1} className={ctlCls} value={form.perPeriod} onChange={(e) => set('perPeriod', Number(e.target.value))} />
        {errors.perPeriod && <p data-testid="err-perPeriod" className={errCls}>{errors.perPeriod}</p>}
      </div>

      <div className="mb-2">
        <label className={labelCls}>Eligible days</label>
        <div className="flex gap-1">
          {DAY_LABELS.map((lbl, d) => (
            <button key={d} data-testid={`day-${d}`} onClick={() => toggleDay(d)}
              className={`w-6 rounded border py-0.5 text-[10px] ${form.eligibleDays.includes(d) ? 'border-green-300 bg-green-100 font-semibold text-green-800' : 'border-gray-300 text-gray-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
        {errors.eligibleDays && <p data-testid="err-eligibleDays" className={errCls}>{errors.eligibleDays}</p>}
      </div>

      <div className="mb-2 flex gap-2">
        <div className="flex-1">
          <label className={labelCls}>Preferred from</label>
          <input type="time" className={ctlCls} value={form.preferredStart} onChange={(e) => set('preferredStart', e.target.value)} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>to</label>
          <input type="time" className={ctlCls} value={form.preferredEnd} onChange={(e) => set('preferredEnd', e.target.value)} />
        </div>
      </div>
      {errors.preferredEnd && <p data-testid="err-preferredEnd" className={errCls}>{errors.preferredEnd}</p>}

      <div className="mb-2 flex gap-2">
        <div className="flex-1">
          <label className={labelCls}>Priority</label>
          <input type="number" className={ctlCls} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
        </div>
        <div className="flex-1">
          <label className={labelCls}>Status</label>
          <select className={ctlCls} value={form.status} onChange={(e) => set('status', e.target.value as HabitStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
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
