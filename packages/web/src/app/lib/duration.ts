const MS_PER_MIN = 60_000;

export function msToHM(ms: number): { hours: number; minutes: number } {
  const totalMin = Math.round(ms / MS_PER_MIN);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

export function hmToMs(hours: number, minutes: number): number {
  return (hours * 60 + minutes) * MS_PER_MIN;
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map((n) => Number(n));
  return (h ?? 0) * 60 + (m ?? 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant → "YYYY-MM-DDTHH:MM" in local time (for <input type="datetime-local">). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local string (local time) → ISO instant. */
export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

export function formatDurationShort(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}
