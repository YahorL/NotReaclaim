import { useId, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { useSettingsQuery, useSaveBuffersMutation, type BufferValues } from '../../api/queries';
import { toFormState, defaultFormState, toSettingsInput, browserTimezone, validateBufferMinutesText, type SettingsFormState } from '../settings/settingsForm';
import { FIELD_ERROR } from '../components/formStyles';
import { PrimaryButton } from '../components/Buttons';
import { CAPS_LABEL, INPUT } from '../forms/controls';
import { BufferPreview } from '../buffers/BufferPreview';
import { stepBuffer } from '../buffers/bufferModel';
import { isServerUnreachable, saveErrorText } from '../lib/saveError';
import { useValueChange } from '../components/useValueChange';

export function Buffers() {
  const settingsQ = useSettingsQuery();
  // No settings row yet (first-time setup): the save creates them from the defaults shown here.
  const updateM = useSaveBuffersMutation(settingsQ.data ? null : toSettingsInput(defaultFormState(browserTimezone())));

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

  // Any thrown error counts, not just ApiError: a network failure rejects with a TypeError, and a
  // proxy's 502/503/504 page means the API never answered either (see isServerUnreachable).
  const saveError = updateM.isError
    ? (isServerUnreachable(updateM.error) ? "Couldn't save buffers. Check your connection and try again." : saveErrorText(updateM.error))
    : null;

  return (
    <BuffersForm
      initial={initial}
      version={settingsQ.data?.updatedAt}
      firstTime={!settingsQ.data}
      onSave={(buffers, onSaved) => updateM.mutate(buffers, { onSuccess: onSaved })}
      saving={updateM.isPending} justSaved={updateM.isSuccess} saveError={saveError}
    />
  );
}

const minutesText = (ms: number) => String(Math.round(ms / 60000));

type BufferField = 'meeting' | 'task';
type BufferTexts = Record<BufferField, string>;
/**
 * `text`: the fields as typed. `baseline`: what the server has now, as shown in a field.
 * `follows`: how many server values have been followed (see followServer), so a save can tell
 * whether one arrived while it was in flight; a value can leave and come back (15, then 30 again),
 * so comparing values cannot.
 */
type BufferFormState = { text: BufferTexts; baseline: BufferTexts; follows: number };
const FIELDS = ['meeting', 'task'] as const;
const KEYS = { meeting: 'meetingBufferMs', task: 'taskBufferMs' } as const;

/**
 * The server's settings changed (another tab, then the realtime refetch; or this page's own save):
 * a field still equal to its old baseline was not edited and takes the server's value; an edited
 * field keeps its text. Either way the baseline becomes the server's value, so a field is sent
 * exactly when its text differs from what the server has now.
 */
function followServer(form: BufferFormState, server: BufferTexts): BufferFormState {
  const text = { ...form.text };
  for (const f of FIELDS) if (form.text[f] === form.baseline[f]) text[f] = server[f];
  return { text, baseline: server, follows: form.follows + 1 };
}

/**
 * A save landed. For each sent field: if no server value was followed since sending, the server now
 * has the sent text, which becomes the baseline. If one was (the server announces a write, this
 * save's own included, before it replies), the order of the writes is unknown here, so the baseline
 * stays the last value followed; a field still showing the sent text counts as not edited and shows
 * that value, and the refetch this save triggers settles it (it brings whichever write the server
 * kept). The check counts follows rather than comparing the baseline with the value sent over: the
 * baseline can leave that value and come back to it (our 15 arrives, another tab sets 30 back), and
 * taking that for "nothing arrived" would mark the server's value as an edit and send it later.
 */
function afterSave(form: BufferFormState, sent: ReadonlyArray<{ field: BufferField; text: string }>, followsAtSend: number): BufferFormState {
  const text = { ...form.text };
  const baseline = { ...form.baseline };
  for (const s of sent) {
    if (form.follows === followsAtSend) baseline[s.field] = s.text;
    else if (form.text[s.field] === s.text) text[s.field] = form.baseline[s.field];
  }
  return { ...form, text, baseline };
}

/**
 * Minutes for the preview strip: the typed value when it is valid, else what the server has
 * (an emptied or fractional field previews the stored value instead of collapsing to 0).
 */
const previewMinutes = (text: string, baseline: string): number => Number(validateBufferMinutesText(text) ? baseline : text);

/** One glass card: caps label, − / editable minutes / +, helper text, validation line. */
function BufferCard({ field, label, help, testId, text, error, onChange }: {
  field: 'meetingBufferMs' | 'taskBufferMs'; label: string; help: string; testId: string; text: string; error?: string;
  /** The field's new text, as typed or as stepped. */
  onChange: (text: string) => void;
}) {
  const id = useId();
  // A stepper press starts from the typed value; an invalid one (empty, negative, fractional
  // garbage) restarts from 0 inside stepBuffer.
  const step = (dir: 1 | -1) => onChange(String(stepBuffer(text.trim() === '' ? 0 : Number(text), dir)));
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return (
    <div className="glass flex flex-col gap-3.5 rounded-panel px-[22px] pb-5 pt-[22px]">
      <label htmlFor={id} className={CAPS_LABEL}>{label}</label>
      <div className="flex items-center gap-2.5">
        <button type="button" aria-label={`Decrease ${lower}`} onClick={() => step(-1)} className="btn-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        {/* The text as typed, so '', '-5' or '1.5' reach the validator (and stay on screen with
            their error) instead of being coerced to a number first. */}
        <input
          id={id}
          type="number" step="1" min="0" max="1440"
          data-testid={testId}
          aria-describedby={`${id}-help`}
          className={`${INPUT} h-11 w-full min-w-0 rounded-[14px] px-3 text-center text-[28px] font-light tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          value={text}
          onChange={(e) => onChange(e.target.value)}
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

function BuffersForm({ initial, version, firstTime, onSave, saving, justSaved, saveError }: {
  initial: SettingsFormState;
  /** The settings row's `updatedAt`: a refetch that brings back the same buffer values from a newer row still re-seeds. */
  version: string | undefined;
  /** No settings row yet: saving creates it, so Save is useful even with nothing edited. */
  firstTime: boolean;
  onSave: (buffers: Partial<BufferValues>, onSaved: () => void) => void;
  saving: boolean;
  justSaved: boolean;
  saveError: string | null;
}) {
  const seed = useMemo(
    () => ({ meeting: minutesText(initial.meetingBufferMs), task: minutesText(initial.taskBufferMs) }),
    // `version` is not read: a newer row with the same numbers is still a change to follow.
    [initial.meetingBufferMs, initial.taskBufferMs, version],
  );
  // Only a field whose text differs from its baseline is sent: an untouched one could revert a
  // change saved elsewhere, or round a stored 90 000 ms (shown as 2) to 120 000.
  const [form, setForm] = useState<BufferFormState>(() => ({ text: seed, baseline: seed, follows: 0 }));
  useValueChange(seed, (_prev, next) => setForm((f) => followServer(f, next)));
  const { text: { meeting: meetingText, task: taskText }, baseline } = form;
  const setText = (field: BufferField) => (value: string) => setForm((f) => ({ ...f, text: { ...f.text, [field]: value } }));
  const meetingBufferError = validateBufferMinutesText(meetingText);
  const taskBufferError = validateBufferMinutesText(taskText);
  const changed: Partial<BufferValues> = {
    ...(meetingText !== baseline.meeting && { meetingBufferMs: Number(meetingText) * 60000 }),
    ...(taskText !== baseline.task && { taskBufferMs: Number(taskText) * 60000 }),
  };
  // "Unsaved changes" compares against what the server has now (the baseline), so it clears the
  // moment a save succeeds (without waiting for the settings refetch) and comes back on the next
  // edit; a "Saved" left over from the previous save never sits next to an edited form.
  const dirty = Object.keys(changed).length > 0;
  // First-time setup stores nothing an untouched field could revert, so both go as shown (sending
  // only the changed one would let a repeat save PUT the default 0 over the first save's value).
  const toSend: Partial<BufferValues> = firstTime
    ? { meetingBufferMs: Number(meetingText) * 60000, taskBufferMs: Number(taskText) * 60000 }
    : changed;
  // Only what is sent must be valid: an untouched over-cap value stored before the 24 h cap keeps
  // its error on screen but does not block saving the other field.
  const ok = !('meetingBufferMs' in toSend && meetingBufferError) && !('taskBufferMs' in toSend && taskBufferError);
  const canSave = ok && (firstTime || dirty);
  const save = () => {
    if (!canSave) return;
    const sent = FIELDS.filter((f) => KEYS[f] in toSend).map((f) => ({ field: f, text: form.text[f] }));
    const followsAtSend = form.follows;
    onSave(toSend, () => setForm((f) => afterSave(f, sent, followsAtSend)));
  };

  return (
    <div className="px-4 pb-6 pt-4 md:px-1 md:pt-0">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BufferCard
            field="meetingBufferMs" testId="meeting-buffer" label="Buffer around meetings"
            help="Minutes kept free before and after each meeting"
            text={meetingText} error={meetingBufferError} onChange={setText('meeting')}
          />
          <BufferCard
            field="taskBufferMs" testId="task-buffer" label="Gap between tasks"
            help="Minimum minutes between scheduled blocks"
            text={taskText} error={taskBufferError} onChange={setText('task')}
          />
        </div>

        <BufferPreview
          meetingBufferMin={previewMinutes(meetingText, baseline.meeting)}
          gapMin={previewMinutes(taskText, baseline.task)}
        />

        {saveError && <p data-testid="form-error" className={FIELD_ERROR}>{saveError}</p>}

        <div className="flex items-center gap-3.5">
          <PrimaryButton large data-testid="save" disabled={!canSave || saving} onClick={save}>Save</PrimaryButton>
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
