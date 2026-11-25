import { CAPS_LABEL } from '../forms/controls';
import { bufferPreview, type PreviewSegment } from './bufferModel';

const WIDTH_ANIM = 'transition-[width,margin] duration-reflow ease-out-soft';
const BLOCK = 'flex min-w-0 shrink-0 flex-col justify-center overflow-hidden rounded-[12px] px-3 py-2';

function Segment({ seg }: { seg: PreviewSegment }) {
  const style = { width: `${seg.pct}%` };
  if (seg.kind === 'buffer') {
    // A zero buffer keeps its (zero-width) slot so it animates back in; no margin/border while empty.
    return (
      <div
        data-testid="preview-segment" data-kind="buffer" title="Meeting buffer" style={style}
        className={`shrink-0 rounded-[8px] ${WIDTH_ANIM} ${seg.minutes > 0 ? 'hatch mx-[2px]' : 'mx-0'}`}
      />
    );
  }
  if (seg.kind === 'gap') {
    return (
      <div data-testid="preview-segment" data-kind="gap" title="Gap between tasks" style={style} className={`relative shrink-0 ${WIDTH_ANIM}`}>
        <span aria-hidden="true" className="absolute inset-x-1 top-1/2 h-px bg-fg/50" />
      </div>
    );
  }
  const meeting = seg.kind === 'meeting';
  return (
    <div
      data-testid="preview-segment" data-kind={seg.kind} style={style}
      className={`${BLOCK} ${WIDTH_ANIM} ${meeting ? 'block-meeting' : 'border-[1.5px] border-dashed border-accent-fg/70 bg-accent/[.05] text-accent-fg'}`}
    >
      <span className="truncate text-[13px] font-medium">{meeting ? 'Meeting' : 'Task'}</span>
      <span className={`truncate text-[11px] ${meeting ? 'opacity-80' : ''}`}>{seg.minutes} min</span>
    </div>
  );
}

/** "How an afternoon gets laid out": the two buffers drawn to scale (spec §4.7). */
export function BufferPreview({ meetingBufferMin, gapMin }: { meetingBufferMin: number; gapMin: number }) {
  const segs = bufferPreview(meetingBufferMin, gapMin);
  const shown = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return (
    <section data-testid="buffer-preview" aria-label="Preview" className="glass flex flex-col gap-4 rounded-panel px-6 py-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className={CAPS_LABEL}>Preview</span>
        <span className="text-[13px] text-fg-2">How an afternoon gets laid out</span>
      </div>
      {/* Decorative: the legend below states both values in text. */}
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="flex h-16 min-w-[480px] items-stretch">
          {segs.map((s, i) => <Segment key={i} seg={s} />)}
        </div>
      </div>
      <div className="flex flex-wrap gap-[18px] text-[13px] text-fg-2">
        <span data-testid="legend-buffer" className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="hatch h-3.5 w-3.5 rounded-[4px]" />
          Buffer · {shown(meetingBufferMin)} min
        </span>
        <span data-testid="legend-gap" className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-px w-3.5 bg-fg/50" />
          Gap · {shown(gapMin)} min
        </span>
      </div>
    </section>
  );
}
