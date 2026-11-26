import { useMemo, useState } from 'react';
import type { SettingsInput } from '../../api/types';
import { DurationStepper } from '../components/DurationStepper';
import { FieldBox } from '../components/FieldBox';
import { PrimaryButton } from '../components/Buttons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FIELD_ERROR } from '../components/formStyles';
import { CAPS_LABEL, CHECKBOX, INPUT } from '../forms/controls';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';
import {
  type SettingsFormState, validateSettingsForm, toSettingsInput, supportedTimezones,
} from './settingsForm';
import { type DayState, daysToWindows, patchDay, weeklyHoursLabel, weeklyHoursTotal } from './weeklyHours';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';

const CARD_CLS = 'glass flex min-w-0 flex-col gap-3.5 rounded-panel px-[22px] py-5';
/** Prototype `.ctl`: the recessed control inside a field box. */
const CTL = `${INPUT} h-10 rounded-input px-3 text-[16px] tabular-nums`;

/** Switching manual tracking on keeps the history but stops it counting (server spec §7, §8). */
export const REQUIRE_START_CONFIRM_TEXT = 'Time tracked automatically so far is kept on the calendar but will no longer count as time spent while Require Start is on.';

export interface SettingsFormProps {
  initial: SettingsFormState;
  /** `onSaved` once the server confirmed THIS input: it becomes the "Unsaved changes" baseline. */
  onSave: (input: SettingsInput, onSaved: () => void) => void;
  saving?: boolean;
  /** The failed save's text (server message, or the no-response line — see saveErrorText). */
  error?: { message: string } | null;
  justSaved?: boolean;
  timezones?: string[];
}

export function SettingsForm({ initial, onSave, saving = false, error = null, justSaved = false, timezones }: SettingsFormProps) {
  const [form, setForm] = useState<SettingsFormState>(() => initial);
  const { ok, errors } = validateSettingsForm(form);
  // What the server holds: the loaded settings, then whatever a save confirmed (normalised through
  // the payload, so equivalent forms compare equal). Like Buffers: "Saved" shows only while the
  // form still matches it — a mutation that succeeded earlier says nothing about later edits.
  const [baseline, setBaseline] = useState(() => JSON.stringify(toSettingsInput(initial)));
  const dirty = JSON.stringify(toSettingsInput(form)) !== baseline;
  const commit = (input: SettingsInput) => {
    const snap = JSON.stringify(input);
    onSave(input, () => setBaseline(snap));
  };
  // Off → on (against what the server holds, not the form's first state) asks first.
  const [confirmOn, setConfirmOn] = useState<SettingsInput | null>(null);
  const save = () => {
    if (!ok) return;
    const input = toSettingsInput(form);
    const savedRequireStart = (JSON.parse(baseline) as SettingsInput).requireStartToTrack === true;
    if (input.requireStartToTrack === true && !savedRequireStart) { setConfirmOn(input); return; }
    commit(input);
  };
  const confirmRequireStart = () => {
    const input = confirmOn;
    setConfirmOn(null);
    if (input) commit(input);
  };
  // Cancel turns the toggle back off; any other edit stays (and stays "Unsaved changes").
  const cancelRequireStart = () => {
    setConfirmOn(null);
    setForm((f) => ({ ...f, requireStartToTrack: false }));
  };
  const zones = useMemo(() => timezones ?? supportedTimezones(), [timezones]);
  const zoneOptions = zones.includes(form.timezone) ? zones : [form.timezone, ...zones];

  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setForm((f) => ({ ...f, days: patchDay(f.days, weekday, patch) }));

  const errCls = FIELD_ERROR;
  const weekly = weeklyHoursLabel(weeklyHoursTotal(daysToWindows(form.days)));

  return (
    <div data-testid="settings-form" className="flex flex-col gap-5">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* Working hours */}
        <section aria-labelledby="settings-hours" className={CARD_CLS}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="settings-hours" className={CAPS_LABEL}>Working hours</h2>
            <span data-testid="weekly-total" className="text-[14px] text-fg-2">{weekly}</span>
          </div>
          <WeeklyHoursEditor days={form.days} onChange={setDay} errors={errors.days} />
        </section>

        <div className="flex flex-col gap-5">
          {/* Timezone */}
          <section aria-labelledby="settings-tz" className={CARD_CLS}>
            <h2 id="settings-tz" className={CAPS_LABEL}>Timezone</h2>
            <FieldBox label="Timezone">
              <select
                data-testid="timezone"
                aria-label="Timezone"
                className={`${CTL} w-full`}
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              >
                {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </FieldBox>
            {errors.timezone && <p data-testid="err-timezone" className={errCls}>{errors.timezone}</p>}
          </section>

          {/* Planner day boundary — display only, scheduling keeps the midnight boundary */}
          <section aria-labelledby="settings-planner" className={CARD_CLS}>
            <h2 id="settings-planner" className={CAPS_LABEL}>Planner</h2>
            <FieldBox label="Day starts at">
              <input
                type="time"
                data-testid="day-start"
                aria-label="Day starts at"
                className={`${CTL} w-full max-w-[220px]`}
                // Cleared → NaN (not 0): the validator then flags it instead of saving midnight.
                value={Number.isFinite(form.dayStartMinute ?? 0) ? minutesToHHMM(form.dayStartMinute ?? 0) : ''}
                onChange={(e) => setForm((f) => ({ ...f, dayStartMinute: e.target.value ? hhmmToMinutes(e.target.value) : Number.NaN }))}
              />
            </FieldBox>
            <p className="text-[13px] leading-relaxed text-fg-2">Each planner column runs from this time to the same time the next day. Set 03:00 and late-night work stays on the previous day.</p>
            {errors.dayStartMinute && <p data-testid="err-dayStartMinute" className={errCls}>{errors.dayStartMinute}</p>}
          </section>
        </div>
      </div>

      {/* Scheduling */}
      <section aria-labelledby="settings-scheduling" className={CARD_CLS}>
        <h2 id="settings-scheduling" className={CAPS_LABEL}>Scheduling</h2>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <div className="flex min-w-0">
            <FieldBox label="Planning horizon">
              <div className="flex items-center gap-3.5">
                <input
                  type="number"
                  data-testid="horizon"
                  aria-label="Planning horizon (days)"
                  className={`${CTL} w-[124px] text-[26px] font-light`}
                  value={form.horizonDays}
                  onChange={(e) => setForm((f) => ({ ...f, horizonDays: Number(e.target.value) }))}
                />
                <span className="text-[15px] text-fg-2">days ahead</span>
              </div>
              {errors.horizonDays && <p data-testid="err-horizonDays" className={errCls}>{errors.horizonDays}</p>}
            </FieldBox>
          </div>
          <div className="flex min-w-0">
            <FieldBox label="Min chunk">
              <DurationStepper
                valueMs={form.defaultMinChunkMs}
                onChange={(ms) => setForm((f) => ({ ...f, defaultMinChunkMs: ms }))}
                label="min"
              />
              {errors.defaultMinChunkMs && <p data-testid="err-defaultMinChunkMs" className={errCls}>{errors.defaultMinChunkMs}</p>}
            </FieldBox>
          </div>
          <div className="flex min-w-0">
            <FieldBox label="Max chunk">
              <DurationStepper
                valueMs={form.defaultMaxChunkMs}
                onChange={(ms) => setForm((f) => ({ ...f, defaultMaxChunkMs: ms }))}
                label="max"
              />
              {errors.defaultMaxChunkMs && <p data-testid="err-defaultMaxChunkMs" className={errCls}>{errors.defaultMaxChunkMs}</p>}
            </FieldBox>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            data-testid="require-start"
            checked={form.requireStartToTrack}
            onChange={(e) => setForm((f) => ({ ...f, requireStartToTrack: e.target.checked }))}
            className={CHECKBOX}
          />
          Only count time after I press Start
        </label>
      </section>

      {error && <p data-testid="form-error" className={errCls}>{error.message}</p>}

      <div className="flex items-center gap-3.5">
        <PrimaryButton large data-testid="save" disabled={!ok || saving} onClick={save}>
          Save
        </PrimaryButton>
        <span role="status" className="text-[13px] text-fg-2">
          {dirty
            ? <span data-testid="unsaved">Unsaved changes</span>
            : justSaved && <span data-testid="saved">Saved</span>}
        </span>
      </div>

      {confirmOn && (
        <ConfirmDialog
          title="Only count time after you press Start?"
          message={REQUIRE_START_CONFIRM_TEXT}
          onConfirm={confirmRequireStart}
          onCancel={cancelRequireStart}
        />
      )}
    </div>
  );
}
