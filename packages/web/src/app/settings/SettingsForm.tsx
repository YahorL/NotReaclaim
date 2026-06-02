import { useMemo, useState } from 'react';
import type { SettingsInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
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

  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'text-[11px] text-red-600';

  return (
    <div data-testid="settings-form" className="max-w-md p-4">
      <h2 className="mb-3 text-lg font-semibold">Settings</h2>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Working hours</h3>
        <WeeklyHoursEditor days={form.days} onChange={setDay} errors={errors.days} />
      </section>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Timezone</h3>
        <select data-testid="timezone" className={ctlCls} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
          {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        {errors.timezone && <p data-testid="err-timezone" className={errCls}>{errors.timezone}</p>}
      </section>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Scheduling</h3>
        <div className="mb-2">
          <label className={labelCls}>Horizon (days)</label>
          <input type="number" data-testid="horizon" className={`${ctlCls} w-20`} value={form.horizonDays} onChange={(e) => setForm((f) => ({ ...f, horizonDays: Number(e.target.value) }))} />
          {errors.horizonDays && <p data-testid="err-horizonDays" className={errCls}>{errors.horizonDays}</p>}
        </div>
        <div className="mb-2">
          <label className={labelCls}>Default min chunk</label>
          <DurationField valueMs={form.defaultMinChunkMs} onChange={(ms) => setForm((f) => ({ ...f, defaultMinChunkMs: ms }))} testid="min" />
          {errors.defaultMinChunkMs && <p data-testid="err-defaultMinChunkMs" className={errCls}>{errors.defaultMinChunkMs}</p>}
        </div>
        <div className="mb-2">
          <label className={labelCls}>Default max chunk</label>
          <DurationField valueMs={form.defaultMaxChunkMs} onChange={(ms) => setForm((f) => ({ ...f, defaultMaxChunkMs: ms }))} testid="max" />
          {errors.defaultMaxChunkMs && <p data-testid="err-defaultMaxChunkMs" className={errCls}>{errors.defaultMaxChunkMs}</p>}
        </div>
      </section>

      {error && <p data-testid="form-error" className={errCls}>{error.message}</p>}

      <div className="flex items-center gap-3">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toSettingsInput(form)); }}
          className="rounded bg-blue-600 px-4 py-1 text-sm text-white disabled:opacity-50">Save</button>
        {justSaved && <span data-testid="saved" className="text-sm text-green-600">✓ Saved</span>}
      </div>
    </div>
  );
}
