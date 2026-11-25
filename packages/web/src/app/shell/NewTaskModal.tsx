import { useState, useEffect, useMemo, useRef, useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ApiError } from '../../api/client';
import { useCreateTaskMutation, useSettingsQuery, useCategoriesQuery, useCreateCategoryMutation } from '../../api/queries';
import { Icons } from './icons';
import {
  type DateFields, type NewTaskFormState, defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput, reseedDateFields,
  chunkSeed, reseedChunkFields,
} from '../tasks/taskForm';
import { useValueChange } from '../components/useValueChange';
import { useTimezone, useZoneChange } from '../settings/useTimezone';
import { FieldBox } from '../components/FieldBox';
import { DurationStepper } from '../components/DurationStepper';
import { PriorityPicker } from '../components/PriorityPicker';
import { PrimaryButton } from '../components/Buttons';
import { FIELD_ERROR } from '../components/formStyles';
import { useFormState } from '../components/useFormState';
import { useFocusTrap } from '../components/Sheet';
import { CHECKBOX, INPUT } from '../forms/controls';
import { usePrefersReducedMotion } from '../../theme/usePrefersReducedMotion';

const FALLBACK_WORKING_HOURS = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];

/** `--dur-modal-out`: the exit plays this long before the dialog unmounts. */
export const MODAL_EXIT_MS = 220;

/** Glass field card with a real `<label>` for its one control (Hours, Schedule after, Due date). */
function LabelledField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="glass-card flex min-w-0 flex-col gap-2 rounded-field px-4 py-3 transition-colors focus-within:border-focus">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg-2">{label}</label>
      {children}
    </div>
  );
}

export interface NewTaskModalProps {
  onClose: () => void;
  now?: () => number;
  /**
   * The control that opened the dialog (header New task, mobile +); focus returns there on close.
   * Passed by the shell because a click does not focus a button in Safari (and jsdom), so the
   * focus trap's own render-time capture of `document.activeElement` would be <body>.
   */
  opener?: RefObject<HTMLElement | null>;
}

/**
 * New task dialog (spec §4.3, interactions §3). Esc / ✕ / Cancel / backdrop and a successful
 * create all go through one idempotent `requestClose`: the backdrop and dialog play their exit
 * (`data-closing`, 220ms) and only then does the shell unmount it — at once under reduced motion.
 */
export function NewTaskModal({ onClose, now = () => Date.now(), opener }: NewTaskModalProps) {
  const settingsQ = useSettingsQuery();
  const createM = useCreateTaskMutation();
  // Memoised on the two numbers so useValueChange sees a stable seed between settings changes.
  const chunks = useMemo(
    () => chunkSeed(settingsQ.data),
    [settingsQ.data?.defaultMinChunkMs, settingsQ.data?.defaultMaxChunkMs],
  );
  const zone = useTimezone();
  const [form, set, setForm] = useFormState<NewTaskFormState>(() => defaultNewTaskForm(now(), zone, settingsQ.data));
  // Opened before settings loaded (built-in chunk fallback): move the untouched chunk sizes to the user's defaults.
  useValueChange(chunks, (prev, next) => setForm((f) => reseedChunkFields(f, prev, next)));
  // The date defaults actually seeded, kept rather than rebuilt from the clock: by the time the zone
  // lands "today" may have moved (opened at 23:59), and a rebuilt seed would no longer match.
  const dateSeedRef = useRef<DateFields | null>(null);
  if (dateSeedRef.current === null) dateSeedRef.current = { dueByLocal: form.dueByLocal, notBeforeLocal: form.notBeforeLocal };
  // Opened before settings loaded (fallback zone): move the untouched date defaults to the real zone.
  useZoneChange(zone, (_prev, next) => {
    const prevSeed = dateSeedRef.current!;
    const fresh = defaultNewTaskForm(now(), next);
    const nextSeed = { dueByLocal: fresh.dueByLocal, notBeforeLocal: fresh.notBeforeLocal };
    dateSeedRef.current = nextSeed;
    setForm((f) => reseedDateFields(f, prevSeed, nextSeed));
  });

  const categoriesQ = useCategoriesQuery();
  const createCategoryM = useCreateCategoryMutation();
  const [creatingCat, setCreatingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const categories = categoriesQ.data ?? [];

  useEffect(() => {
    if (form.categoryId === null && categories.length > 0) {
      const def = categories.find((c) => c.isDefault) ?? categories[0]!;
      set('categoryId', def.id);
    }
  }, [categories, form.categoryId]);

  const { ok, errors } = validateNewTaskForm(form, zone);
  const error = createM.error instanceof ApiError ? createM.error : null;

  // ---- closing --------------------------------------------------------------------------------
  const reduced = usePrefersReducedMotion();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The shell re-renders mid-exit with a new arrow; always call the latest one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reduced) { onCloseRef.current(); return; }
    setClosing(true);
    exitTimer.current = setTimeout(() => { exitTimer.current = null; onCloseRef.current(); }, MODAL_EXIT_MS);
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Explicit initial focus: `autoFocus` alone loses to StrictMode's double-run effect (spec §10 P2).
  const trapKeyDown = useFocusTrap(dialogRef, { onEscape: requestClose, restoreTo: opener, initialFocus: () => nameRef.current });

  // A press that started inside the dialog and was released over the backdrop (selecting text in
  // a field) dispatches its click on the backdrop: only a press that began there closes.
  const pressOnBackdrop = useRef<boolean | null>(null);

  // ---- submit ---------------------------------------------------------------------------------
  // A ref, not `isPending`: two Enters in one tick both see the pre-mutate render.
  const submitting = useRef(false);
  const submit = () => {
    if (!ok || submitting.current || closingRef.current) return;
    submitting.current = true;
    createM.mutate(toCreateTaskInput(form, zone), {
      onSuccess: () => requestClose(),
      onError: () => { submitting.current = false; },
    });
  };

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const canAddCategory = newCatName.trim() !== '' && !createCategoryM.isPending;
  const addCategory = () => {
    if (!canAddCategory) return;
    const windows = settingsQ.data?.workingHours ?? FALLBACK_WORKING_HOURS;
    createCategoryM.mutate({ name: newCatName.trim(), windows }, {
      onSuccess: (cat) => { set('categoryId', cat.id); setCreatingCat(false); setNewCatName(''); },
    });
  };
  const onCategoryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addCategory(); }
    // Escape backs out of the inline field only; the dialog's trap must not see it.
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCreatingCat(false); setNewCatName(''); }
  };

  const titleId = useId();
  const nameId = useId();
  const splitLabelId = useId();
  const splitHintId = useId();
  const hoursId = useId();
  const afterId = useId();
  const dueId = useId();

  return (
    /* pt: MobileTopBar is 56px (h-14), the desktop TopBar 70px. px-4 stays on both — 16px
       gutters are what makes this "near-full-screen" rather than edge-to-edge. */
    <div
      data-testid="new-task-backdrop"
      data-closing={closing || undefined}
      onPointerDown={(e) => { pressOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const startedInside = pressOnBackdrop.current === false;
        pressOnBackdrop.current = null;
        if (e.target === e.currentTarget && !startedInside) requestClose();
      }}
      className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay px-4 pb-6 pt-14 backdrop-blur-[8px] md:pt-[70px] ${closing ? 'pointer-events-none animate-bd-out' : 'animate-bd-in'}`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapKeyDown}
        data-closing={closing || undefined}
        className={`glass-dialog flex min-h-[calc(100dvh_-_88px)] w-full max-w-[600px] flex-col gap-3.5 rounded-[26px] p-[22px] outline-none md:min-h-0 ${closing ? 'animate-modal-out' : 'animate-modal-in'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-[20px] font-semibold tracking-[-0.01em] text-fg">New task</h2>
          <button type="button" aria-label="Close" onClick={requestClose} className="btn-glass grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-fg coarse:h-11 coarse:w-11">
            <Icons.close size={16} className="[stroke-width:2]" />
          </button>
        </div>

        <div className="flex h-[60px] shrink-0 items-center gap-3 rounded-field border-[1.5px] border-meeting/60 bg-fg/[.04] px-[18px] text-fg-2 transition-[border-color,box-shadow] duration-200 focus-within:border-meeting focus-within:shadow-[0_0_0_4px_rgb(var(--c-meeting)/0.22)]">
          <Icons.emoji size={22} className="shrink-0" />
          <label htmlFor={nameId} className="sr-only">Task name</label>
          <input
            id={nameId}
            ref={nameRef}
            autoFocus
            autoComplete="off"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onKeyDown={onNameKeyDown}
            placeholder="Task name…"
            className="min-w-0 flex-1 bg-transparent text-[20px] font-medium text-fg outline-none placeholder:text-fg-3"
          />
        </div>

        <div data-testid="duration-priority-row" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox label="Duration">
            <div className="pt-1.5"><DurationStepper label="duration" valueMs={form.durationMs} onChange={(ms) => set('durationMs', ms)} /></div>
          </FieldBox>
          <div className="flex min-w-0 flex-col gap-2 px-0.5 py-2.5">
            <span aria-hidden="true" className="text-[13px] font-medium text-fg-2">Priority</span>
            <PriorityPicker value={form.priority} onChange={(p) => set('priority', p)} />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3 px-1 py-0.5">
          <input
            type="checkbox"
            checked={form.split}
            onChange={(e) => set('split', e.target.checked)}
            aria-labelledby={splitLabelId}
            aria-describedby={splitHintId}
            className={`${CHECKBOX} checked:animate-pop-check`}
          />
          <span className="flex flex-col gap-0.5">
            <span id={splitLabelId} className="text-[15px] text-fg">Split up</span>
            <span id={splitHintId} className="text-[12px] text-fg-2">Let the planner spread this task over several blocks</span>
          </span>
        </label>

        {/* Only rendered while Split is on (slides in with `expand`); off sends min = max = duration. */}
        {form.split && (
          <div data-testid="chunk-row" className="grid animate-expand grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldBox label="Min duration">
              <div className="pt-1.5"><DurationStepper label="min" valueMs={form.minChunkMs} onChange={(ms) => set('minChunkMs', ms)} /></div>
            </FieldBox>
            <FieldBox label="Max duration">
              <div className="pt-1.5"><DurationStepper label="max" valueMs={form.maxChunkMs} onChange={(ms) => set('maxChunkMs', ms)} /></div>
            </FieldBox>
          </div>
        )}

        <LabelledField label="Hours" htmlFor={hoursId}>
          <div className="flex items-center gap-3">
            <select
              id={hoursId}
              data-testid="category-select"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value || null)}
              className={`${INPUT} h-10 min-w-0 flex-1 px-3 text-[15px]`}
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              type="button"
              aria-label="Add new category"
              data-testid="new-category-btn"
              onClick={() => setCreatingCat(true)}
              className="shrink-0 whitespace-nowrap rounded-pill px-1 py-1 text-[13px] font-semibold text-accent-fg hover:underline coarse:px-3 coarse:py-3"
            >+ New</button>
          </div>
          {creatingCat && (
            <div className="flex animate-expand items-center gap-2">
              <input
                data-testid="new-category-name"
                aria-label="New category name"
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={onCategoryKeyDown}
                placeholder="Category name…"
                className={`${INPUT} h-9 min-w-0 flex-1 px-3 text-[14px]`}
              />
              <button
                type="button"
                data-testid="new-category-confirm"
                disabled={!canAddCategory}
                onClick={addCategory}
                className="btn-accent h-9 shrink-0 rounded-pill px-4 text-[13px] font-semibold"
              >Add</button>
            </div>
          )}
        </LabelledField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabelledField label="Schedule after" htmlFor={afterId}>
            <input
              id={afterId}
              type="datetime-local"
              data-testid="schedule-after"
              value={form.notBeforeLocal}
              onChange={(e) => set('notBeforeLocal', e.target.value)}
              className={`${INPUT} h-10 w-full min-w-0 px-3 text-[15px]`}
            />
            {errors.notBeforeLocal && <p data-testid="err-notBeforeLocal" className={FIELD_ERROR}>{errors.notBeforeLocal}</p>}
          </LabelledField>
          <LabelledField label="Due date" htmlFor={dueId}>
            <input
              id={dueId}
              type="datetime-local"
              data-testid="due-date"
              value={form.dueByLocal}
              onChange={(e) => set('dueByLocal', e.target.value)}
              className={`${INPUT} h-10 w-full min-w-0 px-3 text-[15px]`}
            />
            <p className="text-[12px] text-fg-2">Leave empty for no deadline</p>
            {errors.dueByLocal && <p data-testid="err-dueByLocal" className={FIELD_ERROR}>{errors.dueByLocal}</p>}
          </LabelledField>
        </div>

        {error && <p data-testid="modal-error" role="alert" className="text-[13px] text-danger">{error.message}</p>}

        <div className="mt-auto flex items-center justify-end gap-3 pt-1 md:mt-0">
          <button type="button" onClick={requestClose} className="btn-glass inline-flex h-[46px] items-center rounded-pill px-6 text-[15px] font-medium text-fg">
            Cancel
          </button>
          <PrimaryButton large type="button" disabled={!ok || createM.isPending} onClick={submit}>
            Create
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
