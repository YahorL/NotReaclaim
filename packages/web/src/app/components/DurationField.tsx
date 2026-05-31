import { msToHM, hmToMs } from '../lib/duration';

export interface DurationFieldProps {
  valueMs: number;
  onChange: (ms: number) => void;
  testid?: string;
}

export function DurationField({ valueMs, onChange, testid }: DurationFieldProps) {
  const { hours, minutes } = msToHM(valueMs);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number" min={0}
        data-testid={testid ? `${testid}-h` : undefined}
        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={hours}
        onChange={(e) => onChange(hmToMs(Number(e.target.value), minutes))}
      />
      <span className="text-xs text-gray-500">h</span>
      <input
        type="number" min={0} max={59}
        data-testid={testid ? `${testid}-m` : undefined}
        className="w-14 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={minutes}
        onChange={(e) => onChange(hmToMs(hours, Number(e.target.value)))}
      />
      <span className="text-xs text-gray-500">m</span>
    </div>
  );
}
