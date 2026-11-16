import { DateTime } from 'luxon';

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
