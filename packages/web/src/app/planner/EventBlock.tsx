export type BlockKind = 'meeting' | 'task' | 'habit';

const BASE = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';

/** Color by state, Google-Calendar-style: meeting=blue, locked task/habit=green+lock, movable=transparent dashed green. */
function variantClass(kind: BlockKind, pinned: boolean): string {
  if (kind === 'meeting') return 'bg-event text-white';
  if (pinned) return 'bg-low text-white';
  // movable: text-kind-habitText (#1c7a43) is an accessible dark green on the transparent bg (used for task & habit alike)
  return 'border border-dashed border-low bg-transparent text-kind-habitText';
}

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false }: EventBlockProps) {
  const locked = kind !== 'meeting' && pinned;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      className={`${BASE} ${variantClass(kind, pinned)}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      {locked && <span aria-hidden="true">🔒 </span>}
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
