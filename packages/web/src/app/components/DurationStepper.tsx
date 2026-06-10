import { msToHM } from '../lib/duration';
import { Icons } from '../shell/icons';

const STEP = 15 * 60_000;

export function durationLabel(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${minutes} mins`;
}

/** Bold human duration + circular ∓ buttons stepping ±15 min (floor 15 min). */
export function DurationStepper({ valueMs, onChange, disabled = false, label, size = 26 }: {
  valueMs: number; onChange: (ms: number) => void; disabled?: boolean; label: string; size?: number;
}) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[18px] font-bold">{durationLabel(valueMs)}</span>
      <div className="flex gap-2 text-indigo">
        <button type="button" aria-label={`decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(STEP, valueMs - STEP))} className="disabled:opacity-40"><Icons.minusCircle size={size} /></button>
        <button type="button" aria-label={`increase ${label}`} disabled={disabled} onClick={() => onChange(valueMs + STEP)} className="disabled:opacity-40"><Icons.plusCircle size={size} /></button>
      </div>
    </div>
  );
}
