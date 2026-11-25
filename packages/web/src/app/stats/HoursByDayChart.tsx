import { useId, useMemo, useState } from 'react';
import { Segmented } from '../forms/Segmented';
import {
  type KindMs, type DonutKind, type DayRow, KIND_BAR_BG, KIND_LABEL, KIND_ORDER, axisScale, dayTable, formatHours,
} from './statsModel';

/** Plot height (prototype: 240px). */
const PLOT_PX = 240;
/** Surface gap between stacked segments, taken off each segment's own height so totals stay true. */
const GAP_PX = 2;

type View = 'chart' | 'table';
const VIEWS: { key: View; label: string }[] = [{ key: 'chart', label: 'Chart' }, { key: 'table', label: 'Table' }];

const msOf = (r: DayRow, k: DonutKind): number => (k === 'meeting' ? r.meetingMs : k === 'habit' ? r.habitMs : r.taskMs);
const labelOf = (r: DayRow, k: DonutKind): string => (k === 'meeting' ? r.meeting : k === 'habit' ? r.habit : r.task);

export function HoursByDayChart({ perDay, shortLabels, longLabels }: { perDay: KindMs[]; shortLabels: string[]; longLabels: string[] }) {
  const [view, setView] = useState<View>('chart');
  const [hover, setHover] = useState<number | null>(null);
  const idBase = useId();
  const table = useMemo(() => dayTable(perDay, shortLabels, longLabels), [perDay, shortLabels, longLabels]);
  const { topMs, ticksMs } = axisScale(Math.max(0, ...table.rows.map((r) => r.totalMs)));
  const px = (ms: number) => (ms / topMs) * PLOT_PX;

  return (
    <section
      data-testid="hours-by-day"
      aria-labelledby={`${idBase}-title`}
      className="glass flex min-w-0 animate-rise flex-col gap-[18px] rounded-panel px-6 pb-5 pt-[22px] [animation-delay:240ms] md:flex-[999_1_560px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${idBase}-title`} className="text-[20px] font-medium">Hours by day</h2>
          <div className="flex flex-wrap gap-4 text-[13px] text-fg-2">
            {KIND_ORDER.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" data-series={k} className={`h-2.5 w-2.5 rounded-[3px] ${KIND_BAR_BG[k]}`} />
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        </div>
        <Segmented kind="tablist" label="Chart or table" idBase={idBase} options={VIEWS} value={view} onChange={setView} />
      </div>

      {view === 'chart' ? (
        // pt-6: headroom for the total label above a bar that reaches the axis top (it sits ~20px
        // above the bar). On this shared box, so the y-ticks and the plot shift together.
        <div role="tabpanel" id={`${idBase}-panel-chart`} aria-labelledby={`${idBase}-tab-chart`} className="flex gap-2.5 pt-6">
          <div data-testid="y-ticks" aria-hidden="true" className="relative w-7 shrink-0" style={{ height: PLOT_PX }}>
            {ticksMs.map((t) => (
              <span key={t} className="absolute right-0 text-[11px] tabular-nums text-fg-2" style={{ bottom: px(t) - 7 }}>
                {formatHours(t)}
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="relative" style={{ height: PLOT_PX }}>
              {ticksMs.map((t, i) => (
                <div key={t} aria-hidden="true" className={`absolute inset-x-0 h-px ${i === 0 ? 'bg-fg/[.18]' : 'bg-grid'}`} style={{ bottom: px(t) }} />
              ))}
              <div className="absolute inset-0 flex gap-2">
                {table.rows.map((r, i) => {
                  const segs = KIND_ORDER.filter((k) => msOf(r, k) > 0);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={`${r.long}: meetings ${r.meeting}, habits ${r.habit}, tasks ${r.task}, total ${r.total}`}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-[12px] transition-colors hover:bg-fg/[.04]"
                    >
                      {hover === i && (
                        <div
                          data-testid="bar-tooltip"
                          aria-hidden="true"
                          className="glass pointer-events-none absolute left-1/2 z-[2] flex -translate-x-1/2 flex-col gap-1 whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left"
                          style={{ bottom: px(r.totalMs) + 30 }}
                        >
                          <span className="text-[13px] font-medium">{r.long}</span>
                          {KIND_ORDER.map((k) => (
                            <span key={k} className="flex items-center gap-1.5 text-[12px] text-fg-2">
                              <span className={`h-2 w-2 rounded-[2px] ${KIND_BAR_BG[k]}`} />
                              {KIND_LABEL[k]} {labelOf(r, k)}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.totalMs > 0 && (
                        <span data-testid="bar-total" aria-hidden="true" className="mb-1.5 text-[11px] tabular-nums text-fg-2">{r.total}</span>
                      )}
                      {segs.length > 0 && (
                        <div className="flex w-[70%] max-w-[40px] flex-col">
                          {segs.map((k, j) => (
                            <div
                              key={k}
                              data-testid="bar"
                              data-series={k}
                              data-top={j === 0}
                              className={`mt-[2px] shrink-0 origin-bottom animate-grow ${KIND_BAR_BG[k]} ${j === 0 ? 'rounded-t-[4px]' : ''}`}
                              style={{ height: `${Math.max(GAP_PX, Math.round(px(msOf(r, k))) - GAP_PX)}px`, animationDelay: `${i * 50}ms` }}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div aria-hidden="true" className="flex gap-2">
              {table.rows.map((r, i) => (
                <span key={i} className="min-w-0 flex-1 text-center text-[12px] text-fg-2">{r.short}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div role="tabpanel" id={`${idBase}-panel-table`} aria-labelledby={`${idBase}-tab-table`} className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px] tabular-nums">
            <caption className="sr-only">Hours by day</caption>
            <thead>
              <tr>
                {['Day', ...KIND_ORDER.map((k) => KIND_LABEL[k]), 'Total'].map((h, i) => (
                  <th key={h} scope="col" className={`border-b border-fg/10 px-3 py-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-fg-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row" className="border-b border-line px-3 py-2.5 text-left font-normal">{r.long}</th>
                  {KIND_ORDER.map((k) => <td key={k} className="border-b border-line px-3 py-2.5 text-right">{labelOf(r, k)}</td>)}
                  <td className="border-b border-line px-3 py-2.5 text-right font-medium">{r.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="px-3 py-2.5 text-left font-medium">Total</th>
                <td className="px-3 py-2.5 text-right font-medium">{table.totals.meeting}</td>
                <td className="px-3 py-2.5 text-right font-medium">{table.totals.habit}</td>
                <td className="px-3 py-2.5 text-right font-medium">{table.totals.task}</td>
                <td className="px-3 py-2.5 text-right font-medium">{table.totals.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
