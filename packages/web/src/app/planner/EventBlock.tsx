export type BlockKind = 'meeting' | 'task' | 'habit';

export const BASE = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';

/** Color by state, Google-Calendar-style: meeting=blue, locked task/habit=green+lock, movable=transparent dashed green. */
export function variantClass(kind: BlockKind, pinned: boolean, accent?: string): string {
  if (kind === 'meeting') return 'bg-event text-white';
  if (pinned) {
    // With accent: swap bg-low for inline backgroundColor (caller sets style); keep text-white
    return accent ? 'text-white' : 'bg-low text-white';
  }
  // movable: text-kind-habitText (#1c7a43) is an accessible dark green on the transparent bg (used for task & habit alike)
  // With accent: swap border-low + text-kind-habitText for inline styles; keep dashed border
  return accent
    ? 'border border-dashed bg-transparent'
    : 'border border-dashed border-low bg-transparent text-kind-habitText';
}

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
  accent?: string;
  onDelete?: () => void;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false, accent, onDelete }: EventBlockProps) {
  const locked = kind !== 'meeting' && pinned;
  const accentStyles = accent && kind !== 'meeting'
    ? pinned
      ? { backgroundColor: accent }
      : { borderColor: accent, color: accent }
    : {};
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      className={`group ${BASE} ${variantClass(kind, pinned, accent)} transition-[top,height] duration-300 ease-out`}
      style={{ top: `${topPct}%`, height: `${heightPct}%`, ...accentStyles }}
    >
      {onDelete && (
        <button
          type="button"
          aria-label="Delete event"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-black/25 text-[11px] leading-none text-white group-hover:flex hover:bg-black/45"
        >
          ×
        </button>
      )}
      {locked && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
