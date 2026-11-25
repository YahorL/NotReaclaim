import { WEEKDAY_SHORT } from '../lib/weekdays';
import { CHECKBOX, INPUT } from '../forms/controls';
import { type DayState, coverage } from './weeklyHours';

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TICKS = ['12a', '6a', '12p', '6p', '12a'];

// Prototype `.dayrow`: day | start | – | end [| 24h coverage bar]. The bar column only exists from
// sm up (the prototype hides it below 640px), and only where the caller asks for it (Hours).
const ROW_PLAIN = 'grid grid-cols-[72px_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-2.5 py-[5px]';
const ROW_COVERAGE = 'grid grid-cols-[72px_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-2.5 py-1.5 sm:grid-cols-[72px_120px_14px_120px_minmax(120px,1fr)]';
const TIME = `${INPUT} h-[38px] w-full rounded-input px-2.5 text-[14px] tabular-nums`;

export interface WeeklyHoursEditorProps {
  days: DayState[];
  onChange: (weekday: number, patch: Partial<DayState>) => void;
  errors?: Partial<Record<number, string>>;
  idPrefix?: string;
  /** Hours: a 24h bar per row showing the window, with 12a/6a/12p/6p/12a ticks. */
  showCoverage?: boolean;
  /** Bar fill colour (the category's own colour — user data, so inline); lime accent when unset. */
  coverageColor?: string | null;
}

export function WeeklyHoursEditor({ days, onChange, errors = {}, idPrefix = 'day', showCoverage = false, coverageColor = null }: WeeklyHoursEditorProps) {
  const row = showCoverage ? ROW_COVERAGE : ROW_PLAIN;
  return (
    <div className="glass-card rounded-[20px] px-4 py-2">
      {MON_FIRST.map((wd) => {
        const day = days.find((d) => d.weekday === wd)!;
        const dayErr = errors[wd];
        const cov = coverage(day.start, day.end);
        return (
          <div key={wd} data-testid={`${idPrefix}-${wd}-row`} data-enabled={day.enabled} className={row}>
            {/* The label makes the whole day name a toggle target; `coarse:py-2` opens the row pitch
                so adjacent days are not mis-hit on touch. */}
            <label className={`flex cursor-pointer items-center gap-2.5 text-[14px] coarse:py-2 ${day.enabled ? 'text-fg' : 'text-fg-2'}`}>
              <input
                type="checkbox"
                data-testid={`${idPrefix}-${wd}-toggle`}
                checked={day.enabled}
                onChange={(e) => onChange(wd, { enabled: e.target.checked })}
                className={CHECKBOX}
              />
              {WEEKDAY_SHORT[wd]}
            </label>
            <input type="time" aria-label={`${WEEKDAY_LONG[wd]} start time`} data-testid={`${idPrefix}-${wd}-start`} className={TIME} disabled={!day.enabled} value={day.start} onChange={(e) => onChange(wd, { start: e.target.value })} />
            <span aria-hidden="true" className="text-center text-fg-3">–</span>
            <input type="time" aria-label={`${WEEKDAY_LONG[wd]} end time`} data-testid={`${idPrefix}-${wd}-end`} className={TIME} disabled={!day.enabled} value={day.end} onChange={(e) => onChange(wd, { end: e.target.value })} />
            {showCoverage && (
              <div aria-hidden="true" className="relative hidden h-2 rounded-pill bg-fg/[.07] sm:block">
                <div
                  data-testid={`${idPrefix}-${wd}-bar`}
                  className={`absolute inset-y-0 rounded-pill transition-[left,width,opacity] duration-reflow ${coverageColor ? '' : 'bg-accent'} ${day.enabled ? 'opacity-90' : 'opacity-[.15]'}`}
                  style={{ left: `${cov.leftPct}%`, width: `${cov.widthPct}%`, ...(coverageColor ? { backgroundColor: coverageColor } : {}) }}
                />
              </div>
            )}
            {dayErr && <span data-testid={`err-${idPrefix}-${wd}`} className="col-span-full text-[11px] text-danger">{dayErr}</span>}
          </div>
        );
      })}
      {showCoverage && (
        <div data-testid={`${idPrefix}-ticks`} aria-hidden="true" className={`${row} hidden pt-0 sm:grid`}>
          <span /><span /><span /><span />
          <div className="flex justify-between text-[10px] text-fg-3">
            {TICKS.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
