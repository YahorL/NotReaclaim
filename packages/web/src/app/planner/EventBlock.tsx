export type BlockKind = 'meeting' | 'task' | 'habit';

// Literal class strings so Tailwind's content scanner emits them.
const KIND_SOLID: Record<BlockKind, string> = {
  meeting: 'bg-kind-meetingBg text-kind-meetingText',
  task: 'bg-kind-taskBg text-kind-taskText',
  habit: 'bg-kind-habitBg text-kind-habitText',
};

const KIND_BAR: Record<BlockKind, string> = {
  meeting: 'border-l-kind-meetingBar',
  task: 'border-l-kind-taskBar',
  habit: 'border-l-kind-habitBar',
};

const KIND_PROPOSED: Record<BlockKind, string> = {
  meeting: 'border border-dashed border-kind-meetingBar bg-kind-meetingBg/60 text-kind-meetingText',
  task: 'border border-dashed border-kind-taskBar bg-kind-taskBg/60 text-kind-taskText',
  habit: 'border border-dashed border-kind-habitBar bg-kind-habitBg/60 text-kind-habitText',
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
  const base = 'absolute left-0.5 right-0.5 overflow-hidden rounded-[6px] px-[7px] py-1 text-[12.5px] font-bold leading-tight';
  const variant = proposed
    ? KIND_PROPOSED[kind]
    : `border-l-[3px] ${KIND_SOLID[kind]} ${pinned ? 'border-l-[#f59e0b]' : KIND_BAR[kind]}`;
  return (
    <div
      data-testid="event-block"
      data-kind={kind}
      data-pinned={pinned}
      data-proposed={proposed}
      title={`${startLabel} ${title}`}
      className={`${base} ${variant}`}
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      <span className="font-medium">{startLabel}</span> {title}
    </div>
  );
}
