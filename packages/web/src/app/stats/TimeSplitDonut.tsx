import { useId } from 'react';
import { type DonutSegment, KIND_BAR_BG, KIND_LABEL, KIND_STROKE, donutArcs, formatHours, formatHoursNumber } from './statsModel';

const R = 80;
const STROKE = 18;
const C = 2 * Math.PI * R;
/** Arc length shaved off each segment (prototype: 10) — the round caps then just meet. */
const GAP = 10;

const pct = (s: DonutSegment): number => Math.round(s.toPct - s.fromPct);

export function TimeSplitDonut({ segments, totalMs }: { segments: DonutSegment[]; totalMs: number }) {
  const titleId = useId();
  const arcs = donutArcs(segments, C, GAP);
  const description = segments.map((s) => `${KIND_LABEL[s.kind]} ${formatHoursNumber(s.ms)} hours, ${pct(s)} percent`).join('; ');
  return (
    <section
      data-testid="time-split"
      aria-labelledby={titleId}
      className="glass flex min-w-0 animate-rise flex-col gap-[18px] rounded-panel px-6 py-[22px] [animation-delay:300ms] md:flex-[1_1_320px]"
    >
      <h2 id={titleId} className="text-[20px] font-medium">Time split</h2>
      {segments.length === 0 ? (
        <p className="py-8 text-center text-fg-2">No scheduled time yet</p>
      ) : (
        <>
          <div className="relative h-[200px] w-[200px] self-center">
            <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={description} className="-rotate-90">
              <circle cx="100" cy="100" r={R} fill="none" strokeWidth={STROKE} className="stroke-fg/[.06]" />
              {arcs.map((a) => (
                <circle
                  key={a.kind}
                  data-series={a.kind}
                  cx="100" cy="100" r={R} fill="none" strokeWidth={STROKE} strokeLinecap="round"
                  strokeDasharray={a.dashArray}
                  strokeDashoffset={a.dashOffset}
                  className={`animate-donut-draw ${KIND_STROKE[a.kind]}`}
                  style={{ ['--donut-c' as string]: C.toFixed(1) }}
                />
              ))}
            </svg>
            <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
              <span data-testid="donut-total" className="text-[36px] font-light tracking-[-0.02em]">{formatHours(totalMs)}</span>
              <span className="text-[12px] text-fg-2">total</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {segments.map((s) => (
              <div key={s.kind} data-testid={`split-row-${s.kind}`} className="glass-card flex items-center gap-2.5 rounded-card px-3.5 py-3">
                <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${KIND_BAR_BG[s.kind]}`} />
                <span className="text-[14px]">{KIND_LABEL[s.kind]}</span>
                <span className="ml-auto text-[14px] tabular-nums">{formatHours(s.ms)}</span>
                <span className="w-[38px] text-right text-[12px] text-fg-2">{pct(s)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
