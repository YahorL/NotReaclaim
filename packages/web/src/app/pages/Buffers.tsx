import { useId, useState } from 'react';
import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { toFormState, defaultFormState, toSettingsInput, browserTimezone, validateBufferMs, type SettingsFormState } from '../settings/settingsForm';
import { FIELD_ERROR } from '../components/formStyles';
import { PrimaryButton } from '../components/Buttons';
import { CAPS_LABEL, INPUT } from '../forms/controls';
import { BufferPreview } from '../buffers/BufferPreview';
import { stepBuffer } from '../buffers/bufferModel';

const MS_PER_MIN = 60_000;
const toMin = (ms: number): number => Math.round(ms / MS_PER_MIN);

export function Buffers() {
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();

  if (settingsQ.isLoading) {
    return <div className="px-4 pt-4 text-fg-2 md:px-1">Loading…</div>;
  }

  const notConfigured = settingsQ.error instanceof ApiError && settingsQ.error.status === 404;
  if (settingsQ.isError && !notConfigured) {
    return (
      <div className="px-4 pt-4 md:px-1">
        <p className="mb-3 text-danger">Couldn't load settings.</p>
        <button onClick={() => void settingsQ.refetch()} className="btn-glass rounded-pill px-4 py-2 text-[14px]">Retry</button>
      </div>
    );
  }

  const initial = settingsQ.data ? toFormState(settingsQ.data) : defaultFormState(browserTimezone());

  // Any thrown error counts, not just ApiError: a network failure rejects with a TypeError.
  const saveError = updateM.isError
    ? (updateM.error instanceof ApiError ? updateM.error.message : "Couldn't save buffers. Check your connection and try again.")
    : null;

  return <BuffersForm initial={initial} onSave={(input, onSaved) => updateM.mutate(input, { onSuccess: onSaved })} saving={updateM.isPending} justSaved={updateM.isSuccess} saveError={saveError} />;
}

type BufferField = 'meetingBufferMs' | 'taskBufferMs';

/** One glass card: caps label, − / editable minutes / +, helper text, validation line. */
function BufferCard({ field, label, help, testId, valueMs, error, onChange }: {
  field: BufferField; label: string; help: string; testId: string; valueMs: number; error?: string;
  onChange: (ms: number) => void;
}) {
  const id = useId();
  const minutes = toMin(valueMs);
  const step = (dir: 1 | -1) => onChange(stepBuffer(minutes, dir) * MS_PER_MIN);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return (
    <div className="glass flex flex-col gap-3.5 rounded-panel px-[22px] pb-5 pt-[22px]">
      <label htmlFor={id} className={CAPS_LABEL}>{label}</label>
      <div className="flex items-center gap-2.5">
        <button type="button" aria-label={`Decrease ${lower}`} onClick={() => step(-1)} className="btn-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <input
          id={id}
          type="number" step="1" min="0"
          data-testid={testId}
          aria-describedby={`${id}-help`}
          className={`${INPUT} h-11 w-full min-w-0 rounded-[14px] px-3 text-center text-[28px] font-light tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          value={minutes}
          onChange={(e) => onChange(Math.round(Number(e.target.value)) * MS_PER_MIN)}
        />
        <button type="button" aria-label={`Increase ${lower}`} onClick={() => step(1)} className="btn-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      <span id={`${id}-help`} className="text-[13px] text-fg-2">{help}</span>
      {error && <p data-testid={`err-${field}`} className={FIELD_ERROR}>{error}</p>}
    </div>
  );
}

function BuffersForm({ initial, onSave, saving, justSaved, saveError }: {
  initial: SettingsFormState;
  onSave: (input: ReturnType<typeof toSettingsInput>, onSaved: () => void) => void;
  saving: boolean;
  justSaved: boolean;
  saveError: string | null;
}) {
  const [form, setForm] = useState<SettingsFormState>(() => initial);
  // What the server holds for the two buffers: the loaded values, then whatever a save confirmed.
  // "Unsaved changes" compares against this, so it clears the moment a save succeeds (without
  // waiting for the settings refetch) and comes back on the next edit.
  const [baseline, setBaseline] = useState(() => ({ m: initial.meetingBufferMs, t: initial.taskBufferMs }));
  // Only the two fields this page edits gate Save: the rest of the payload is the stored settings,
  // and an error there would have nowhere on this page to show.
  const meetingBufferError = validateBufferMs(form.meetingBufferMs);
  const taskBufferError = validateBufferMs(form.taskBufferMs);
  const ok = !meetingBufferError && !taskBufferError;
  const dirty = form.meetingBufferMs !== baseline.m || form.taskBufferMs !== baseline.t;
  const set = (field: BufferField) => (ms: number) => setForm((f) => ({ ...f, [field]: ms }));

  const save = () => {
    if (!ok) return;
    const snap = { m: form.meetingBufferMs, t: form.taskBufferMs };
    onSave(toSettingsInput(form), () => setBaseline(snap));
  };

  return (
    <div className="px-4 pb-6 pt-4 md:px-1 md:pt-0">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BufferCard
            field="meetingBufferMs" testId="meeting-buffer" label="Buffer around meetings"
            help="Minutes kept free before and after each meeting"
            valueMs={form.meetingBufferMs} error={meetingBufferError} onChange={set('meetingBufferMs')}
          />
          <BufferCard
            field="taskBufferMs" testId="task-buffer" label="Gap between tasks"
            help="Minimum minutes between scheduled blocks"
            valueMs={form.taskBufferMs} error={taskBufferError} onChange={set('taskBufferMs')}
          />
        </div>

        <BufferPreview meetingBufferMin={toMin(form.meetingBufferMs)} gapMin={toMin(form.taskBufferMs)} />

        {saveError && <p data-testid="form-error" className={FIELD_ERROR}>{saveError}</p>}

        <div className="flex items-center gap-3.5">
          <PrimaryButton large data-testid="save" disabled={!ok || saving} onClick={save}>Save</PrimaryButton>
          <span role="status" className="text-[13px] text-fg-2">
            {dirty
              ? <span data-testid="unsaved">Unsaved changes</span>
              : justSaved && <span data-testid="saved">Saved</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
