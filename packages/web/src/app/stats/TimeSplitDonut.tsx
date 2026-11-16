import { type DonutKind, type DonutSegment, KIND_BAR_BG, formatHours } from './statsModel';

// Mirrors the `kind.taskBar` / `kind.meetingBar` / `kind.habitBar` colours in tailwind.config.js:
// a conic-gradient needs raw colour values, not class names. Keep the two in sync.
const KIND_HEX: Record<DonutKind, string> = { task: '#f2700f', meeting: '#e5484d', habit: '#2fa45f' };

export function TimeSplitDonut({ segments, totalMs }: { segments: DonutSegment[]; totalMs: number }) {
  return (
    <div data-testid="time-split" className="flex-1 rounded-[14px] border border-line bg-card p-6">
      <div className="mb-4 text-[17px] font-bold text-ink">Time split</div>
      {segments.length === 0 ? (
        <p className="py-8 text-center text-inkSoft">No scheduled time yet</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div
              className="flex h-[150px] w-[150px] items-center justify-center rounded-full"
              style={{ background: `conic-gradient(${segments.map((s) => `${KIND_HEX[s.kind]} ${s.fromPct}% ${s.toPct}%`).join(', ')})` }}
            >
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-card">
                <span className="text-[26px] font-extrabold text-ink">{formatHours(totalMs)}</span>
                <span className="text-[12px] text-inkSoft">total</span>
              </div>
            </div>
          </div>
          <div>
            {segments.map((s) => (
              <div key={s.kind} className="flex items-center gap-2.5 py-1">
                <span className={`h-[11px] w-[11px] rounded-[3px] ${KIND_BAR_BG[s.kind]}`} />
                <span className="flex-1 text-[14.5px] font-semibold capitalize text-ink">{s.kind}</span>
                <span className="text-[14.5px] font-bold text-inkSoft">{formatHours(s.ms)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
