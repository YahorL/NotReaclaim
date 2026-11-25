import { CAPS_LABEL } from '../forms/controls';
import { bufferPreview, type PreviewSegment } from './bufferModel';

const WIDTH_ANIM = 'transition-[width] duration-reflow ease-out-soft';
const BLOCK = 'flex min-w-0 shrink-0 flex-col justify-center overflow-hidden rounded-[12px] px-2 py-2 sm:px-3';

function Segment({ seg }: { seg: PreviewSegment }) {
  const style = { width: `${seg.pct}%` };
  if (seg.kind === 'buffer') {
    // A zero buffer keeps its (zero-width) slot so it animates back in. The 2px inset is padding
    // INSIDE the slot (border-box), so the segments still sum to exactly 100% of the strip.
    return (
      <div
        data-testid="preview-segment" data-kind="buffer" title="Meeting buffer" style={style}
        className={`shrink-0 ${WIDTH_ANIM} ${seg.minutes > 0 ? 'px-[2px]' : ''}`}
      >
        {seg.minutes > 0 && <div className="hatch h-full rounded-[8px]" />}
      </div>
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
      {/* Full strength on the violet fill: white @ .8 there is 3.9:1 for 11px text. */}
      <span className="truncate text-[11px]">{seg.minutes} min</span>
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
      {/* Decorative: the legend below states both values in text. Fluid, never scrolled: the
          segments are shares of the strip, so the whole afternoon fits at any width. */}
      <div aria-hidden="true" data-testid="preview-strip" className="flex h-16 min-w-0 items-stretch">
        {segs.map((s, i) => <Segment key={i} seg={s} />)}
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
