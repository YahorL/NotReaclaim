import type { UnscheduledEntry } from './unscheduledSummary';

const MAX_SHOWN = 3;

/**
 * Compact amber banner above the week grid: what the engine could not fit. Amber, not the
 * red `crit` used for at-risk chips — "couldn't fit" is not "overdue". Not dismissible; it
 * disappears on its own as soon as a replan schedules everything.
 */
export function UnscheduledWarning({ entries }: { entries: UnscheduledEntry[] }) {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, MAX_SHOWN);
  const rest = entries.slice(MAX_SHOWN);
  return (
    <div
      data-testid="unscheduled-warning"
      role="status"
      className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-800"
    >
      <span className="font-bold">⚠ Couldn't schedule everything:</span>
      {shown.map((e, i) => (
        <span key={e.key} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-amber-400">·</span>}
          <span>{e.label}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map((r) => r.label).join(', ')} className="font-semibold underline decoration-dotted">
          +{rest.length} more
        </span>
      )}
    </div>
  );
}
