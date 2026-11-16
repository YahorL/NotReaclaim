import { MS_PER_MIN } from './time';

export function msToHM(ms: number): { hours: number; minutes: number } {
  const totalMin = Math.round(ms / MS_PER_MIN);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
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

export function formatDurationShort(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}
