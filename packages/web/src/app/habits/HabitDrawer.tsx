import { useRef, useState } from 'react';
import type { Habit, HabitStatus, UpdateHabitInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { useClickOutside } from '../components/useClickOutside';
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
  const rootRef = useRef<HTMLElement>(null);
  useClickOutside(rootRef, onCancel);
  const { ok, errors } = validateHabitForm(form);
  const set = <K extends keyof HabitFormState>(k: K, v: HabitFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, eligibleDays: f.eligibleDays.includes(d) ? f.eligibleDays.filter((x) => x !== d) : [...f.eligibleDays, d] }));
  const ctl = 'w-full bg-transparent text-[16px] font-bold text-ink outline-none';
  const errCls = 'mt-0.5 text-[11px] text-crit';

  return (
    <aside ref={rootRef} data-testid="habit-drawer" className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto">
      <h4 className="text-[15px] font-bold text-ink">Edit habit</h4>

      <div className="grid grid-cols-2 gap-2.5">
        {/* Title — spans both columns */}
        <div className="col-span-2">
          <FieldBox label="Title">
            <input className={ctl} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </FieldBox>
          {errors.title && <p data-testid="err-title" className={errCls}>{errors.title}</p>}
        </div>

        {/* Row: Chunk duration | Times per period */}
        <div>
          <FieldBox label="Chunk">
            <DurationStepper label="chunk" size={22} valueMs={form.chunkMs} onChange={(ms) => set('chunkMs', ms)} />
          </FieldBox>
          {errors.chunkMs && <p data-testid="err-chunkMs" className={errCls}>{errors.chunkMs}</p>}
        </div>
        <div>
          <FieldBox label="Times per week">
            <input type="number" min={1} className={`${ctl} appearance-none`} value={form.perPeriod} onChange={(e) => set('perPeriod', Number(e.target.value))} />
          </FieldBox>
          {errors.perPeriod && <p data-testid="err-perPeriod" className={errCls}>{errors.perPeriod}</p>}
        </div>

        {/* Row: Priority | Status */}
        <div>
          <FieldBox label="Priority">
            <input type="number" className={`${ctl} appearance-none`} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
          </FieldBox>
        </div>
        <div>
          <FieldBox label="Status">
            <select className={`${ctl} appearance-none capitalize`} value={form.status} onChange={(e) => set('status', e.target.value as HabitStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FieldBox>
        </div>

        {/* Row: Preferred from | to */}
        <div>
          <FieldBox label="Preferred from">
            <input type="time" className={ctl} value={form.preferredStart} onChange={(e) => set('preferredStart', e.target.value)} />
          </FieldBox>
        </div>
        <div>
          <FieldBox label="to">
            <input type="time" className={ctl} value={form.preferredEnd} onChange={(e) => set('preferredEnd', e.target.value)} />
          </FieldBox>
        </div>
        {errors.preferredEnd && <p data-testid="err-preferredEnd" className={`col-span-2 ${errCls}`}>{errors.preferredEnd}</p>}

        {/* Eligible days — spans both columns */}
        <div className="col-span-2">
          <FieldBox label="Eligible days">
            <div className="flex gap-1.5 pt-0.5">
              {DAY_LABELS.map((lbl, d) => (
                <button key={d} type="button" data-testid={`day-${d}`} onClick={() => toggleDay(d)}
                  className={`h-7 w-7 rounded-full text-[11px] font-bold transition-colors ${form.eligibleDays.includes(d) ? 'bg-indigo text-white' : 'bg-bg text-inkSoft border border-line'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </FieldBox>
          {errors.eligibleDays && <p data-testid="err-eligibleDays" className={errCls}>{errors.eligibleDays}</p>}
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
