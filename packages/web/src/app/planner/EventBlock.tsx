export type BlockKind = 'meeting' | 'task' | 'habit';

const KIND_BG: Record<BlockKind, string> = {
  meeting: 'bg-slate-400',
  task: 'bg-blue-500',
  habit: 'bg-green-500',
};

const KIND_PROPOSED: Record<BlockKind, string> = {
  meeting: 'border border-dashed border-slate-400 bg-slate-400/20 text-slate-700',
  task: 'border border-dashed border-blue-400 bg-blue-500/20 text-blue-800',
  habit: 'border border-dashed border-green-400 bg-green-500/20 text-green-800',
};

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
  proposed?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false, proposed = false }: EventBlockProps) {
  const base = 'absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight';
  const variant = proposed ? KIND_PROPOSED[kind] : `text-white ${KIND_BG[kind]}`;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      data-proposed={proposed}
      title={`${startLabel} ${title}`}
      className={`${base} ${variant}`}
      style={{
        top: `${topPct}%`,
        height: `${heightPct}%`,
        boxShadow: pinned && !proposed ? 'inset 3px 0 0 #f59e0b' : undefined,
      }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
