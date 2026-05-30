export type BlockKind = 'meeting' | 'task' | 'habit';

const KIND_BG: Record<BlockKind, string> = {
  meeting: 'bg-slate-400',
  task: 'bg-blue-500',
  habit: 'bg-green-500',
};

export interface EventBlockProps {
  title: string;
  kind: BlockKind;
  topPct: number;
  heightPct: number;
  startLabel: string;
  pinned?: boolean;
}

export function EventBlock({ title, kind, topPct, heightPct, startLabel, pinned = false }: EventBlockProps) {
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      title={`${startLabel} ${title}`}
      className={`absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight text-white ${KIND_BG[kind]}`}
      style={{
        top: `${topPct}%`,
        height: `${heightPct}%`,
        boxShadow: pinned ? 'inset 3px 0 0 #f59e0b' : undefined,
      }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
