import { useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { useSettingsQuery, useSaveBuffersMutation, type BufferValues } from '../../api/queries';
import { toFormState, defaultFormState, toSettingsInput, browserTimezone, validateBufferMinutesText, type SettingsFormState } from '../settings/settingsForm';
import { FIELD_ERROR } from '../components/formStyles';
import { isServerUnreachable, saveErrorText } from '../lib/saveError';
import { useValueChange } from '../components/useValueChange';

const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-inkSoft';

export function Buffers() {
  const settingsQ = useSettingsQuery();
  // No settings row yet (first-time setup): the save creates them from the defaults shown here.
  const updateM = useSaveBuffersMutation(settingsQ.data ? null : toSettingsInput(defaultFormState(browserTimezone())));

  if (settingsQ.isLoading) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  const notConfigured = settingsQ.error instanceof ApiError && settingsQ.error.status === 404;
  if (settingsQ.isError && !notConfigured) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn't load settings.</p>
        <button onClick={() => void settingsQ.refetch()} className="rounded border border-gray-300 px-3 py-1">Retry</button>
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
/** `text`: the fields as typed. `baseline`: what the server has now, as shown in a field. */
type BufferFormState = { text: BufferTexts; baseline: BufferTexts };
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
  return { text, baseline: server };
}

/**
 * A save landed. For each sent field: if no newer server value arrived while it was in flight, the
 * server now has the sent text, which becomes the baseline. If one did (the baseline moved since
 * sending), the order of the two writes is unknown here, so the baseline is not moved back; a field
 * still showing the sent text counts as not edited and shows that newer value, and the refetch this
 * save triggers settles it (it brings whichever write the server kept).
 */
function afterSave(form: BufferFormState, sent: ReadonlyArray<{ field: BufferField; text: string; over: string }>): BufferFormState {
  const text = { ...form.text };
  const baseline = { ...form.baseline };
  for (const s of sent) {
    if (form.baseline[s.field] === s.over) baseline[s.field] = s.text;
    else if (form.text[s.field] === s.text) text[s.field] = form.baseline[s.field];
  }
  return { text, baseline };
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
  // The fields hold the text as typed, so '', '-5' or '1.5' reach the validator (and stay on
  // screen with their error) instead of being coerced to a number first.
  const seed = useMemo(
    () => ({ meeting: minutesText(initial.meetingBufferMs), task: minutesText(initial.taskBufferMs) }),
    // `version` is not read: a newer row with the same numbers is still a change to follow.
    [initial.meetingBufferMs, initial.taskBufferMs, version],
  );
  // Only a field whose text differs from its baseline is sent: an untouched one could revert a
  // change saved elsewhere, or round a stored 90 000 ms (shown as 2) to 120 000.
  const [form, setForm] = useState<BufferFormState>(() => ({ text: seed, baseline: seed }));
  useValueChange(seed, (_prev, next) => setForm((f) => followServer(f, next)));
  const { text: { meeting: meetingText, task: taskText }, baseline } = form;
  const setText = (field: BufferField) => (value: string) => setForm((f) => ({ ...f, text: { ...f.text, [field]: value } }));
  const setMeetingText = setText('meeting');
  const setTaskText = setText('task');
  // A "Saved" left over from the previous save must not sit next to an edited (maybe invalid) form.
  const [editedSinceSave, setEditedSinceSave] = useState(false);
  const meetingBufferError = validateBufferMinutesText(meetingText);
  const taskBufferError = validateBufferMinutesText(taskText);
  const changed: Partial<BufferValues> = {
    ...(meetingText !== baseline.meeting && { meetingBufferMs: Number(meetingText) * 60000 }),
    ...(taskText !== baseline.task && { taskBufferMs: Number(taskText) * 60000 }),
  };
  // First-time setup stores nothing an untouched field could revert, so both go as shown (sending
  // only the changed one would let a repeat save PUT the default 0 over the first save's value).
  const toSend: Partial<BufferValues> = firstTime
    ? { meetingBufferMs: Number(meetingText) * 60000, taskBufferMs: Number(taskText) * 60000 }
    : changed;
  // Only what is sent must be valid: an untouched over-cap value stored before the 24 h cap keeps
  // its error on screen but does not block saving the other field.
  const ok = !('meetingBufferMs' in toSend && meetingBufferError) && !('taskBufferMs' in toSend && taskBufferError);
  const canSave = ok && (firstTime || Object.keys(changed).length > 0);
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setEditedSinceSave(true);
  };
  const save = () => {
    if (!canSave) return;
    setEditedSinceSave(false);
    const sent = FIELDS.filter((f) => KEYS[f] in toSend).map((f) => ({ field: f, text: form.text[f], over: form.baseline[f] }));
    onSave(toSend, () => setForm((f) => afterSave(f, sent)));
  };

  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[720px]">
      <h2 className="mb-4 text-[22px] font-extrabold tracking-[-.3px] text-ink">Buffers</h2>
      <section className="mb-4 rounded-[14px] border border-line bg-card p-4">
        <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-inkSoft">Scheduling buffers</h3>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelCls}>Buffer around meetings (min)</label>
            <input
              type="number" step="1" min="0" max="1440"
              data-testid="meeting-buffer"
              className="w-full rounded-[9px] border border-line px-2 py-1 text-sm font-bold text-ink focus:border-indigo focus:outline-none"
              value={meetingText}
              onChange={edit(setMeetingText)}
            />
            <p className="mt-0.5 text-[11px] text-inkSoft">Kept free around meetings</p>
            {meetingBufferError && <p data-testid="err-meetingBufferMs" className={FIELD_ERROR}>{meetingBufferError}</p>}
          </div>
          <div className="flex-1">
            <label className={labelCls}>Gap between tasks (min)</label>
            <input
              type="number" step="1" min="0" max="1440"
              data-testid="task-buffer"
              className="w-full rounded-[9px] border border-line px-2 py-1 text-sm font-bold text-ink focus:border-indigo focus:outline-none"
              value={taskText}
              onChange={edit(setTaskText)}
            />
            <p className="mt-0.5 text-[11px] text-inkSoft">Minimum gap between scheduled blocks</p>
            {taskBufferError && <p data-testid="err-taskBufferMs" className={FIELD_ERROR}>{taskBufferError}</p>}
          </div>
        </div>
      </section>

      {saveError && <p data-testid="form-error" className={`${FIELD_ERROR} mb-2`}>{saveError}</p>}

      <div className="flex items-center gap-3">
        <button
          data-testid="save"
          disabled={!canSave || saving}
          onClick={save}
          className="rounded-[9px] bg-indigo px-5 py-2 text-[14px] font-bold text-white disabled:opacity-50"
        >
          Save
        </button>
        {justSaved && !editedSinceSave && <span data-testid="saved" className="text-[11px] text-green-600">Saved</span>}
      </div>
      </div>
    </div>
  );
}
