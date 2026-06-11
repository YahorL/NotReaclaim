import type { DayState } from './settingsForm';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

export interface WeeklyHoursEditorProps {
  days: DayState[];
  onChange: (weekday: number, patch: Partial<DayState>) => void;
  errors?: Partial<Record<number, string>>;
  idPrefix?: string;
}

export function WeeklyHoursEditor({ days, onChange, errors = {}, idPrefix = 'day' }: WeeklyHoursEditorProps) {
  const ctlCls = 'rounded-[9px] border border-line px-2 py-0.5 text-sm font-semibold text-ink disabled:text-inkSoft disabled:bg-transparent';
  const errCls = 'text-[11px] text-red-600';
  return (
    <div>
      {MON_FIRST.map((wd) => {
        const day = days.find((d) => d.weekday === wd)!;
        const dayErr = errors[wd];
        return (
          <div key={wd} className="flex items-center gap-2 py-1 text-sm">
            <span className={`w-10 text-[13px] font-semibold ${day.enabled ? 'text-ink' : 'text-inkSoft'}`}>{DAY_LABELS[wd]}</span>
            <input
              type="checkbox"
              data-testid={`${idPrefix}-${wd}-toggle`}
              checked={day.enabled}
              onChange={(e) => onChange(wd, { enabled: e.target.checked })}
              className="accent-indigo h-4 w-4 rounded"
            />
            <input type="time" data-testid={`${idPrefix}-${wd}-start`} className={ctlCls} disabled={!day.enabled} value={day.start} onChange={(e) => onChange(wd, { start: e.target.value })} />
            <span className="text-inkSoft">–</span>
            <input type="time" data-testid={`${idPrefix}-${wd}-end`} className={ctlCls} disabled={!day.enabled} value={day.end} onChange={(e) => onChange(wd, { end: e.target.value })} />
            {dayErr && <span data-testid={`err-${idPrefix}-${wd}`} className={errCls}>{dayErr}</span>}
          </div>
        );
      })}
    </div>
  );
}
