import { useState } from 'react';
import { useCompactWidth } from '../lib/useMediaQuery';
import type { UnscheduledEntry } from './unscheduledSummary';

const MAX_SHOWN = 3;
/** A phone gets one: three chips plus "+N more" measured 101px / 4 lines at 390px. */
const MAX_SHOWN_COMPACT = 1;

/**
 * Compact amber banner above the week grid: what the engine could not fit. Amber, not the
 * red `crit` used for at-risk chips — "couldn't fit" is not "overdue". Not dismissible; it
 * disappears on its own as soon as a replan schedules everything.
 */
export function UnscheduledWarning({ entries }: { entries: UnscheduledEntry[] }) {
  // Above the early return: hooks may not be skipped when the banner has nothing to say.
  const compact = useCompactWidth();
  // "+N more" used to be a `title` tooltip, which a touch device has no way to open — on a phone
  // the fold hides all but one entry, so the overflow was simply unreadable. It is a button now;
  // the tooltip stays for a mouse, where it costs nothing.
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const max = expanded ? entries.length : compact ? MAX_SHOWN_COMPACT : MAX_SHOWN;
  const shown = entries.slice(0, max);
  const rest = entries.slice(max);
  return (
    <div
      data-testid="unscheduled-warning"
      role="status"
      className="mb-2 flex w-full min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-800"
    >
      <span className="font-bold">⚠ Couldn't schedule everything:</span>
      {shown.map((e, i) => (
        <span key={e.key} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-amber-400">·</span>}
          <span>{e.label}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <button
          type="button"
          data-testid="unscheduled-more"
          title={rest.map((r) => r.label).join(', ')}
          onClick={() => setExpanded(true)}
          className="font-semibold underline decoration-dotted"
        >
          +{rest.length} more
        </button>
      )}
    </div>
  );
}
