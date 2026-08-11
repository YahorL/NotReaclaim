import { useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type { CalendarEvent, UpdateCalendarEventInput } from '../../api/types';
import { FieldBox } from '../components/FieldBox';
import { useClickOutside } from '../components/useClickOutside';
import { useUpdateCalendarEventMutation, useDeleteCalendarEventMutation } from '../../api/queries';

/** ISO instant → `datetime-local` value ("YYYY-MM-DDTHH:MM") read in `zone`. */
export function isoToZonedInput(iso: string, zone: string): string {
  const dt = DateTime.fromISO(iso, { zone });
  return dt.isValid ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}

/** `datetime-local` value written in `zone` → ISO instant (null when unparseable). */
export function zonedInputToIso(local: string, zone: string): string | null {
  const dt = DateTime.fromISO(local, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export interface EventDrawerProps {
  event: CalendarEvent;
  onClose: () => void;
  /** Settings timezone the planner renders in — the drawer reads/writes wall-clock times in it. */
  zone?: string;
}

/**
 * Edit drawer for an app-created calendar event. Google-owned events mirror the remote
 * calendar and are not editable here, so the drawer renders nothing for them.
 */
export function EventDrawer({ event, onClose, zone = 'UTC' }: EventDrawerProps) {
  const seededStart = isoToZonedInput(event.startsAt, zone);
  const seededEnd = isoToZonedInput(event.endsAt, zone);
  const [title, setTitle] = useState(event.title);
  const [startLocal, setStartLocal] = useState(seededStart);
  const [endLocal, setEndLocal] = useState(seededEnd);
  const rootRef = useRef<HTMLElement>(null);
  useClickOutside(rootRef, onClose);
  const updateM = useUpdateCalendarEventMutation();
  const deleteM = useDeleteCalendarEventMutation();

  const startIso = zonedInputToIso(startLocal, zone);
  const endIso = zonedInputToIso(endLocal, zone);
  const rangeOk = startIso !== null && endIso !== null && Date.parse(endIso) > Date.parse(startIso);
  const titleOk = title.trim().length > 0;
  const ok = rangeOk && titleOk;
  const pending = updateM.isPending || deleteM.isPending;

  const ctl = 'w-full bg-transparent text-[16px] font-bold text-ink outline-none';
  const errCls = 'mt-0.5 text-[11px] text-crit';

  // Saving/deleting closes the drawer synchronously rather than on the mutation's success:
  // both mutations patch the cached event optimistically, and the drawer is keyed on that
  // event's times, so an onSuccess close would race a remount that drops the mutation
  // observer (and its callbacks) first. Fire-and-forget matches the drag-commit path —
  // the mutation rolls the cache back if the request fails.
  const save = () => {
    if (!ok || pending) return;
    // Only changed fields travel: the PATCH merges into the Google event, so untouched
    // fields must stay untouched. Changes are detected on the *input strings* vs. what the
    // fields were seeded with — comparing instants instead would misfire whenever the
    // minute-precision round-trip isn't lossless (seconds/ms on the stored event, and the
    // DST fall-back hour, where luxon resolves the repeated wall time to the earlier offset).
    const patch: UpdateCalendarEventInput = {};
    if (title.trim() !== event.title) patch.title = title.trim();
    if (startLocal !== seededStart && startIso !== null) patch.startsAt = startIso;
    if (endLocal !== seededEnd && endIso !== null) patch.endsAt = endIso;
    if (Object.keys(patch).length > 0) updateM.mutate({ id: event.id, ...patch });
    onClose();
  };

  const remove = () => {
    if (pending) return;
    deleteM.mutate(event.id);
    onClose();
  };

  if (event.source !== 'app') return null;

  return (
    <aside
      ref={rootRef}
      data-testid="event-drawer"
      className="w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100vh-100px)] overflow-y-auto"
    >
      <h4 className="text-[15px] font-bold text-ink">Edit event</h4>

      <div className="grid grid-cols-2 gap-2.5">
        {/* Title — spans both columns */}
        <div className="col-span-2">
          <FieldBox label="Title">
            <input data-testid="event-title" className={ctl} value={title} onChange={(e) => setTitle(e.target.value)} />
          </FieldBox>
          {!titleOk && <p data-testid="err-title" className={errCls}>Title is required</p>}
        </div>

        {/* Row: Starts | Ends (the date lives in each datetime, so an event may cross midnight) */}
        <div>
          <FieldBox label="Starts">
            <input type="datetime-local" data-testid="event-start" className={ctl} value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
          </FieldBox>
        </div>
        <div>
          <FieldBox label="Ends">
            <input type="datetime-local" data-testid="event-end" className={ctl} value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
          </FieldBox>
          {!rangeOk && <p data-testid="err-range" className={errCls}>End must be after start</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button" data-testid="event-save" disabled={!ok || pending} onClick={save}
          className="rounded-[30px] bg-indigo px-5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50"
        >Save</button>
        <button
          type="button" data-testid="event-cancel" onClick={onClose}
          className="rounded-[30px] border border-line px-5 py-2 text-[14px] font-bold text-inkSoft hover:bg-bg"
        >Cancel</button>
        <button
          type="button" data-testid="event-delete" disabled={pending} onClick={remove}
          className="ml-auto rounded-[30px] border border-line px-4 py-2 text-[14px] font-bold text-crit hover:bg-bg disabled:opacity-50"
        >Delete</button>
      </div>
    </aside>
  );
}
