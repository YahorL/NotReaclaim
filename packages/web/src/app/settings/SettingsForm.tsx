import { useState } from 'react';
import type { SettingsInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import {
  type SettingsFormState, type DayState, validateSettingsForm, toSettingsInput, supportedTimezones,
} from './settingsForm';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

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
  const zones = timezones ?? supportedTimezones();
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
        {MON_FIRST.map((wd) => {
          const day = form.days.find((d) => d.weekday === wd)!;
          const dayErr = errors.days?.[wd];
          return (
            <div key={wd} className="flex items-center gap-2 py-1 text-sm">
              <span className={`w-10 ${day.enabled ? 'font-medium' : 'text-gray-400'}`}>{DAY_LABELS[wd]}</span>
              <input type="checkbox" data-testid={`day-${wd}-toggle`} checked={day.enabled} onChange={(e) => setDay(wd, { enabled: e.target.checked })} />
              <input type="time" data-testid={`day-${wd}-start`} className={ctlCls} disabled={!day.enabled} value={day.start} onChange={(e) => setDay(wd, { start: e.target.value })} />
              <span>–</span>
              <input type="time" data-testid={`day-${wd}-end`} className={ctlCls} disabled={!day.enabled} value={day.end} onChange={(e) => setDay(wd, { end: e.target.value })} />
              {dayErr && <span data-testid={`err-day-${wd}`} className={errCls}>{dayErr}</span>}
            </div>
          );
        })}
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
