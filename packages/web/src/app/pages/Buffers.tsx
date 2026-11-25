import { useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { useSettingsQuery, useSaveBuffersMutation, type BufferValues } from '../../api/queries';
import { toFormState, defaultFormState, toSettingsInput, browserTimezone, validateBufferMinutesText, type SettingsFormState } from '../settings/settingsForm';
import { FIELD_ERROR } from '../components/formStyles';
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

  // Any thrown error counts, not just ApiError: a network failure rejects with a TypeError.
  const saveError = updateM.isError
    ? (updateM.error instanceof ApiError ? updateM.error.message : "Couldn't save buffers. Check your connection and try again.")
    : null;

  return (
    <BuffersForm
      initial={initial}
      firstTime={!settingsQ.data}
      onSave={(buffers, onSaved) => updateM.mutate(buffers, { onSuccess: onSaved })}
      saving={updateM.isPending} justSaved={updateM.isSuccess} saveError={saveError}
    />
  );
}

const minutesText = (ms: number) => String(Math.round(ms / 60000));

function BuffersForm({ initial, firstTime, onSave, saving, justSaved, saveError }: {
  initial: SettingsFormState;
  /** No settings row yet: saving creates it, so Save is useful even with nothing edited. */
  firstTime: boolean;
  onSave: (buffers: Partial<BufferValues>, onSaved: () => void) => void;
  saving: boolean;
  justSaved: boolean;
  saveError: string | null;
}) {
  // The fields hold the text as typed, so '', '-5' or '1.5' reach the validator (and stay on
  // screen with their error) instead of being coerced to a number first.
  const [meetingText, setMeetingText] = useState(() => minutesText(initial.meetingBufferMs));
  const [taskText, setTaskText] = useState(() => minutesText(initial.taskBufferMs));
  // The text as loaded / last saved. Only a field that differs from it is sent: an untouched one
  // could revert a change saved elsewhere, or round a stored 90 000 ms (shown as 2) to 120 000.
  const [baseline, setBaseline] = useState(() => ({ meeting: meetingText, task: taskText }));
  // Settings changed while the page is open (another tab, then the realtime refetch): a field the
  // user has not edited (still its baseline) takes the new value, and that becomes its baseline,
  // so the page never shows a value the server no longer has. An edited field keeps its text and
  // its baseline. Memoised on the two numbers so useValueChange sees a stable seed in between.
  const seed = useMemo(
    () => ({ meeting: minutesText(initial.meetingBufferMs), task: minutesText(initial.taskBufferMs) }),
    [initial.meetingBufferMs, initial.taskBufferMs],
  );
  useValueChange(seed, (_prev, next) => {
    const meetingUntouched = meetingText === baseline.meeting;
    const taskUntouched = taskText === baseline.task;
    if (meetingUntouched) setMeetingText(next.meeting);
    if (taskUntouched) setTaskText(next.task);
    setBaseline({ meeting: meetingUntouched ? next.meeting : baseline.meeting, task: taskUntouched ? next.task : baseline.task });
  });
  // A "Saved" left over from the previous save must not sit next to an edited (maybe invalid) form.
  const [editedSinceSave, setEditedSinceSave] = useState(false);
  const meetingBufferError = validateBufferMinutesText(meetingText);
  const taskBufferError = validateBufferMinutesText(taskText);
  const ok = !meetingBufferError && !taskBufferError;
  const changed: Partial<BufferValues> = {
    ...(meetingText !== baseline.meeting && { meetingBufferMs: Number(meetingText) * 60000 }),
    ...(taskText !== baseline.task && { taskBufferMs: Number(taskText) * 60000 }),
  };
  // First-time setup stores nothing an untouched field could revert, so both go as shown (sending
  // only the changed one would let a repeat save PUT the default 0 over the first save's value).
  const toSend: Partial<BufferValues> = firstTime
    ? { meetingBufferMs: Number(meetingText) * 60000, taskBufferMs: Number(taskText) * 60000 }
    : changed;
  const canSave = ok && (firstTime || Object.keys(changed).length > 0);
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setEditedSinceSave(true);
  };
  const save = () => {
    if (!canSave) return;
    setEditedSinceSave(false);
    // Only the sent fields' baselines move: one re-seeded while the save was in flight keeps its new one.
    const sentMeeting = 'meetingBufferMs' in toSend ? meetingText : null;
    const sentTask = 'taskBufferMs' in toSend ? taskText : null;
    onSave(toSend, () => setBaseline((b) => ({ meeting: sentMeeting ?? b.meeting, task: sentTask ?? b.task })));
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
