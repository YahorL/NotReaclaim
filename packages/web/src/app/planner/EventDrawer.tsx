import { useState } from 'react';
import type { CalendarEvent, UpdateCalendarEventInput } from '../../api/types';
import { DrawerPanel } from '../components/DrawerPanel';
import { FormField } from '../components/FormField';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { FIELD_CONTROL, FULL_ROW } from '../components/formStyles';
import { useUpdateCalendarEventMutation, useDeleteCalendarEventMutation } from '../../api/queries';
import { isoToZonedInput, zonedInputToIso } from '../lib/datetimeLocal';
import { useZoneChange } from '../settings/useTimezone';

export interface EventDrawerProps {
  event: CalendarEvent;
  onClose: () => void;
  /** Settings timezone the planner renders in — the drawer reads/writes wall-clock times in it. */
  zone: string;
  /** Hosted in a full-screen Sheet below md: drop the 440px panel chrome and the self-dismiss. */
  compact?: boolean;
}

/**
 * Edit drawer for an app-created calendar event. Google-owned events mirror the remote
 * calendar and are not editable here, so the drawer renders nothing for them.
 */
export function EventDrawer({ event, onClose, zone, compact = false }: EventDrawerProps) {
  const seededStart = isoToZonedInput(event.startsAt, zone);
  const seededEnd = isoToZonedInput(event.endsAt, zone);
  const [title, setTitle] = useState(event.title);
  const [startLocal, setStartLocal] = useState(seededStart);
  const [endLocal, setEndLocal] = useState(seededEnd);
  // Opened before settings loaded (fallback zone): re-read untouched times in the real zone, or
  // they would differ from the new seeds and Save would send them — moving the event.
  useZoneChange(zone, (prev, next) => {
    const prevStart = isoToZonedInput(event.startsAt, prev);
    const prevEnd = isoToZonedInput(event.endsAt, prev);
    setStartLocal((cur) => (cur === prevStart ? isoToZonedInput(event.startsAt, next) : cur));
    setEndLocal((cur) => (cur === prevEnd ? isoToZonedInput(event.endsAt, next) : cur));
  });
  const updateM = useUpdateCalendarEventMutation();
  const deleteM = useDeleteCalendarEventMutation();

  const startIso = zonedInputToIso(startLocal, zone);
  const endIso = zonedInputToIso(endLocal, zone);
  const rangeOk = startIso !== null && endIso !== null && Date.parse(endIso) > Date.parse(startIso);
  const titleOk = title.trim().length > 0;
  const ok = rangeOk && titleOk;
  const pending = updateM.isPending || deleteM.isPending;

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
    // DST fall-back hour, where luxon reads the repeated wall time as its LATER, standard-time
    // offset — an event at the first, daylight-time 01:30 would re-parse an hour later).
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
    <DrawerPanel
      testId="event-drawer"
      title="Edit event"
      compact={compact}
      onDismiss={onClose}
      centerActions
      actions={(
        <>
          <PrimaryButton type="button" data-testid="event-save" disabled={!ok || pending} onClick={save}>Save</PrimaryButton>
          <SecondaryButton type="button" data-testid="event-cancel" onClick={onClose}>Cancel</SecondaryButton>
          <button
            type="button" data-testid="event-delete" disabled={pending} onClick={remove}
            className="btn-glass ml-auto h-10 rounded-pill px-4 text-[14px] font-medium text-danger"
          >Delete</button>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <FormField className={FULL_ROW} label="Title" error={titleOk ? undefined : 'Title is required'} errorTestId="err-title">
          <input data-testid="event-title" className={FIELD_CONTROL} value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>

        {/* Row: Starts | Ends (the date lives in each datetime, so an event may cross midnight) */}
        <FormField label="Starts">
          <input type="datetime-local" data-testid="event-start" className={FIELD_CONTROL} value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
        </FormField>
        <FormField label="Ends" error={rangeOk ? undefined : 'End must be after start'} errorTestId="err-range">
          <input type="datetime-local" data-testid="event-end" className={FIELD_CONTROL} value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
        </FormField>
      </div>
    </DrawerPanel>
  );
}
