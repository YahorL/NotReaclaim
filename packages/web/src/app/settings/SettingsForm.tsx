import { useMemo, useState } from 'react';
import type { SettingsInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationStepper } from '../components/DurationStepper';
import { FieldBox } from '../components/FieldBox';
import {
  type SettingsFormState, type DayState, validateSettingsForm, toSettingsInput, supportedTimezones,
} from './settingsForm';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';

export interface SettingsFormProps {
  initial: SettingsFormState;
  onSave: (input: SettingsInput) => void;
  saving?: boolean;
  error?: ApiError | null;
  justSaved?: boolean;
  timezones?: string[];
}

export function SettingsForm({ initial, onSave, saving = false, error = null, justSaved = false, timezones }: SettingsFormProps) {
  const [form, setForm] = useState<SettingsFormState>(() => initial);
  const { ok, errors } = validateSettingsForm(form);
  const zones = useMemo(() => timezones ?? supportedTimezones(), [timezones]);
  const zoneOptions = zones.includes(form.timezone) ? zones : [form.timezone, ...zones];

  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setForm((f) => ({ ...f, days: f.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)) }));

  const errCls = 'text-[11px] text-red-600';

  return (
    <div data-testid="settings-form" className="max-w-md p-4">
      <h2 className="mb-4 text-[20px] font-extrabold text-ink">Settings</h2>

      {/* Working hours */}
      <section className="mb-4 rounded-[14px] border border-line bg-card p-4">
        <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-inkSoft">Working hours</h3>
        <WeeklyHoursEditor days={form.days} onChange={setDay} errors={errors.days} />
      </section>

      {/* Timezone */}
      <section className="mb-4 rounded-[14px] border border-line bg-card p-4">
        <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-inkSoft">Timezone</h3>
        <FieldBox label="Timezone">
          <select
            data-testid="timezone"
            className="w-full bg-transparent text-[15px] font-bold text-ink focus:outline-none"
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          >
            {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </FieldBox>
        {errors.timezone && <p data-testid="err-timezone" className={errCls}>{errors.timezone}</p>}
      </section>

      {/* Scheduling */}
      <section className="mb-4 rounded-[14px] border border-line bg-card p-4">
        <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-inkSoft">Scheduling</h3>

        {/* Horizon */}
        <div className="mb-3">
          <FieldBox label="Planning horizon">
            <input
              type="number"
              data-testid="horizon"
              className="w-full bg-transparent text-[15px] font-bold text-ink focus:outline-none"
              value={form.horizonDays}
              onChange={(e) => setForm((f) => ({ ...f, horizonDays: Number(e.target.value) }))}
            />
          </FieldBox>
          {errors.horizonDays && <p data-testid="err-horizonDays" className={errCls}>{errors.horizonDays}</p>}
        </div>

        {/* Chunk steppers */}
        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <FieldBox label="Min chunk">
              <DurationStepper
                valueMs={form.defaultMinChunkMs}
                onChange={(ms) => setForm((f) => ({ ...f, defaultMinChunkMs: ms }))}
                label="min"
                size={22}
              />
            </FieldBox>
            {errors.defaultMinChunkMs && <p data-testid="err-defaultMinChunkMs" className={errCls}>{errors.defaultMinChunkMs}</p>}
          </div>
          <div className="flex-1">
            <FieldBox label="Max chunk">
              <DurationStepper
                valueMs={form.defaultMaxChunkMs}
                onChange={(ms) => setForm((f) => ({ ...f, defaultMaxChunkMs: ms }))}
                label="max"
                size={22}
              />
            </FieldBox>
            {errors.defaultMaxChunkMs && <p data-testid="err-defaultMaxChunkMs" className={errCls}>{errors.defaultMaxChunkMs}</p>}
          </div>
        </div>

      </section>

      {error && <p data-testid="form-error" className={errCls}>{error.message}</p>}

      <div className="flex items-center gap-3">
        <button
          data-testid="save"
          disabled={!ok || saving}
          onClick={() => { if (ok) onSave(toSettingsInput(form)); }}
          className="rounded-[9px] bg-indigo px-5 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          Save
        </button>
        {justSaved && <span data-testid="saved" className="text-sm text-low">Saved</span>}
      </div>
    </div>
  );
}
