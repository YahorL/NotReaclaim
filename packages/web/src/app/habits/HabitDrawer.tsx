import type { Habit, HabitStatus, UpdateHabitInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationStepper } from '../components/DurationStepper';
import { DrawerPanel } from '../components/DrawerPanel';
import { FormField } from '../components/FormField';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { FIELD_CONTROL, FIELD_ERROR, FULL_ROW } from '../components/formStyles';
import { useFormState } from '../components/useFormState';
import { type HabitFormState, toFormState, validateHabitForm, toUpdateInput } from './habitForm';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const STATUSES: HabitStatus[] = ['active', 'paused'];
const DAY_BTN = 'h-7 w-7 rounded-full text-[11px] font-bold transition-colors coarse:h-10 coarse:w-10';
const DAY_ON = 'bg-indigo text-white';
const DAY_OFF = 'bg-bg text-inkSoft border border-line';

export interface HabitDrawerProps {
  habit: Habit;
  onSave: (patch: UpdateHabitInput) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: ApiError | null;
  /** Hosted in a full-screen Sheet below md: drop the 440px panel chrome and the self-dismiss. */
  compact?: boolean;
}

export function HabitDrawer({ habit, onSave, onCancel, saving = false, error = null, compact = false }: HabitDrawerProps) {
  const [form, set, setForm] = useFormState<HabitFormState>(() => toFormState(habit));
  const { ok, errors } = validateHabitForm(form);
  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, eligibleDays: f.eligibleDays.includes(d) ? f.eligibleDays.filter((x) => x !== d) : [...f.eligibleDays, d] }));

  return (
    <DrawerPanel
      testId="habit-drawer"
      title="Edit habit"
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
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <FormField className={FULL_ROW} label="Title" error={errors.title} errorTestId="err-title">
          <input className={FIELD_CONTROL} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </FormField>

        {/* Row: Chunk duration | Times per period */}
        <FormField label="Chunk" error={errors.chunkMs} errorTestId="err-chunkMs">
          <DurationStepper label="chunk" size={22} valueMs={form.chunkMs} onChange={(ms) => set('chunkMs', ms)} />
        </FormField>
        <FormField label="Times per week" error={errors.perPeriod} errorTestId="err-perPeriod">
          <input type="number" min={1} className={`${FIELD_CONTROL} appearance-none`} value={form.perPeriod} onChange={(e) => set('perPeriod', Number(e.target.value))} />
        </FormField>

        {/* Row: Priority | Status */}
        <FormField label="Priority">
          <input type="number" className={`${FIELD_CONTROL} appearance-none`} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
        </FormField>
        <FormField label="Status">
          <select className={`${FIELD_CONTROL} appearance-none capitalize`} value={form.status} onChange={(e) => set('status', e.target.value as HabitStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>

        {/* Row: Preferred from | to */}
        <FormField label="Preferred from">
          <input type="time" className={FIELD_CONTROL} value={form.preferredStart} onChange={(e) => set('preferredStart', e.target.value)} />
        </FormField>
        <FormField label="to">
          <input type="time" className={FIELD_CONTROL} value={form.preferredEnd} onChange={(e) => set('preferredEnd', e.target.value)} />
        </FormField>
        {errors.preferredEnd && <p data-testid="err-preferredEnd" className={`${FULL_ROW} ${FIELD_ERROR}`}>{errors.preferredEnd}</p>}

        <FormField className={FULL_ROW} label="Eligible days" error={errors.eligibleDays} errorTestId="err-eligibleDays">
          <div className="flex gap-1.5 pt-0.5">
            {DAY_LABELS.map((lbl, d) => (
              // Coarse: 7 × 40px + 6 × 6px gaps = 316px, inside a 390px sheet's content box.
              <button
                key={d}
                type="button"
                data-testid={`day-${d}`}
                onClick={() => toggleDay(d)}
                className={`${DAY_BTN} ${form.eligibleDays.includes(d) ? DAY_ON : DAY_OFF}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </FormField>
      </div>
    </DrawerPanel>
  );
}
