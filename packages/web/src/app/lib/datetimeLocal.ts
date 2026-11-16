import { DateTime } from 'luxon';

const INPUT_FORMAT = "yyyy-LL-dd'T'HH:mm";

/** ISO instant → `datetime-local` value ("YYYY-MM-DDTHH:MM") read in `zone`. */
export function isoToZonedInput(iso: string, zone: string): string {
  const dt = DateTime.fromISO(iso, { zone });
  return dt.isValid ? dt.toFormat(INPUT_FORMAT) : '';
}

/** `datetime-local` value written in `zone` → ISO instant (null when unparseable). */
export function zonedInputToIso(local: string, zone: string): string | null {
  const dt = DateTime.fromISO(local, { zone });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

/** True when `local` is a parseable `datetime-local` value (validity does not depend on the zone). */
export function isValidLocalInput(local: string): boolean {
  return DateTime.fromISO(local).isValid;
}

/**
 * `datetime-local` value for `hour:minute` wall-clock on the calendar day `plusDays` after the day
 * containing `ms` in `zone` — at least the day containing `notBeforeMs` when given. Days are
 * calendar days in `zone`, so a week that crosses a DST change still lands on the same wall-clock.
 */
export function zonedDayAtInput(
  ms: number, zone: string, plusDays: number, hour: number, minute: number, notBeforeMs?: number,
): string {
  let day = DateTime.fromMillis(ms, { zone }).startOf('day').plus({ days: plusDays });
  if (notBeforeMs !== undefined) {
    const floor = DateTime.fromMillis(notBeforeMs, { zone }).startOf('day');
    if (floor > day) day = floor;
  }
  return day.set({ hour, minute, second: 0, millisecond: 0 }).toFormat(INPUT_FORMAT);
}
