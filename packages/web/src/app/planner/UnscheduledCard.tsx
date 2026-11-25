import { useState } from 'react';
import { Icons } from '../shell/icons';
import type { UnscheduledEntry } from './unscheduledSummary';

const MAX_SHOWN = 3;
/** A phone gets one: three chips plus "+N more" measured 101px / 4 lines at 390px. */
const MAX_SHOWN_COMPACT = 1;

export interface UnscheduledCardProps {
  entries: UnscheduledEntry[];
  onReplan: () => void;
  replanPending: boolean;
  /** "+N more": reveal the rest (the Planner switches its side panel to All tasks). Without it the
   *  chips simply unfold in place. */
  onShowAll?: () => void;
  compact?: boolean;
  className?: string;
}

/**
 * Summary card above the planner (spec D12): how many things the engine could not fit, the first
 * few as chips, and the Re-plan button. Always rendered — with nothing unscheduled it reads
 * "Everything fits", so the Re-plan button keeps a home. A live region, so the count updates are
 * announced as replans land.
 */
export function UnscheduledCard({ entries, onReplan, replanPending, onShowAll, compact = false, className = '' }: UnscheduledCardProps) {
  const [expanded, setExpanded] = useState(false);
  const count = entries.length;
  const max = expanded ? count : compact ? MAX_SHOWN_COMPACT : MAX_SHOWN;
  const shown = entries.slice(0, max);
  const rest = entries.slice(max);

  return (
    <section
      data-testid="unscheduled-warning"
      role="status"
      aria-label="Unscheduled"
      className={`glass flex min-w-0 shrink-0 items-center rounded-panel ${compact ? 'gap-3 px-3 py-2.5' : 'gap-6 px-6 py-5'} ${className}`}
    >
      <span
        data-testid="unscheduled-count"
        className={`shrink-0 font-light tabular-nums leading-none tracking-[-0.02em] text-fg ${compact ? 'text-[28px]' : 'text-[44px]'}`}
      >
        {count}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {count > 0 ? (
          <p className={`flex min-w-0 flex-wrap items-center gap-x-1.5 ${compact ? 'text-[13px]' : 'text-[15px]'}`}>
            <span className="inline-flex items-center gap-1.5 text-danger"><Icons.warning size={compact ? 14 : 16} /> Couldn't schedule everything</span>
            {!compact && <span className="text-fg-2">· didn't fit in your free time</span>}
          </p>
        ) : (
          <p className={`inline-flex items-center gap-1.5 text-fg-2 ${compact ? 'text-[13px]' : 'text-[15px]'}`}>
            <Icons.check size={compact ? 14 : 16} className="text-accent-fg" /> Everything fits · nothing left unscheduled
          </p>
        )}
        {count > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {shown.map((e) => (
              <span key={e.key} data-testid="unscheduled-chip" title={e.label} className="chip min-w-0 max-w-full">
                <span className="truncate text-fg">{e.title}</span>
                <span className="shrink-0 text-fg-2">{e.detail}</span>
              </span>
            ))}
            {rest.length > 0 && (
              <button
                type="button"
                data-testid="unscheduled-more"
                title={rest.map((r) => r.label).join(', ')}
                onClick={() => (onShowAll ? onShowAll() : setExpanded(true))}
                className="chip border-accent-line text-accent-fg hover:bg-accent/10"
              >
                +{rest.length} more
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid="replan-button"
        onClick={onReplan}
        disabled={replanPending}
        className={`btn-accent group inline-flex shrink-0 items-center whitespace-nowrap rounded-pill font-semibold ${compact ? 'h-9 gap-1.5 px-3.5 text-[13px]' : 'h-12 gap-2 px-6 text-[16px]'}`}
      >
        <Icons.refresh
          size={compact ? 15 : 18}
          className={replanPending ? 'animate-spin' : 'transition-transform duration-300 ease-pop group-hover:-rotate-[30deg]'}
        />
        {replanPending ? 'Re-planning…' : 'Re-plan'}
      </button>
    </section>
  );
}
