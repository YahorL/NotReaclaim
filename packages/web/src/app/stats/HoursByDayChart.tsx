import { type KindMs, type DonutKind, chartScaleMs } from './statsModel';

const KIND_BG: Record<DonutKind, string> = {
  task: 'bg-kind-taskBar',
  meeting: 'bg-kind-meetingBar',
  habit: 'bg-kind-habitBar',
};

export function HoursByDayChart({ perDay, dayLabels }: { perDay: KindMs[]; dayLabels: string[] }) {
  const scale = chartScaleMs(perDay);
  return (
    <div data-testid="hours-by-day" className="flex-[2] rounded-[14px] border border-line bg-card p-6">
      <div className="mb-5 text-[17px] font-bold text-ink">Hours by day</div>
      <div className="flex h-[220px] items-end gap-4">
        {perDay.map((d, i) => {
          const stack = ([
            { kind: 'task' as const, ms: d.task },
            { kind: 'meeting' as const, ms: d.meeting },
            { kind: 'habit' as const, ms: d.habit },
          ]).filter((s) => s.ms > 0);
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-[200px] w-[34px] flex-col justify-end gap-0.5">
                {stack.map((s, j) => (
                  <div
                    key={s.kind}
                    data-testid="bar"
                    data-kind={s.kind}
                    className={`${KIND_BG[s.kind]} ${j === 0 ? 'rounded-t-[3px]' : ''}`}
                    style={{ height: `${(s.ms / scale) * 200}px` }}
                  />
                ))}
              </div>
              <span className="text-[13px] font-semibold text-inkSoft">{dayLabels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
