import type { DonutKind } from './statsModel';
import { KIND_BAR_BG } from './statsModel';

/** KPI tile (prototype `.kpi`): label, big light number + small unit, then a sub line or a progress bar. */
export function StatCard({ label, value, unit, sub, swatch, progressPct, delayMs = 0 }: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  /** Series swatch before the label (the "In meetings" tile). */
  swatch?: DonutKind;
  /** Renders a progress bar beside `sub` (the "Tasks done" tile). */
  progressPct?: number;
  /** Entrance stagger. */
  delayMs?: number;
}) {
  return (
    <div
      data-testid="stat-card"
      className="glass flex min-w-0 flex-1 animate-rise flex-col gap-1.5 rounded-panel px-[22px] py-5"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span className="flex items-center gap-2 text-[14px] text-fg-2">
        {swatch && <span aria-hidden="true" data-series={swatch} className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${KIND_BAR_BG[swatch]}`} />}
        {label}
      </span>
      <span data-testid="stat-value" className="whitespace-nowrap text-[40px] font-light leading-[1.05] tracking-[-0.03em] tabular-nums md:text-[56px]">
        {value}
        {unit && <span className="text-[20px] tracking-normal text-fg-2 md:text-[24px]">{unit}</span>}
      </span>
      {progressPct === undefined ? (
        <span className="text-[13px] text-fg-2">{sub}</span>
      ) : (
        <div className="flex items-center gap-2.5">
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            className="h-1 min-w-0 flex-1 overflow-hidden rounded-pill bg-fg/10"
          >
            <div className="h-full rounded-pill bg-accent-fg" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="shrink-0 text-[13px] text-fg-2">{sub}</span>
        </div>
      )}
    </div>
  );
}
